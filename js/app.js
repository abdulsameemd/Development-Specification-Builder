/* UI: 5-step wizard, live preview, drafts. All rendering is plain DOM; state lives in state.js. */
(function (APB) {
  'use strict';

  const S = APB.state, D = APB.defs, C = APB.completeness, M = APB.markdown, ST = APB.storage, X = APB.exporter, T = APB.templates, V = APB.validation;

  const STEPS = [
    { n: 1, title: 'What are you building?', label: 'Build' },
    { n: 2, title: 'What do you want to build?', label: 'Requirement' },
    { n: 3, title: 'What SAP objects are involved?', label: 'Objects' },
    { n: 4, title: 'Details', label: 'Details' },
    { n: 5, title: 'Review and generate', label: 'Review' }
  ];

  const ui = { step: 1, mode: ST.getMode(), generated: false, raw: false, tab: 'edit', showErrors: false };

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ------------------------------------------------------------------ toast */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ------------------------------------------------------ focus-preserving render */
  function keepFocus(fn) {
    const a = document.activeElement;
    let key = null, sel = null;
    if (a && a.dataset && (a.dataset.bind || a.dataset.multi || a.dataset.check)) {
      key = { attr: a.dataset.bind ? 'data-bind' : a.dataset.multi ? 'data-multi' : 'data-check', val: a.dataset.bind || a.dataset.multi || a.dataset.check, value: (a.type === 'radio' || a.type === 'checkbox') ? a.value : null };
      try { sel = [a.selectionStart, a.selectionEnd]; } catch (e) { sel = null; }
    }
    fn();
    if (key) {
      let q = '[' + key.attr + '="' + key.val + '"]';
      if (key.value !== null) q += '[value="' + String(key.value).replace(/"/g, '\\"') + '"]';
      const el = $(q);
      if (el) {
        el.focus();
        try { if (sel && el.setSelectionRange && sel[0] != null) el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text control */ }
      }
    }
  }

  /* ----------------------------------------------------------- field renderers */
  function fieldId(path) { return 'f-' + path.replace(/[^a-z0-9]+/gi, '-'); }

  function choiceHtml(type, path, field, value, rerender, groupName) {
    return '<div class="choices">' + field.options.map(function (o) {
      const checked = type === 'radio' ? value === o.value : Array.isArray(value) && value.indexOf(o.value) >= 0;
      const attrs = type === 'radio'
        ? 'type="radio" name="' + esc(groupName) + '" data-bind="' + esc(path) + '"' + rerender
        : 'type="checkbox" data-multi="' + esc(path) + '"' + rerender;
      return '<label class="choice"><input ' + attrs + ' value="' + esc(o.value) + '"' + (checked ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
    }).join('') + '</div>';
  }

  /* group = all fields rendered together (needed to know which fields drive conditional ones). */
  function fieldHtml(field, values, basePath, group) {
    if (!D.isVisible(field, values)) return '';
    const path = basePath + '.' + field.id;
    const id = fieldId(path);
    const v = values[field.id];
    const rerender = group.some(function (f) { return f.showIf && f.showIf.field === field.id; }) ? ' data-rerender' : '';
    const ph = field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '';
    let control;
    switch (field.kind) {
      case 'textarea':
      case 'lines':
        control = '<textarea id="' + id + '" rows="3" data-bind="' + esc(path) + '"' + ph + '>' + esc(v || '') + '</textarea>';
        break;
      case 'select':
        control = '<select id="' + id + '" data-bind="' + esc(path) + '"' + rerender + '>' + field.options.map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (v === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('') + '</select>';
        break;
      case 'radio':
      case 'multicheck':
        return '<fieldset class="field"><legend>' + esc(field.label) + '</legend>' + choiceHtml(field.kind === 'radio' ? 'radio' : 'check', path, field, v, rerender, path) + '</fieldset>';
      default:
        control = '<input id="' + id + '" type="text" data-bind="' + esc(path) + '" value="' + esc(v || '') + '"' + ph + '>';
    }
    const hint = field.kind === 'lines' ? ' <span class="hint">one per line</span>' : '';
    return '<div class="field"><label for="' + id + '">' + esc(field.label) + hint + '</label>' + control + '</div>';
  }

  function fieldsHtml(fields, values, basePath, all) {
    return fields.map(function (f) { return fieldHtml(f, values, basePath, all || fields); }).join('');
  }

  /* ------------------------------------------------------------ step renderers */
  function rowRemove(action, i, what) {
    return '<button type="button" class="icon-btn icon-btn-light" data-action="' + action + '" data-i="' + i + '" aria-label="Remove ' + esc(what) + '">✕</button>';
  }

  function step1(s) {
    const missing = ui.showErrors ? V.checkMandatory(s).map(function (r) { return r.id; }) : [];
    const cards = D.typeKeys().map(function (k) {
      const on = s.types.indexOf(k) >= 0;
      return '<button type="button" class="type-card" data-action="toggle-type" data-type="' + k + '" aria-pressed="' + on + '">' +
        '<span class="type-name">' + esc(D.types[k].label) + '</span><span class="type-hint">' + esc(D.types[k].hint) + '</span></button>';
    }).join('');
    const tpls = T.list().map(function (t) {
      return '<button type="button" class="chip" data-action="template" data-id="' + t.id + '" title="' + esc(t.description) + '">' + esc(t.label) + '</button>';
    }).join('');
    return '<h2 class="step-title">' + STEPS[0].title + '</h2>' +
      '<p class="muted">Pick one or more. Everything after this adapts to your choice.</p>' +
      '<div class="type-grid" role="group" aria-label="Development object">' + cards + '</div>' +
      (missing.indexOf('developmentObject') >= 0 ? '<p class="field-error" role="alert">Pick at least one development object.</p>' : '') +
      '<div class="field"><label for="req">Business requirement <span class="req">required</span></label>' +
      '<textarea id="req" class="tall" rows="7" data-bind="requirement.text" placeholder="Describe what needs to be built, or paste the existing business requirement…"' + (missing.indexOf('businessRequirement') >= 0 ? ' aria-invalid="true" aria-describedby="req-err"' : '') + '>' + esc(s.requirement.text) + '</textarea>' +
      (missing.indexOf('businessRequirement') >= 0 ? '<p id="req-err" class="field-error" role="alert">Describe what needs to be built (a sentence or two is enough).</p>' : '') + '</div>' +
      '<div class="field narrow"><label for="proj">Project / requirement name <span class="hint">optional · used for the file name</span></label>' +
      '<input id="proj" type="text" data-bind="project.name" value="' + esc(s.project.name) + '" placeholder="e.g. Employee Leave Balance"></div>' +
      '<details class="more"><summary>Start from a template</summary><p class="muted small">Templates add the structure only — no made-up business details.</p><div class="chips">' + tpls + '</div></details>' +
      nav(false, 'Continue');
  }

  function step2(s) {
    const rules = s.rules.map(function (r, i) {
      return '<div class="row card-row"><div class="field"><label for="rc' + i + '">Condition</label><input id="rc' + i + '" type="text" data-bind="rules.' + i + '.condition" value="' + esc(r.condition) + '" placeholder="e.g. Employee has no remaining leave balance."></div>' +
        '<div class="field"><label for="rb' + i + '">Expected behavior</label><input id="rb' + i + '" type="text" data-bind="rules.' + i + '.behavior" value="' + esc(r.behavior) + '" placeholder="e.g. Prevent submission and show an error message."></div>' +
        rowRemove('remove-rule', i, 'rule ' + (i + 1)) + '</div>';
    }).join('');
    const acc = s.acceptance.map(function (a, i) {
      return '<div class="row card-row"><div class="field"><label for="ac' + i + '">Criterion ' + (i + 1) + '</label><textarea id="ac' + i + '" rows="2" data-bind="acceptance.' + i + '.text" placeholder="e.g. When HR selects a valid date range, the report displays entitlement, leave taken and remaining balance.">' + esc(a.text) + '</textarea></div>' +
        rowRemove('remove-ac', i, 'criterion ' + (i + 1)) + '</div>';
    }).join('');
    return '<h2 class="step-title">' + STEPS[1].title + '</h2>' +
      '<p class="muted">Only the requirement was mandatory — everything here is optional but helps Copilot.</p>' +
      '<div class="field"><label for="obj">Business objective</label><textarea id="obj" rows="2" data-bind="requirement.objective" placeholder="Why is this needed?">' + esc(s.requirement.objective) + '</textarea></div>' +
      '<div class="grid-2"><div class="field"><label for="usr">Users / role</label><input id="usr" type="text" data-bind="requirement.users" value="' + esc(s.requirement.users) + '" placeholder="e.g. HR users"></div>' +
      '<div class="field"><label for="eo">Expected output</label><input id="eo" type="text" data-bind="requirement.expectedOutput" value="' + esc(s.requirement.expectedOutput) + '" placeholder="e.g. ALV list with balance per employee"></div></div>' +
      '<h3>Important business rules</h3>' + rules +
      '<button type="button" class="btn btn-ghost" data-action="add-rule">+ Add Business Rule</button>' +
      '<details class="more"' + (s.acceptance.length || s.assumptions ? ' open' : '') + '><summary>Acceptance criteria &amp; assumptions</summary>' +
      '<h3>Acceptance criteria</h3><p class="muted small">Write them naturally. “When …, …” is turned into Given / When / Then in the Markdown.</p>' + acc +
      '<button type="button" class="btn btn-ghost" data-action="add-ac">+ Add Acceptance Criterion</button>' +
      '<div class="field"><label for="asm">Assumptions <span class="hint">one per line · only what you state is included</span></label><textarea id="asm" rows="3" data-bind="assumptions" placeholder="e.g. Existing leave calculation class will be reused.">' + esc(s.assumptions) + '</textarea></div></details>' +
      nav(true, 'Continue');
  }

  function objectRow(o, i, n) {
    return '<div class="obj-row" role="group" aria-label="Object ' + (i + 1) + '">' +
      '<div class="field"><label for="ot' + i + '">Type</label><select id="ot' + i + '" data-bind="objects.' + i + '.type">' + D.objectTypes.map(function (t) { return '<option' + (t === o.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="on' + i + '">Name</label><input id="on' + i + '" type="text" data-bind="objects.' + i + '.name" value="' + esc(o.name) + '" placeholder="e.g. ZHR_LEAVE_BALANCE" autocapitalize="characters" spellcheck="false"></div>' +
      '<div class="field"><label for="os' + i + '">Status</label><select id="os' + i + '" class="status-select" data-status="' + o.status + '" data-status-sel data-bind="objects.' + i + '.status">' + D.statuses.map(function (st) { return '<option value="' + st.value + '"' + (st.value === o.status ? ' selected' : '') + '>' + st.label + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="op' + i + '">Purpose</label><input id="op' + i + '" type="text" data-bind="objects.' + i + '.purpose" value="' + esc(o.purpose) + '" placeholder="Short purpose"></div>' +
      '<div class="row-actions">' +
      '<button type="button" class="icon-btn icon-btn-light" data-action="move-object" data-i="' + i + '" data-dir="-1" aria-label="Move object ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button type="button" class="icon-btn icon-btn-light" data-action="move-object" data-i="' + i + '" data-dir="1" aria-label="Move object ' + (i + 1) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>↓</button>' +
      rowRemove('remove-object', i, 'object ' + (i + 1)) + '</div></div>';
  }

  function suggestionsHtml(s) {
    const chips = C.mainObjectChips(s).map(function (c) { return { c: c, group: 'main' }; })
      .concat(C.suggest(s).map(function (c) { return { c: c, group: 'sug' }; }));
    if (!chips.length) return '';
    return '<div class="suggest"><p class="muted small" id="sug-h">Possible related objects — suggestions only, you decide:</p><div class="chips" aria-labelledby="sug-h">' +
      chips.map(function (x) {
        return '<button type="button" class="chip" data-action="add-chip" data-type="' + esc(x.c.type) + '" data-status="' + x.c.status + '">+ ' + esc(x.c.label) + '</button>';
      }).join('') + '</div></div>';
  }

  function step3(s) {
    return '<h2 class="step-title">' + STEPS[2].title + '</h2>' +
      '<p class="muted">List what already exists (to reuse) and what is new. Each object needs only a type, a name, a status and a short purpose.</p>' +
      '<div id="obj-rows">' + s.objects.map(function (o, i) { return objectRow(o, i, s.objects.length); }).join('') + '</div>' +
      (s.objects.length ? '' : '<p class="empty">No objects yet. Add the tables, CDS views, classes… Copilot should reuse or create.</p>') +
      '<button type="button" class="btn btn-ghost" data-action="add-object">+ Add Object</button>' +
      '<div id="suggest">' + suggestionsHtml(s) + '</div>' +
      '<h3>Dependency map</h3><p class="muted small">Built from the objects above. Use “used by” to nest an object under another one.</p>' +
      '<div id="depmap" class="depmap"></div>' +
      nav(true, 'Continue');
  }

  function step4(s) {
    const q = s.quality;
    const adv = ui.mode === 'advanced';
    const cards = s.types.map(function (t) {
      const f = D.typeFields(t);
      const values = s.details[t] || {};
      const all = f.essential.concat(f.advanced);
      return '<section class="card" aria-labelledby="h-' + t + '"><h3 id="h-' + t + '">' + esc(D.types[t].label) + '</h3>' +
        fieldsHtml(f.essential, values, 'details.' + t, all) +
        (f.advanced.length ? '<details class="more"' + (adv ? ' open' : '') + '><summary>Advanced details</summary>' + fieldsHtml(f.advanced, values, 'details.' + t, all) + '</details>' : '') +
        '</section>';
    }).join('');
    const perfRelevant = D.performanceRelevant(s.types);
    const quality = D.quality.filter(function (f) { return !f.perfOnly || perfRelevant || adv; });
    const advSections = adv
      ? '<section class="card" aria-labelledby="h-adv"><h3 id="h-adv">Advanced sections</h3>' + fieldsHtml(D.advanced, s.advanced, 'advanced') + '</section>'
      : '<p class="muted small">Need architecture, integration or deployment details? Switch to <button type="button" class="link" data-action="mode" data-mode="advanced">Advanced mode</button>.</p>';
    return '<h2 class="step-title">' + STEPS[3].title + '</h2>' +
      '<p class="muted">Only questions relevant to what you selected. Skip anything you do not know — it becomes an open question for Copilot, not an invention.</p>' +
      (cards || '<p class="empty">Select a development object in step 1 to see its questions.</p>') +
      '<section class="card" aria-labelledby="h-q"><h3 id="h-q">Authorization, testing &amp; clean core</h3>' + fieldsHtml(quality, q, 'quality', D.quality) + '</section>' +
      advSections + nav(true, 'Continue');
  }

  function step5(s) {
    const ev = C.evaluate(s);
    const c = ev.counts;
    const dod = s.dod.map(function (d, i) {
      return '<div class="row dod-row"><label class="choice"><input type="checkbox" data-check="dod.' + i + '.on"' + (d.on ? ' checked' : '') + ' aria-label="Include item ' + (i + 1) + '"><span class="sr-only">Include</span></label>' +
        '<input type="text" data-bind="dod.' + i + '.text" value="' + esc(d.text) + '" aria-label="Definition of done item ' + (i + 1) + '">' + rowRemove('remove-dod', i, 'item ' + (i + 1)) + '</div>';
    }).join('');
    return '<h2 class="step-title">' + STEPS[4].title + '</h2>' +
      statusHtml(ev, true) +
      '<div class="stats">' +
      stat('Objects', c.existing + ' existing<br>' + c.new + ' new' + (c.tbc ? '<br>' + c.tbc + ' to confirm' : '')) +
      stat('Dependencies', c.dependencies + ' identified') +
      stat('Open questions', String(ev.questions.length)) +
      stat('Rules &amp; criteria', s.rules.filter(function (r) { return V.isFilled([r]); }).length + ' rules<br>' + s.acceptance.filter(function (a) { return a.text.trim(); }).length + ' criteria') + '</div>' +
      (ev.optional.length ? '<p class="muted small">Optional information not specified: ' + ev.optional.map(function (r) { return esc(r.label.toLowerCase()); }).join(', ') + '.</p>' : '') +
      '<h3>Definition of done</h3><p class="muted small">Checked items are added to the document. Edit freely.</p>' + dod +
      '<button type="button" class="btn btn-ghost" data-action="add-dod">+ Add item</button>' +
      '<div class="nav-row"><button type="button" class="btn btn-ghost" data-action="back">Back</button><span class="spacer"></span>' +
      (ev.level === 'almost' ? '<button type="button" class="btn btn-ghost" data-action="missing">Add Missing Details</button>' : '') +
      '<button type="button" class="btn btn-primary btn-lg" data-action="generate"' + (ev.mandatory.length ? ' disabled' : '') + '>Generate Specification</button></div>' +
      (ev.mandatory.length ? '<p class="field-error" role="alert">Still needed: ' + ev.mandatory.map(function (r) { return esc(r.label.toLowerCase()); }).join(' and ') + '.</p>' : '');
  }

  function stat(label, html) { return '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-val">' + html + '</span></div>'; }

  function statusHtml(ev, detailed) {
    if (ev.level === 'blocked') {
      return '<div class="status is-blocked"><span class="dot" aria-hidden="true"></span><div><strong>Almost there</strong>' + (detailed ? '<p>Add ' + ev.mandatory.map(function (r) { return esc(r.label.toLowerCase()); }).join(' and ') + ' to get started.</p>' : '') + '</div></div>';
    }
    if (ev.level === 'almost') {
      return '<div class="status is-almost"><span class="dot" aria-hidden="true"></span><div><strong>A few details could improve the result</strong>' +
        '<p>Consider adding:</p><ul>' + ev.important.map(function (r) { return '<li>' + esc(r.label) + '</li>'; }).join('') + '</ul></div></div>';
    }
    return '<div class="status is-ready"><span class="dot" aria-hidden="true"></span><div><strong>Ready for Copilot</strong>' + (detailed ? '<p>Your requirement contains the essential information.</p>' : '') + '</div></div>';
  }

  function nav(back, nextLabel) {
    return '<div class="nav-row">' + (back ? '<button type="button" class="btn btn-ghost" data-action="back">Back</button>' : '') + '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-primary" data-action="next">' + nextLabel + ' <span aria-hidden="true">→</span></button></div>';
  }

  function generatedView(s) {
    const md = M.build(s);
    return '<div class="gen-head"><h2 class="step-title">Your specification is ready</h2>' +
      '<p class="muted"><code>' + esc(M.filename(s)) + '</code> · drop it into your workspace and reference it in Copilot Chat (<code>#file</code> in VS Code, or attach it in Eclipse ADT).</p></div>' +
      '<div class="gen-actions"><button type="button" class="btn btn-primary btn-lg" data-action="download">Download .md</button>' +
      '<button type="button" class="btn btn-ghost" data-action="copy">Copy Markdown</button>' +
      '<button type="button" class="btn btn-ghost" data-action="export">Export project (.json)</button>' +
      '<button type="button" class="btn btn-ghost" data-action="share">Copy share link</button>' +
      '<button type="button" class="btn btn-ghost" data-action="edit">Review Details</button></div>' +
      '<div class="seg gen-seg" role="group" aria-label="Format"><button type="button" data-action="view-rendered" aria-pressed="' + !ui.raw + '">Preview</button><button type="button" data-action="view-raw" aria-pressed="' + ui.raw + '">Markdown</button></div>' +
      '<div class="gen-doc md" tabindex="0" aria-label="Generated specification">' + (ui.raw ? '<pre>' + esc(md) + '</pre>' : M.toHtml(md)) + '</div>';
  }

  /* ----------------------------------------------------------------- dep map */
  function renderMap() {
    const el = $('#depmap');
    if (!el) return;
    const s = S.get();
    const root = C.buildTree(s);
    const idx = {};
    s.objects.forEach(function (o, i) { idx[o.id] = i; });
    function node(n) {
      const o = n.obj, i = idx[o.id];
      const opts = ['<option value="">Development object</option>'].concat(s.objects.filter(function (x) { return x.id !== o.id; }).map(function (x) {
        return '<option value="' + x.id + '"' + (o.parent === x.id ? ' selected' : '') + '>' + esc(C.objectLabel(x)) + '</option>';
      })).join('');
      return '<li><span class="node"><span class="badge s-' + o.status + '">' + esc(D.statusLabel(o.status)) + '</span> <span class="node-label">' + esc(C.objectLabel(o)) + '</span>' +
        (o.purpose ? ' <span class="muted small">– ' + esc(o.purpose) + '</span>' : '') +
        ' <label class="used-by"><span>used by</span><select data-bind="objects.' + i + '.parent" aria-label="' + esc(C.objectLabel(o)) + ' used by">' + opts + '</select></label></span>' +
        (n.children.length ? '<ul>' + n.children.map(node).join('') + '</ul>' : '') + '</li>';
    }
    el.innerHTML = '<ul class="tree"><li><span class="node root">' + esc(root.label) + '</span>' + (root.children.length ? '<ul>' + root.children.map(node).join('') + '</ul>' : '') + '</li></ul>' +
      (root.children.length ? '' : '<p class="muted small">Objects you add will appear here.</p>');
  }

  /* ---------------------------------------------------------------- render core */
  function renderStepper() {
    $('#stepper').innerHTML = STEPS.map(function (st) {
      const cur = !ui.generated && st.n === ui.step;
      return '<li><button type="button" data-action="goto" data-step="' + st.n + '"' + (cur ? ' aria-current="step"' : '') + ' class="' + (cur ? 'is-current' : '') + '"><span class="step-n">' + st.n + '</span><span class="step-l">' + st.label + '</span></button></li>';
    }).join('');
  }

  function renderMain() {
    const s = S.get();
    keepFocus(function () {
      const main = $('#main');
      let html;
      if (ui.generated) html = generatedView(s);
      else html = [step1, step2, step3, step4, step5][ui.step - 1](s);
      main.innerHTML = '<p class="step-count">' + (ui.generated ? 'Done' : 'Step ' + ui.step + ' of 5') + '</p>' + html;
    });
    renderStepper();
    renderMap();
    document.body.classList.toggle('is-generated', ui.generated);
    $('#hero').hidden = ui.generated || ui.step !== 1;
    $$('.mode-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === ui.mode)); });
    renderPreview();
  }

  let pvQueued = false;
  function renderPreview() {
    if (pvQueued) return;
    pvQueued = true;
    requestAnimationFrame(function () {
      pvQueued = false;
      const s = S.get();
      const md = M.build(s);
      $('#pv-status').innerHTML = statusHtml(C.evaluate(s), false);
      const blank = !s.requirement.text.trim() && !s.types.length && !s.objects.length;
      $('#pv-body').innerHTML = blank ? '<p class="muted">Your specification builds here as you fill in the form. Nothing is generated until you have something to say.</p>' : ui.raw ? '<pre>' + esc(md) + '</pre>' : M.toHtml(md);
      $$('[data-action="view-rendered"]').forEach(function (b) { b.setAttribute('aria-pressed', String(!ui.raw)); });
      $$('[data-action="view-raw"]').forEach(function (b) { b.setAttribute('aria-pressed', String(ui.raw)); });
      if (ui.generated) {
        const g = $('.gen-doc');
        if (g) g.innerHTML = ui.raw ? '<pre>' + esc(md) + '</pre>' : M.toHtml(md);
      }
    });
  }

  function setStep(n) {
    ui.step = Math.max(1, Math.min(5, n));
    ui.generated = false;
    ui.showErrors = false;
    renderMain();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------- state changes */
  let saveTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      const ok = ST.save(S.get());
      $('#save-note').textContent = ST.isEmpty(S.get()) ? '' : (ok ? 'Draft saved in this browser.' : 'Could not save locally (storage unavailable).');
    }, 400);
  }

  S.subscribe(function (state, meta) {
    renderPreview();
    scheduleSave();
    if (meta.path && /^(objects|types)/.test(meta.path)) {
      keepFocus(renderMap);
      const sug = $('#suggest');
      if (sug && meta.path.indexOf('.name') < 0) sug.innerHTML = suggestionsHtml(state);
    }
  });

  function addObject(type, status) {
    S.update(function (s) { s.objects.push({ id: S.uid(), type: type || 'Table', name: '', status: status || 'tbc', purpose: '', parent: '' }); });
    renderMain();
    const last = $$('#obj-rows .obj-row').pop();
    if (last) $('input[type="text"]', last).focus();
  }

  function loadState(next, msg) {
    ST.save(S.get());
    S.replace(next);
    ui.step = 1;
    ui.generated = false;
    ui.showErrors = false;
    ST.setCurrent(S.get().id);
    renderMain();
    if (msg) toast(msg);
  }

  function updateSteps(fn) { S.update(fn); renderMain(); }

  /* ------------------------------------------------------------------ drafts */
  function openDrafts() {
    const list = ST.list();
    $('#drafts-list').innerHTML = list.length ? '<ul class="draft-list">' + list.map(function (d) {
      return '<li><div><strong>' + esc(d.name) + '</strong><span class="muted small">' + esc((d.types || []).join(' + ') || 'no object selected') + ' · ' + new Date(d.updated).toLocaleString() + (d.id === S.get().id ? ' · current' : '') + '</span></div>' +
        '<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="resume" data-id="' + esc(d.id) + '">Resume</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="delete-draft" data-id="' + esc(d.id) + '">Delete</button></div></li>';
    }).join('') + '</ul>' : '<p class="empty">No saved drafts yet. Your work is saved automatically as you type.</p>';
    const dlg = $('#drafts-dialog');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }

  function closeDrafts() { const dlg = $('#drafts-dialog'); if (dlg.open && dlg.close) dlg.close(); }

  /* ----------------------------------------------------------------- actions */
  function copyMarkdown() {
    Promise.resolve(X.copy(M.build(S.get()))).then(function (ok) { toast(ok ? 'Markdown copied to clipboard' : 'Copy failed – select the text in Markdown view instead'); });
  }

  const actions = {
    'toggle-type': function (el) {
      const t = el.dataset.type;
      S.update(function (s) { const i = s.types.indexOf(t); if (i >= 0) s.types.splice(i, 1); else s.types.push(t); });
      renderMain();
    },
    goto: function (el) { setStep(Number(el.dataset.step)); },
    next: function () {
      if (ui.step === 1) {
        if (V.checkMandatory(S.get()).length) { ui.showErrors = true; renderMain(); const bad = $('[aria-invalid="true"], .field-error'); if (bad) bad.scrollIntoView({ block: 'center' }); return; }
      }
      setStep(ui.step + 1);
    },
    back: function () { setStep(ui.step - 1); },
    template: function (el) {
      const t = T.fromTemplate(el.dataset.id);
      const cur = S.get();
      if (t) {
        // keep what was already typed in step 1; templates only add structure
        t.requirement = cur.requirement;
        t.project = cur.project;
        t.id = cur.id;
        S.replace(t);
        renderMain();
        toast('Template applied');
      }
    },
    example: function () { loadState(T.example(), 'Example loaded: Employee Leave Balance Report'); },
    new: function () { loadState(S.blank(), 'Started a new requirement'); },
    drafts: openDrafts,
    resume: function (el) {
      const d = ST.load(el.dataset.id);
      closeDrafts();
      if (d) loadState(d, 'Draft resumed');
    },
    'delete-draft': function (el) {
      const id = el.dataset.id;
      ST.remove(id);
      if (id === S.get().id) { S.replace(S.blank()); ui.step = 1; ui.generated = false; renderMain(); }
      openDrafts();
      toast('Draft deleted');
    },
    import: function () { $('#import-file').click(); },
    export: function () {
      const s = S.get();
      X.download(M.filename(s).replace(/\.md$/, '.json'), X.projectJson(s), 'application/json');
      toast('Project exported');
    },
    share: function () {
      X.shareLink(S.get()).then(function (url) {
        return X.copy(url).then(function (ok) { toast(ok ? 'Share link copied (' + Math.ceil(url.length / 1024) + ' KB). Anyone with it can open this spec.' : 'Could not copy the link'); });
      }, function () { toast('Could not create a share link – use Export instead'); });
    },
    mode: function (el) {
      ui.mode = el.dataset.mode;
      ST.setMode(ui.mode);
      renderMain();
    },
    tab: function (el) { setTab(el.dataset.tab); },
    'add-object': function () { addObject('Table', 'existing'); },
    'add-chip': function (el) { addObject(el.dataset.type, el.dataset.status); },
    'remove-object': function (el) {
      const i = Number(el.dataset.i);
      updateSteps(function (s) {
        const gone = s.objects.splice(i, 1)[0];
        s.objects.forEach(function (o) { if (gone && o.parent === gone.id) o.parent = ''; });
      });
    },
    'move-object': function (el) {
      const i = Number(el.dataset.i), j = i + Number(el.dataset.dir);
      updateSteps(function (s) { if (j >= 0 && j < s.objects.length) { const t = s.objects[i]; s.objects[i] = s.objects[j]; s.objects[j] = t; } });
    },
    'add-rule': function () { updateSteps(function (s) { s.rules.push({ id: S.uid(), condition: '', behavior: '' }); }); focusLast('[data-bind$=".condition"]'); },
    'remove-rule': function (el) { updateSteps(function (s) { s.rules.splice(Number(el.dataset.i), 1); }); },
    'add-ac': function () { updateSteps(function (s) { s.acceptance.push({ id: S.uid(), text: '' }); }); focusLast('[data-bind^="acceptance."]'); },
    'remove-ac': function (el) { updateSteps(function (s) { s.acceptance.splice(Number(el.dataset.i), 1); }); },
    'add-dod': function () { updateSteps(function (s) { s.dod.push({ id: S.uid(), text: '', on: true }); }); focusLast('[data-bind$=".text"]'); },
    'remove-dod': function (el) { updateSteps(function (s) { s.dod.splice(Number(el.dataset.i), 1); }); },
    missing: function () {
      const ev = C.evaluate(S.get());
      const first = ev.important[0] || ev.optional[0];
      if (first) setStep(first.step);
    },
    generate: function () {
      if (V.checkMandatory(S.get()).length) return;
      ui.generated = true;
      renderMain();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#main').focus({ preventScroll: true });
    },
    edit: function () { ui.generated = false; ui.step = 5; renderMain(); },
    download: function () {
      const s = S.get();
      if (V.checkMandatory(s).length) { toast('Add a requirement and a development object first'); return; }
      X.download(M.filename(s), M.build(s), 'text/markdown');
      toast('Downloaded ' + M.filename(s));
    },
    copy: copyMarkdown,
    'view-raw': function () { ui.raw = true; renderPreview(); },
    'view-rendered': function () { ui.raw = false; renderPreview(); }
  };

  function focusLast(sel) { const els = $$('#main ' + sel); const el = els[els.length - 1]; if (el) el.focus(); }

  function setTab(tab) {
    ui.tab = tab;
    $('#layout').dataset.tab = tab;
    $$('.view-tabs [role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el);
  });

  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.bind || t.type === 'radio' || t.tagName === 'SELECT') return;
    S.set(t.dataset.bind, t.value);
  });

  document.addEventListener('change', function (e) {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.bind && (t.type === 'radio' || t.tagName === 'SELECT')) {
      S.set(t.dataset.bind, t.value);
      if (t.dataset.statusSel !== undefined) t.dataset.status = t.value;
      if (t.hasAttribute('data-rerender')) renderMain();
    } else if (t.dataset.multi) {
      const cur = (S.getPath(S.get(), t.dataset.multi) || []).slice();
      const i = cur.indexOf(t.value);
      if (t.checked && i < 0) cur.push(t.value);
      if (!t.checked && i >= 0) cur.splice(i, 1);
      S.set(t.dataset.multi, cur);
      if (t.hasAttribute('data-rerender')) renderMain();
    } else if (t.dataset.check) {
      S.set(t.dataset.check, t.checked);
    } else if (t.id === 'import-file' && t.files && t.files[0]) {
      const file = t.files[0];
      file.text().then(function (text) {
        try { loadState(X.parseProject(text), 'Imported ' + file.name); } catch (err) { toast(err.message); }
      });
      t.value = '';
    }
  });

  $('#drafts-dialog').addEventListener('click', function (e) { if (e.target === this) closeDrafts(); });

  /* ---------------------------------------------------------------- bootstrap */
  async function init() {
    let loaded = false;
    try {
      const shared = await X.readShareLink(location.hash);
      if (shared) {
        S.replace(shared);
        ST.save(S.get());
        history.replaceState(null, '', location.pathname + location.search);
        loaded = true;
        setTimeout(function () { toast('Shared specification loaded as a new draft'); }, 300);
      }
    } catch (e) { setTimeout(function () { toast('The share link could not be read'); }, 300); }
    if (!loaded) {
      const d = ST.currentId() && ST.load(ST.currentId());
      if (d) S.replace(d);
    }
    ui.step = 1;
    setTab('edit');
    renderMain();
  }

  init();
})(window.APB = window.APB || {});
