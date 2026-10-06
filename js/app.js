/* UI: 5-step wizard, per-object builders, live preview, drafts. Plain DOM; state lives in state.js. */
(function (APB) {
  'use strict';

  const S = APB.state, D = APB.defs, C = APB.completeness, M = APB.markdown, ST = APB.storage, X = APB.exporter, T = APB.templates, V = APB.validation;

  const STEPS = [
    { n: 1, title: 'What are you building?', label: 'Build' },
    { n: 2, title: 'Business requirement details', label: 'Requirement' },
    { n: 3, title: 'Which SAP objects are involved?', label: 'Objects' },
    { n: 4, title: 'Technical design per object', label: 'Specify' },
    { n: 5, title: 'Review and generate', label: 'Review' }
  ];

  const ui = { step: 1, mode: ST.getMode(), generated: false, raw: false, tab: 'edit', showErrors: false, open: {} };

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function idOf(path) { return 'f-' + path.replace(/[^a-z0-9]+/gi, '-'); }

  /* ------------------------------------------------------------------ toast */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  /* ------------------------------------------------------ focus-preserving render */
  function keepFocus(fn) {
    const a = document.activeElement;
    let key = null, sel = null;
    if (a && a.dataset && (a.dataset.bind || a.dataset.multi || a.dataset.check)) {
      key = { attr: a.dataset.bind ? 'data-bind' : a.dataset.multi ? 'data-multi' : 'data-check', val: a.dataset.bind || a.dataset.multi || a.dataset.check, value: (a.type === 'radio' || a.dataset.multi) ? a.value : null };
      try { sel = [a.selectionStart, a.selectionEnd]; } catch (e) { sel = null; }
    }
    fn();
    if (key) {
      let q = '[' + key.attr + '="' + key.val + '"]';
      if (key.value !== null) q += '[value="' + String(key.value).replace(/"/g, '\\"') + '"]';
      const el = $(q);
      if (el) {
        el.focus({ preventScroll: true });
        try { if (sel && el.setSelectionRange && sel[0] != null) el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text control */ }
      }
    }
  }

  /* Disclosure state survives re-renders (keyed by data-key). */
  function isOpen(key, dflt) { if (ui.open[key] === undefined) ui.open[key] = dflt; return ui.open[key]; }
  function detailsAttrs(key, dflt) { return ' data-key="' + esc(key) + '"' + (isOpen(key, dflt) ? ' open' : ''); }

  /* ----------------------------------------------------------- field renderers */
  function optionsHtml(options, v) {
    return options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (v === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
  }

  function choiceHtml(type, path, field, value, rerender) {
    return '<div class="choices">' + field.options.map(function (o) {
      const checked = type === 'radio' ? value === o.value : Array.isArray(value) && value.indexOf(o.value) >= 0;
      const attrs = type === 'radio'
        ? 'type="radio" name="' + esc(path) + '" data-bind="' + esc(path) + '"' + rerender
        : 'type="checkbox" data-multi="' + esc(path) + '"' + rerender;
      return '<label class="choice"><input ' + attrs + ' value="' + esc(o.value) + '"' + (checked ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
    }).join('') + '</div>';
  }

  function gridHtml(field, rows, path) {
    rows = Array.isArray(rows) ? rows : [];
    const shown = rows.length ? rows : [{}];
    const max = field.max || 0;
    const head = '<thead><tr><th class="g-n" aria-label="Row">#</th>' + field.columns.map(function (c) {
      return '<th style="min-width:' + (c.w || 120) + 'px"' + (c.kind === 'check' ? ' class="g-chk"' : '') + '>' + esc(c.label) + '</th>';
    }).join('') + '<th class="g-act"><span class="sr-only">Row actions</span></th></tr></thead>';
    const body = shown.map(function (r, i) {
      r = r || {};
      return '<tr><td class="g-n">' + (i + 1) + '</td>' + field.columns.map(function (c) {
        const p = path + '.' + i + '.' + c.id;
        const aria = ' aria-label="' + esc(field.label + ' row ' + (i + 1) + ': ' + c.label) + '"';
        if (c.kind === 'check') return '<td class="g-chk"><input type="checkbox" data-check="' + esc(p) + '"' + (r[c.id] ? ' checked' : '') + aria + '></td>';
        if (c.kind === 'select') return '<td><select data-bind="' + esc(p) + '"' + aria + '>' + optionsHtml(c.options, r[c.id] || '') + '</select></td>';
        return '<td><input type="text" data-bind="' + esc(p) + '" value="' + esc(r[c.id] || '') + '"' + (c.placeholder && i === 0 ? ' placeholder="' + esc(c.placeholder) + '"' : '') + (c.list ? ' list="' + c.list + '"' : '') + ' spellcheck="false"' + aria + '></td>';
      }).join('') + '<td class="g-act">' +
        '<button type="button" class="g-btn" data-action="row-move" data-path="' + esc(path) + '" data-i="' + i + '" aria-label="Move row ' + (i + 1) + ' up"' + (i === 0 || !rows.length ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="g-btn" data-action="row-del" data-path="' + esc(path) + '" data-i="' + i + '" aria-label="Delete row ' + (i + 1) + '"' + (!rows.length ? ' disabled' : '') + '>✕</button></td></tr>';
    }).join('');
    const canAdd = !max || shown.length < max;
    const pasteId = idOf(path) + '-paste';
    const tools = '<div class="grid-tools">' +
      (canAdd ? '<button type="button" class="btn btn-ghost btn-sm" data-action="row-add" data-path="' + esc(path) + '">' + esc(field.addLabel || '+ Row') + '</button>' : '') +
      (field.paste ? '<details class="paste"' + detailsAttrs(pasteId, false) + '><summary>Paste from Excel</summary>' +
        '<label for="' + pasteId + '" class="small muted">Paste rows (tab-separated, as copied from Excel / SE11). Column order: ' + field.columns.map(function (c) { return esc(c.label); }).join(' · ') + '</label>' +
        '<textarea id="' + pasteId + '" rows="4" spellcheck="false"></textarea>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="paste-rows" data-path="' + esc(path) + '" data-src="' + pasteId + '">Add pasted rows</button></details>' : '') +
      '</div>';
    return '<div class="table-scroll"><table class="grid">' + head + '<tbody>' + body + '</tbody></table></div>' + tools;
  }

  function recordsHtml(field, recs, path) {
    recs = Array.isArray(recs) ? recs : [];
    const bulkId = idOf(path) + '-bulk';
    const cards = recs.map(function (r, i) {
      r = r || {};
      const rp = path + '.' + i;
      const titleId = idOf(rp) + '-title';
      return '<section class="rec" aria-labelledby="' + titleId + '"><div class="rec-head"><h5 id="' + titleId + '"><span class="rec-kind">' + esc(field.itemLabel) + ' ' + (i + 1) + '</span> <span data-title-of="' + esc(rp + '.' + field.titleField) + '">' + esc(r[field.titleField] || '') + '</span></h5>' +
        '<div class="row-actions"><button type="button" class="g-btn" data-action="rec-dup" data-path="' + esc(path) + '" data-i="' + i + '" aria-label="Duplicate ' + esc(field.itemLabel) + ' ' + (i + 1) + '" title="Duplicate">⧉</button>' +
        '<button type="button" class="g-btn" data-action="rec-del" data-path="' + esc(path) + '" data-i="' + i + '" aria-label="Delete ' + esc(field.itemLabel) + ' ' + (i + 1) + '" title="Delete">✕</button></div></div>' +
        fieldsBlock(field.fields, r, rp) + '</section>';
    }).join('');
    return '<div class="records">' + (cards || '<p class="empty small">No ' + esc(field.itemLabel.toLowerCase()) + 's yet.</p>') +
      '<div class="grid-tools"><button type="button" class="btn btn-ghost btn-sm" data-action="rec-add" data-path="' + esc(path) + '">+ ' + esc(field.itemLabel) + '</button>' +
      (field.bulk ? '<span class="bulk"><label for="' + bulkId + '" class="small">How many ' + esc(field.label.toLowerCase()) + '?</label><input id="' + bulkId + '" type="number" min="1" max="30" value="3">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="rec-bulk" data-path="' + esc(path) + '" data-src="' + bulkId + '">Add</button></span>' : '') +
      '</div></div>';
  }

  /* group = sibling fields (to know which ones drive conditional fields). */
  function fieldHtml(field, values, basePath, group) {
    if (!D.isVisible(field, values)) return '';
    const path = basePath + '.' + field.id;
    const id = idOf(path);
    const v = values[field.id];
    const rerender = group.some(function (f) { return f.showIf && f.showIf.field === field.id; }) ? ' data-rerender' : '';
    const ph = field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '';
    const hint = field.hint ? '<p class="field-hint">' + esc(field.hint) + '</p>' : '';
    const wide = ['grid', 'records', 'textarea', 'lines', 'radio', 'multicheck', 'check'].indexOf(field.kind) >= 0 ? ' wide' : '';
    switch (field.kind) {
      case 'grid':
        return '<div class="field wide"><div class="label">' + esc(field.label) + '</div>' + hint + gridHtml(field, v, path) + '</div>';
      case 'records':
        return '<div class="field wide"><div class="label">' + esc(field.label) + (Array.isArray(v) && v.length ? ' <span class="count">' + v.length + '</span>' : '') + '</div>' + hint + recordsHtml(field, v, path) + '</div>';
      case 'radio':
      case 'multicheck':
        return '<fieldset class="field' + wide + '"><legend>' + esc(field.label) + '</legend>' + choiceHtml(field.kind === 'radio' ? 'radio' : 'check', path, field, v, rerender) + hint + '</fieldset>';
      case 'check':
        return '<div class="field' + wide + '"><label class="check"><input type="checkbox" data-check="' + esc(path) + '"' + (v ? ' checked' : '') + rerender + '> ' + esc(field.label) + '</label>' + hint + '</div>';
      case 'select':
        return '<div class="field"><label for="' + id + '">' + esc(field.label) + '</label><select id="' + id + '" data-bind="' + esc(path) + '"' + rerender + '>' + optionsHtml(field.options, v || '') + '</select>' + hint + '</div>';
      case 'textarea':
      case 'lines': {
        const rows = Math.min(10, Math.max(3, String(v || field.placeholder || '').split('\n').length));
        return '<div class="field wide"><label for="' + id + '">' + esc(field.label) + (field.kind === 'lines' ? ' <span class="hint">one per line</span>' : '') + '</label>' +
          '<textarea id="' + id + '" rows="' + rows + '" data-bind="' + esc(path) + '"' + ph + ' spellcheck="false">' + esc(v || '') + '</textarea>' + hint + '</div>';
      }
      default:
        return '<div class="field"><label for="' + id + '">' + esc(field.label) + '</label><input id="' + id + '" type="text" data-bind="' + esc(path) + '" value="' + esc(v || '') + '"' + ph + (field.list ? ' list="' + field.list + '"' : '') + ' spellcheck="false"' +
          (field.id === 'name' ? ' data-title-src' : '') + '>' + hint + '</div>';
    }
  }

  /* Essential fields in a responsive form grid; advanced ones behind a disclosure. */
  function fieldsBlock(fields, values, basePath, opts) {
    values = values || {};
    const ess = fields.filter(function (f) { return !f.advanced; });
    const adv = fields.filter(function (f) { return f.advanced; });
    let html = '<div class="form-grid">' + ess.map(function (f) { return fieldHtml(f, values, basePath, fields); }).join('') + '</div>';
    if (adv.length && !(opts && opts.noAdvanced)) {
      html += '<details class="more"' + detailsAttrs(basePath + '#adv', ui.mode === 'advanced') + '><summary>Advanced details</summary><div class="form-grid">' +
        adv.map(function (f) { return fieldHtml(f, values, basePath, fields); }).join('') + '</div></details>';
    }
    return html;
  }

  /* ------------------------------------------------------------ step renderers */
  function rowRemove(action, i, what) {
    return '<button type="button" class="icon-btn icon-btn-light" data-action="' + action + '" data-i="' + i + '" aria-label="Remove ' + esc(what) + '">✕</button>';
  }

  function nav(back, nextLabel) {
    return '<div class="nav-row">' + (back ? '<button type="button" class="btn btn-ghost" data-action="back">Back</button>' : '') + '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-primary" data-action="next">' + nextLabel + ' <span aria-hidden="true">→</span></button></div>';
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
      '<p class="muted">Pick one or more. The main object is added for you; everything after this adapts to your choice.</p>' +
      '<div class="type-grid" role="group" aria-label="Development object">' + cards + '</div>' +
      (missing.indexOf('developmentObject') >= 0 ? '<p class="field-error" role="alert">Pick at least one development object.</p>' : '') +
      '<div class="field"><label for="req">Business requirement <span class="req">required</span></label>' +
      '<textarea id="req" class="tall" rows="7" data-bind="requirement.text" placeholder="Paste the functional requirement, e.g.\nCreate an FI-AP report that lists open vendor items for a company code and key date, grouped into ageing buckets 0-30 / 31-60 / 61-90 / >90 days."' + (missing.indexOf('businessRequirement') >= 0 ? ' aria-invalid="true" aria-describedby="req-err"' : '') + '>' + esc(s.requirement.text) + '</textarea>' +
      (missing.indexOf('businessRequirement') >= 0 ? '<p id="req-err" class="field-error" role="alert">Describe what needs to be built (a sentence or two is enough).</p>' : '') + '</div>' +
      '<div class="field narrow"><label for="proj">Project / requirement name <span class="hint">optional · used for the file name</span></label>' +
      '<input id="proj" type="text" data-bind="project.name" value="' + esc(s.project.name) + '" placeholder="e.g. FI AP Vendor Ageing / SD Billing Block Rules"></div>' +
      '<details class="more"' + detailsAttrs('templates', false) + '><summary>Start from a template</summary><p class="muted small">Templates add object structure only — no made-up business details. Not sure? Use <button type="button" class="link" data-action="examples">Try Example</button>.</p><div class="chips">' + tpls + '</div></details>' +
      nav(false, 'Continue');
  }

  function step2(s) {
    const rules = s.rules.map(function (r, i) {
      return '<div class="row card-row"><div class="field"><label for="rc' + i + '">Condition</label><input id="rc' + i + '" type="text" data-bind="rules.' + i + '.condition" value="' + esc(r.condition) + '" placeholder="e.g. Sales order has a billing block"></div>' +
        '<div class="field"><label for="rb' + i + '">Expected behavior</label><input id="rb' + i + '" type="text" data-bind="rules.' + i + '.behavior" value="' + esc(r.behavior) + '" placeholder="e.g. Exclude it from the billing due list and log a message"></div>' +
        rowRemove('remove-rule', i, 'rule ' + (i + 1)) + '</div>';
    }).join('');
    const acc = s.acceptance.map(function (a, i) {
      return '<div class="row card-row"><div class="field"><label for="ac' + i + '">Criterion ' + (i + 1) + '</label><textarea id="ac' + i + '" rows="2" data-bind="acceptance.' + i + '.text" placeholder="e.g. When the user enters company code 1000 and a key date, the report lists open vendor items per ageing bucket.">' + esc(a.text) + '</textarea></div>' +
        rowRemove('remove-ac', i, 'criterion ' + (i + 1)) + '</div>';
    }).join('');
    return '<h2 class="step-title">' + STEPS[1].title + '</h2>' +
      '<p class="muted">All optional — but business rules and acceptance criteria are what keep Copilot from guessing.</p>' +
      '<div class="field"><label for="obj">Business objective</label><textarea id="obj" rows="2" data-bind="requirement.objective" placeholder="e.g. Month-end review of overdue payables / remove manual MIGO postings">' + esc(s.requirement.objective) + '</textarea></div>' +
      '<div class="grid-2"><div class="field"><label for="usr">Users / role</label><input id="usr" type="text" data-bind="requirement.users" value="' + esc(s.requirement.users) + '" placeholder="e.g. AP accountants, MM buyers, SD billing, IS-U billing"></div>' +
      '<div class="field"><label for="eo">Expected output</label><input id="eo" type="text" data-bind="requirement.expectedOutput" value="' + esc(s.requirement.expectedOutput) + '" placeholder="e.g. ALV per vendor with ageing buckets / material document number"></div></div>' +
      '<h3>Business rules</h3>' + rules +
      '<button type="button" class="btn btn-ghost" data-action="add-rule">+ Add Business Rule</button>' +
      '<details class="more"' + detailsAttrs('acc', !!(s.acceptance.length || s.assumptions)) + '><summary>Acceptance criteria &amp; assumptions</summary>' +
      '<h3>Acceptance criteria</h3><p class="muted small">Write them naturally. “When …, …” becomes Given / When / Then in the Markdown.</p>' + acc +
      '<button type="button" class="btn btn-ghost" data-action="add-ac">+ Add Acceptance Criterion</button>' +
      '<div class="field"><label for="asm">Assumptions <span class="hint">one per line · only what you state is included</span></label><textarea id="asm" rows="3" data-bind="assumptions" placeholder="e.g. Standard BAPI_ACC_DOCUMENT_POST is reused\nRuns on S/4HANA 2023 (ABAP Cloud not required)">' + esc(s.assumptions) + '</textarea></div></details>' +
      nav(true, 'Continue');
  }

  function typeOptions(selected) {
    return D.objectGroups.map(function (g) {
      const items = D.objectTypes.filter(function (t) { return D.objectDef(t).group === g; });
      return '<optgroup label="' + esc(g) + '">' + items.map(function (t) { return '<option' + (t === selected ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }

  function namingWarning(o) {
    const n = (o.name || '').trim();
    return !!(n && (o.status === 'new') && D.objectDef(o.type).abapNaming && !/^(Z|Y|\/\w+\/)/i.test(n));
  }

  function objectRow(o, i, n) {
    return '<div class="obj-row" role="group" aria-label="Object ' + (i + 1) + '">' +
      '<div class="field"><label for="ot' + i + '">Type</label><select id="ot' + i + '" data-bind="objects.' + i + '.type" data-rerender>' + typeOptions(o.type) + '</select></div>' +
      '<div class="field"><label for="on' + i + '">Name</label><input id="on' + i + '" type="text" data-bind="objects.' + i + '.name" data-name-check="' + i + '" value="' + esc(o.name) + '" placeholder="e.g. ZSD_BILL_BLOCK" spellcheck="false">' +
      '<span class="name-warn" id="nw' + i + '"' + (namingWarning(o) ? '' : ' hidden') + '>Customer objects normally start with Z, Y or /NAMESPACE/.</span></div>' +
      '<div class="field"><label for="os' + i + '">Status</label><select id="os' + i + '" class="status-select" data-status="' + o.status + '" data-status-sel data-bind="objects.' + i + '.status">' + optionsHtml(D.statuses, o.status) + '</select></div>' +
      '<div class="field"><label for="op' + i + '">Purpose</label><input id="op' + i + '" type="text" data-bind="objects.' + i + '.purpose" value="' + esc(o.purpose) + '" placeholder="Short purpose"></div>' +
      '<div class="row-actions">' +
      '<button type="button" class="icon-btn icon-btn-light" data-action="move-object" data-i="' + i + '" data-dir="-1" aria-label="Move object ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button type="button" class="icon-btn icon-btn-light" data-action="move-object" data-i="' + i + '" data-dir="1" aria-label="Move object ' + (i + 1) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>↓</button>' +
      rowRemove('remove-object', i, 'object ' + (i + 1)) + '</div></div>';
  }

  function suggestionsHtml(s) {
    const chips = C.mainObjectChips(s).concat(C.suggest(s));
    if (!chips.length) return '';
    return '<div class="suggest"><p class="muted small" id="sug-h">Possible related objects — suggestions only, you decide:</p><div class="chips" aria-labelledby="sug-h">' +
      chips.map(function (c) { return '<button type="button" class="chip" data-action="add-chip" data-type="' + esc(c.type) + '" data-status="' + c.status + '">+ ' + esc(c.label) + '</button>'; }).join('') + '</div></div>';
  }

  function step3(s) {
    return '<h2 class="step-title">' + STEPS[2].title + '</h2>' +
      '<p class="muted">List what you reuse, what you change and what is new. You specify each object in the next step: fields for tables, parameters for function modules, methods for classes…</p>' +
      (s.objects.length ? '<div class="obj-head" aria-hidden="true"><span>Type</span><span>Name</span><span>Status</span><span>Purpose</span><span></span></div>' : '') +
      '<div id="obj-rows">' + s.objects.map(function (o, i) { return objectRow(o, i, s.objects.length); }).join('') + '</div>' +
      (s.objects.length ? '' : '<p class="empty">No objects yet. Add the tables, CDS views, classes, function modules… Copilot should reuse or create.</p>') +
      '<button type="button" class="btn btn-ghost" data-action="add-object">+ Add Object</button>' +
      '<div id="suggest">' + suggestionsHtml(s) + '</div>' +
      '<h3>Dependency map</h3><p class="muted small">Built from the objects above. Use “used by” to nest an object under the one that uses it.</p>' +
      '<div id="depmap" class="depmap"></div>' +
      nav(true, 'Continue');
  }

  function artifactCard(o, i) {
    const def = D.objectDef(o.type);
    const builder = D.hasBuilder(o);
    const done = builder ? C.detailFilled(o) : V.isFilled(o.detail.used);
    const base = 'objects.' + i + '.detail';
    let body;
    if (builder) {
      body = (o.status === 'change' ? '<p class="note">Describe only what changes (new fields, new parameters, changed logic).</p>' : '') + fieldsBlock(def.fields, o.detail, base);
    } else {
      body = '<div class="form-grid">' + fieldHtml({ id: 'used', label: o.status === 'tbc' ? 'What would you need from it?' : 'What do you need from it?', kind: 'textarea', placeholder: def.usedHint }, o.detail, base, []) + '</div>' +
        (def.fields.length ? '<p class="muted small">Set the status to <strong>New</strong> or <strong>Existing – change</strong> in step 3 to get the full ' + esc(o.type) + ' designer.</p>' : '');
    }
    return '<details class="artifact" id="obj-' + o.id + '"' + detailsAttrs('obj:' + o.id, builder && !done) + '>' +
      '<summary><span class="badge s-' + o.status + '">' + esc(D.statusLabel(o.status)) + '</span> <span class="a-type">' + esc(o.type) + (def.tcode ? ' <span class="tcode">' + esc(def.tcode) + '</span>' : '') + '</span> ' +
      '<span class="a-name">' + esc(o.name || '(no name yet)') + '</span>' + (o.purpose ? ' <span class="muted small a-purpose">' + esc(o.purpose) + '</span>' : '') +
      '<span class="a-state ' + (done ? 'ok' : 'todo') + '">' + (done ? '✓ specified' : builder ? 'to specify' : 'optional') + '</span></summary>' +
      '<div class="artifact-body">' + body + '</div></details>';
  }

  function step4(s) {
    const adv = ui.mode === 'advanced';
    const refs = C.unlistedReferences(s);
    const perfRelevant = D.performanceRelevant(s.types);
    const quality = D.quality.filter(function (f) { return !f.perfOnly || perfRelevant || adv; });
    const index = s.objects.length ? '<nav class="obj-index" aria-label="Objects">' + s.objects.map(function (o) {
      const done = D.hasBuilder(o) ? C.detailFilled(o) : true;
      return '<a href="#obj-' + o.id + '" data-action="jump" data-id="' + o.id + '" class="' + (done ? 'ok' : 'todo') + '">' + esc(o.name || o.type) + '</a>';
    }).join('') + '</nav>' : '';
    return '<h2 class="step-title">' + STEPS[3].title + '</h2>' +
      '<p class="muted">New and changed objects get a full designer (SE11 fields, SE37 parameters, SE24 methods, CDS elements, RAP behavior, CAP model…). For reused objects, just note what you need. Leave anything unknown empty — it becomes an open question, not an invention.</p>' +
      index +
      (refs.length ? '<div class="refs" role="note"><strong>Referenced but not in your object list:</strong> ' + refs.map(function (r) {
        return '<button type="button" class="chip" data-action="add-ref" data-type="' + esc(r.type) + '" data-name="' + esc(r.name) + '">+ ' + esc(r.type) + ' ' + esc(r.name) + '</button>';
      }).join(' ') + '</div>' : '') +
      (s.objects.length ? s.objects.map(artifactCard).join('') : '<p class="empty">No objects yet. Add them in <button type="button" class="link" data-action="goto" data-step="3">step 3</button>.</p>') +
      '<section class="card" aria-labelledby="h-q"><h3 id="h-q">Authorization, testing &amp; clean core</h3>' + fieldsBlock(quality, s.quality, 'quality', { noAdvanced: true }) + '</section>' +
      (adv
        ? '<section class="card" aria-labelledby="h-adv"><h3 id="h-adv">Architecture &amp; technical constraints</h3>' + '<div class="form-grid">' + D.advanced.map(function (f) { return fieldHtml(f, s.advanced, 'advanced', D.advanced); }).join('') + '</div></section>'
        : '<p class="muted small">Need package, naming conventions, release, architecture or deployment notes? Switch to <button type="button" class="link" data-action="mode" data-mode="advanced">Advanced mode</button>.</p>') +
      nav(true, 'Continue');
  }

  function stat(label, html) { return '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-val">' + html + '</span></div>'; }

  function step5(s) {
    const ev = C.evaluate(s);
    const c = ev.counts;
    const dod = s.dod.map(function (d, i) {
      return '<div class="row dod-row"><input type="checkbox" data-check="dod.' + i + '.on"' + (d.on ? ' checked' : '') + ' aria-label="Include item ' + (i + 1) + '">' +
        '<input type="text" data-bind="dod.' + i + '.text" value="' + esc(d.text) + '" aria-label="Definition of done item ' + (i + 1) + '">' + rowRemove('remove-dod', i, 'item ' + (i + 1)) + '</div>';
    }).join('');
    const objLines = [c.existing + ' reuse', c.change + ' change', c.new + ' new'].concat(c.tbc ? [c.tbc + ' to confirm'] : []).join('<br>');
    return '<h2 class="step-title">' + STEPS[4].title + '</h2>' +
      statusHtml(ev, true) +
      '<div class="stats">' +
      stat('Objects', objLines) +
      stat('Technical design', c.specified + ' of ' + c.toSpecify + ' specified') +
      stat('Dependencies', c.dependencies + ' identified') +
      stat('Open questions', String(ev.questions.length)) +
      stat('Rules &amp; criteria', s.rules.filter(function (r) { return V.isFilled([r]); }).length + ' rules<br>' + s.acceptance.filter(function (a) { return a.text.trim(); }).length + ' criteria') + '</div>' +
      (ev.questions.length ? '<details class="more"' + detailsAttrs('questions', false) + '><summary>Open questions (' + ev.questions.length + ')</summary><ol class="small">' + ev.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></details>' : '') +
      (ev.optional.length ? '<p class="muted small">Optional information not specified: ' + ev.optional.map(function (r) { return esc(r.label.toLowerCase()); }).join(', ') + '.</p>' : '') +
      '<h3>Definition of done</h3><p class="muted small">Checked items are added to the document. Edit freely.</p>' + dod +
      '<button type="button" class="btn btn-ghost" data-action="add-dod">+ Add item</button>' +
      '<div class="nav-row"><button type="button" class="btn btn-ghost" data-action="back">Back</button><span class="spacer"></span>' +
      (ev.level === 'almost' ? '<button type="button" class="btn btn-ghost" data-action="missing">Add Missing Details</button>' : '') +
      '<button type="button" class="btn btn-primary btn-lg" data-action="generate"' + (ev.mandatory.length ? ' disabled' : '') + '>Generate Specification</button></div>' +
      (ev.mandatory.length ? '<p class="field-error" role="alert">Still needed: ' + ev.mandatory.map(function (r) { return esc(r.label.toLowerCase()); }).join(' and ') + '.</p>' : '');
  }

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

  function generatedView(s) {
    const md = M.build(s);
    return '<div class="gen-head"><h2 class="step-title">Your specification is ready</h2>' +
      '<p class="muted"><code>' + esc(M.filename(s)) + '</code> · put it in your project and reference it in Copilot Chat (<code>#file</code> in VS Code, or attach it in Eclipse ADT).</p></div>' +
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
      const opts = ['<option value="">' + esc(root.label) + '</option>'].concat(s.objects.filter(function (x) { return x.id !== o.id; }).map(function (x) {
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
      const html = ui.generated ? generatedView(s) : [step1, step2, step3, step4, step5][ui.step - 1](s);
      $('#main').innerHTML = '<p class="step-count">' + (ui.generated ? 'Done' : 'Step ' + ui.step + ' of 5') + '</p>' + html;
    });
    renderStepper();
    renderMap();
    document.body.classList.toggle('is-generated', ui.generated);
    document.body.classList.toggle('is-wide', !ui.generated && (ui.step === 3 || ui.step === 4));
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
      $('#pv-body').innerHTML = blank ? '<p class="muted">Your specification builds here as you fill in the form.</p>' : ui.raw ? '<pre>' + esc(md) + '</pre>' : M.toHtml(md);
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
    setTab('edit');
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
      if (sug && !/\.(name|purpose)$/.test(meta.path)) sug.innerHTML = suggestionsHtml(state);
    }
  });

  function blankObject(type, status, name, purpose) {
    return { id: S.uid(), type: type || 'Table', name: name || '', status: status || 'tbc', purpose: purpose || '', parent: '', detail: {} };
  }

  function addObject(type, status, name) {
    S.update(function (s) { s.objects.push(blankObject(type, status, name)); });
    renderMain();
    if (ui.step === 3) {
      const last = $$('#obj-rows .obj-row').pop();
      if (last) $('input[type="text"]', last).focus();
    }
  }

  function loadState(next, msg) {
    ST.save(S.get());
    S.replace(next);
    ui.step = 1;
    ui.generated = false;
    ui.showErrors = false;
    ui.open = {};
    ST.setCurrent(S.get().id);
    renderMain();
    if (msg) toast(msg);
  }

  function updateSteps(fn) { S.update(fn); renderMain(); }

  function arrayAt(s, path) {
    let a = S.getPath(s, path);
    if (!Array.isArray(a)) { a = []; S.setPath(s, path, a); }
    return a;
  }

  function focusFirst(prefix) {
    const el = $('[data-bind^="' + prefix + '"], [data-check^="' + prefix + '"]');
    if (el) el.focus();
  }

  /* Rows pasted from Excel / SE11: tab-separated (fallback ; or ,), columns in grid order. */
  function parseRows(text, columns) {
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    const sep = /\t/.test(text) ? '\t' : /;/.test(text) ? ';' : ',';
    return lines.map(function (l) {
      const cells = l.split(sep);
      const row = {};
      columns.forEach(function (c, i) {
        const v = (cells[i] || '').trim();
        if (!v) return;
        if (c.kind === 'check') row[c.id] = /^(x|yes|true|1|✓|y)$/i.test(v);
        else if (c.kind === 'select') {
          const o = c.options.filter(function (op) { return op.value.toLowerCase() === v.toLowerCase() || op.label.toLowerCase() === v.toLowerCase(); })[0];
          if (o) row[c.id] = o.value;
        } else row[c.id] = v;
      });
      return row;
    }).filter(V.isFilled);
  }

  /* Find a grid/records field definition from its state path (objects.N.detail.a.M.b / quality.x). */
  function fieldAt(path) {
    const s = S.get();
    const parts = path.split('.');
    let fields, i;
    if (parts[0] === 'objects') { fields = D.objectDef(s.objects[Number(parts[1])].type).fields; i = 3; }
    else { fields = parts[0] === 'quality' ? D.quality : D.advanced; i = 1; }
    let f = null;
    for (; i < parts.length; i++) {
      if (/^\d+$/.test(parts[i])) continue;
      f = (fields || []).filter(function (x) { return x.id === parts[i]; })[0];
      if (!f) return null;
      fields = f.fields;
    }
    return f;
  }

  /* ------------------------------------------------------------------ dialogs */
  function openDialog(id) {
    const dlg = $(id);
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }
  function closeDialogs() { $$('dialog').forEach(function (d) { if (d.open && d.close) d.close(); }); }

  function openDrafts() {
    const list = ST.list();
    $('#drafts-list').innerHTML = list.length ? '<ul class="draft-list">' + list.map(function (d) {
      return '<li><div><strong>' + esc(d.name) + '</strong><span class="muted small">' + esc((d.types || []).join(' + ') || 'no object selected') + ' · ' + new Date(d.updated).toLocaleString() + (d.id === S.get().id ? ' · current' : '') + '</span></div>' +
        '<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="resume" data-id="' + esc(d.id) + '">Resume</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="delete-draft" data-id="' + esc(d.id) + '">Delete</button></div></li>';
    }).join('') + '</ul>' : '<p class="empty">No saved drafts yet. Your work is saved automatically as you type.</p>';
    openDialog('#drafts-dialog');
  }

  function openExamples() {
    $('#examples-list').innerHTML = '<ul class="draft-list">' + T.examples().map(function (e) {
      const st = e.state;
      return '<li><div><strong><span class="module">' + esc(e.module) + '</span> ' + esc(e.label) + '</strong><span class="muted small">' + esc(st.types.map(function (t) { return D.types[t].label; }).join(' + ')) + ' · ' + st.objects.length + ' objects</span></div>' +
        '<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="load-example" data-id="' + esc(e.id) + '">Load</button></div></li>';
    }).join('') + '</ul>';
    openDialog('#examples-dialog');
  }

  /* ----------------------------------------------------------------- actions */
  function copyMarkdown() {
    Promise.resolve(X.copy(M.build(S.get()))).then(function (ok) { toast(ok ? 'Markdown copied to clipboard' : 'Copy failed – select the text in Markdown view instead'); });
  }

  const actions = {
    'toggle-type': function (el) {
      const t = el.dataset.type;
      const main = D.types[t].mainObject;
      S.update(function (s) {
        const i = s.types.indexOf(t);
        if (i >= 0) {
          s.types.splice(i, 1);
          // drop the main object we added automatically if nothing was entered for it
          s.objects = s.objects.filter(function (o) { return !(main.indexOf(o.type) >= 0 && o.status === 'new' && !o.name.trim() && !C.detailFilled(o) && o.purpose === 'Main ' + main[0]); });
        } else {
          s.types.push(t);
          if (!s.objects.some(function (o) { return main.indexOf(o.type) >= 0; })) s.objects.push(blankObject(main[0], 'new', '', 'Main ' + main[0]));
        }
      });
      renderMain();
    },
    goto: function (el) { setStep(Number(el.dataset.step)); },
    next: function () {
      if (ui.step === 1 && V.checkMandatory(S.get()).length) {
        ui.showErrors = true;
        renderMain();
        const bad = $('[aria-invalid="true"], .field-error');
        if (bad) bad.scrollIntoView({ block: 'center' });
        return;
      }
      setStep(ui.step + 1);
    },
    back: function () { setStep(ui.step - 1); },
    template: function (el) {
      const t = T.fromTemplate(el.dataset.id);
      const cur = S.get();
      if (!t) return;
      t.requirement = cur.requirement;
      t.project = cur.project;
      t.id = cur.id;
      S.replace(t);
      renderMain();
      toast('Template applied — name the objects in step 3');
    },
    examples: openExamples,
    'load-example': function (el) { closeDialogs(); loadState(T.example(el.dataset.id), 'Example loaded'); },
    new: function () { loadState(S.blank(), 'Started a new requirement'); },
    drafts: openDrafts,
    resume: function (el) {
      const d = ST.load(el.dataset.id);
      closeDialogs();
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
    mode: function (el) { ui.mode = el.dataset.mode; ST.setMode(ui.mode); ui.open = {}; renderMain(); },
    tab: function (el) { setTab(el.dataset.tab); },
    'add-object': function () { addObject('Table', 'existing'); },
    'add-chip': function (el) { addObject(el.dataset.type, el.dataset.status); },
    'add-ref': function (el) { addObject(el.dataset.type, 'new', el.dataset.name); toast(el.dataset.type + ' ' + el.dataset.name + ' added as new object'); },
    jump: function (el, e) {
      e.preventDefault();
      ui.open['obj:' + el.dataset.id] = true;
      const d = $('#obj-' + el.dataset.id);
      if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('summary', d).focus({ preventScroll: true }); }
    },
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
    'row-add': function (el) {
      const path = el.dataset.path;
      let n = 0;
      updateSteps(function (s) { const a = arrayAt(s, path); if (!a.length) a.push({}); a.push({}); n = a.length - 1; });
      focusFirst(path + '.' + n + '.');
    },
    'row-del': function (el) { const i = Number(el.dataset.i); updateSteps(function (s) { arrayAt(s, el.dataset.path).splice(i, 1); }); },
    'row-move': function (el) {
      const i = Number(el.dataset.i);
      updateSteps(function (s) { const a = arrayAt(s, el.dataset.path); if (i > 0) { const t = a[i - 1]; a[i - 1] = a[i]; a[i] = t; } });
    },
    'paste-rows': function (el) {
      const field = fieldAt(el.dataset.path);
      const src = $('#' + el.dataset.src);
      if (!field || !src) return;
      const rows = parseRows(src.value, field.columns);
      if (!rows.length) { toast('Nothing to add — paste tab-separated rows first'); return; }
      ui.open[el.dataset.src] = false;
      updateSteps(function (s) { const a = arrayAt(s, el.dataset.path).filter(V.isFilled); Array.prototype.push.apply(a, rows); S.setPath(s, el.dataset.path, a); });
      toast(rows.length + ' row(s) added');
    },
    'rec-add': function (el) {
      let n = 0;
      updateSteps(function (s) { const a = arrayAt(s, el.dataset.path); a.push({}); n = a.length - 1; });
      focusFirst(el.dataset.path + '.' + n + '.');
    },
    'rec-bulk': function (el) {
      const n = Math.max(1, Math.min(30, Number(($('#' + el.dataset.src) || {}).value) || 1));
      updateSteps(function (s) { const a = arrayAt(s, el.dataset.path); for (let k = 0; k < n; k++) a.push({}); });
      toast(n + ' added');
    },
    'rec-dup': function (el) {
      const i = Number(el.dataset.i);
      updateSteps(function (s) { const a = arrayAt(s, el.dataset.path); a.splice(i + 1, 0, JSON.parse(JSON.stringify(a[i] || {}))); });
    },
    'rec-del': function (el) {
      const i = Number(el.dataset.i);
      if (!window.confirm('Delete this entry and everything in it?')) return;
      updateSteps(function (s) { arrayAt(s, el.dataset.path).splice(i, 1); });
    },
    'add-rule': function () { updateSteps(function (s) { s.rules.push({ id: S.uid(), condition: '', behavior: '' }); }); focusLast('[data-bind$=".condition"]'); },
    'remove-rule': function (el) { updateSteps(function (s) { s.rules.splice(Number(el.dataset.i), 1); }); },
    'add-ac': function () { updateSteps(function (s) { s.acceptance.push({ id: S.uid(), text: '' }); }); focusLast('[data-bind^="acceptance."]'); },
    'remove-ac': function (el) { updateSteps(function (s) { s.acceptance.splice(Number(el.dataset.i), 1); }); },
    'add-dod': function () { updateSteps(function (s) { s.dod.push({ id: S.uid(), text: '', on: true }); }); focusLast('[data-bind^="dod."]'); },
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
    if (fn) fn(el, e);
  });

  document.addEventListener('toggle', function (e) {
    const d = e.target;
    if (d.tagName === 'DETAILS' && d.dataset.key) ui.open[d.dataset.key] = d.open;
  }, true);

  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.bind || t.type === 'radio' || t.tagName === 'SELECT') return;
    S.set(t.dataset.bind, t.value);
    const title = $('[data-title-of="' + t.dataset.bind + '"]');
    if (title) title.textContent = t.value;
    if (t.dataset.nameCheck !== undefined) {
      const o = S.get().objects[Number(t.dataset.nameCheck)];
      const w = $('#nw' + t.dataset.nameCheck);
      if (o && w) w.hidden = !namingWarning(o);
    }
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
      if (t.hasAttribute('data-rerender')) renderMain();
    } else if (t.id === 'import-file' && t.files && t.files[0]) {
      const file = t.files[0];
      file.text().then(function (text) {
        try { loadState(X.parseProject(text), 'Imported ' + file.name); } catch (err) { toast(err.message); }
      });
      t.value = '';
    }
  });

  /* Spreadsheet-like keys in grids: Enter = same column in next row (adds a row at the end). */
  document.addEventListener('keydown', function (e) {
    const t = e.target;
    if (e.key !== 'Enter' || e.shiftKey || !t.closest || t.tagName !== 'INPUT' || t.type !== 'text') return;
    const td = t.closest('.grid td');
    if (!td) return;
    e.preventDefault();
    const tr = td.parentElement;
    const col = Array.prototype.indexOf.call(tr.children, td);
    const next = tr.nextElementSibling;
    if (next) { const el = next.children[col].querySelector('input, select'); if (el) el.focus(); return; }
    const m = /^(.*)\.(\d+)\.([^.]+)$/.exec(t.dataset.bind);
    if (!m) return;
    const n = Number(m[2]) + 1;
    S.update(function (s) { const a = arrayAt(s, m[1]); while (a.length < n + 1) a.push({}); });
    renderMain();
    const el = $('[data-bind="' + m[1] + '.' + n + '.' + m[3] + '"]');
    if (el) el.focus();
  });

  $$('dialog').forEach(function (d) { d.addEventListener('click', function (e) { if (e.target === d) closeDialogs(); }); });

  /* ---------------------------------------------------------------- bootstrap */
  function renderDatalists() {
    $('#datalists').innerHTML = Object.keys(D.datalists).map(function (id) {
      return '<datalist id="' + id + '">' + D.datalists[id].map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
    }).join('');
  }

  async function init() {
    renderDatalists();
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
