/* UI: 5-step wizard, per-object builders, live preview, drafts. Plain DOM; state lives in state.js.
   Two modes share this shell: Technical (development spec, below) and Functional (js/fs-app.js), chosen by state.kind. */
(function (APB) {
  'use strict';

  const S = APB.state, D = APB.defs, C = APB.completeness, M = APB.markdown, ST = APB.storage, X = APB.exporter, T = APB.templates, V = APB.validation;
  const FA = APB.fsApp, FC = APB.fsCompleteness, FM = APB.fsMarkdown;

  const H = APB.host;
  function isFs() { return S.isFs(); }
  /* Inside the VS Code panel the hand-off goes straight to Copilot Chat; files go through a save dialog. */
  const VS_LABEL = H.isVscode ? 'Open in Copilot Chat' : 'Open in VS Code';
  function savedMsg(name) { return H.isVscode ? 'Choose where to save ' + name : 'Downloaded ' + name; }
  function steps() { return isFs() ? APB.fs.steps : STEPS; }
  function buildMd(s) { return s.kind === 'fs' ? FM.build(s) : M.build(s); }
  function evaluate(s) { return s.kind === 'fs' ? FC.evaluate(s) : C.evaluate(s); }
  function mandatoryMissing(s) { return s.kind === 'fs' ? FC.checkMandatory(s) : V.checkMandatory(s); }

  const STEPS = [
    { n: 1, title: 'What are you building?', label: 'Build' },
    { n: 2, title: 'Business requirement details', label: 'Requirement' },
    { n: 3, title: 'Which SAP objects are involved?', label: 'Objects' },
    { n: 4, title: 'Technical design per object', label: 'Specify' },
    { n: 5, title: 'Review and generate', label: 'Review' }
  ];

  /* Line icons (24px grid) for the development types. */
  const ICONS = {
    REPORT: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    CLASS: '<path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 3 1 1 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 3-1 1-2 1.5-2 3v2c0 2-1 3-3 3"/>',
    RFC: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    RAP: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    CDS: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    CAPM: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z"/>',
    DDIC: '<path d="M3 5h18v14H3zM3 10h18M9 10v9M15 10v9"/>',
    ENH: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
    ODATA: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
    FIORI: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    FORM: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>'
  };
  function icon(k) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[k] || ICONS.REPORT) + '</svg>'; }

  const ui = { step: 1, view: null, generated: false, raw: false, tab: 'edit', showErrors: false, open: {} };

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function idOf(path) { return 'f-' + path.replace(/[^a-z0-9]+/gi, '-'); }

  /* ------------------------------------------------------------------ toast */
  let toastTimer;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2800);
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
      return '<section class="rec" aria-labelledby="' + titleId + '"><div class="rec-head"><h5 id="' + titleId + '"><span class="rec-kind">' + esc(field.labelFor ? field.labelFor(recs, i) : field.itemLabel + ' ' + (i + 1)) + '</span> <span data-title-of="' + esc(rp + '.' + field.titleField) + '">' + esc(r[field.titleField] || '') + '</span></h5>' +
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
      html += '<details class="more"' + detailsAttrs(basePath + '#adv', false) + '><summary>Advanced details</summary><div class="form-grid">' +
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
        '<span class="type-ico">' + icon(k) + '</span><span class="type-name">' + esc(D.types[k].label) + '</span><span class="type-hint">' + esc(D.types[k].hint) + '</span></button>';
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

  /* RAP readiness: what would break activation, with one-click fixes (js/rap-blueprint.js). */
  const RAP_FIX = { 'admin-fields': '+ Add RAP admin fields to table & CDS', 'draft-table': '+ Add draft table' };
  function rapFindings(s, i) {
    const list = APB.rap.checks(s).filter(function (c) { return c.i === i; });
    if (!list.length) return '<p class="rap-ok">✓ RAP readiness: no findings. The specification includes the full RAP blueprint (artifacts, activation groups, behavior definition and behavior pool skeletons).</p>';
    const fixes = list.map(function (c) { return c.fix; }).filter(function (f, k, a) { return f && a.indexOf(f) === k; });
    return '<div class="refs rap-check" role="note"><strong>RAP readiness – ' + list.length + ' finding' + (list.length > 1 ? 's' : '') + '</strong> <span class="muted small">(each one would cost an activation round in ADT)</span><ul>' +
      list.map(function (c) { return '<li class="' + c.level + '">' + esc(c.text.replace(/^RAP [^:]+: /, '')) + '</li>'; }).join('') + '</ul>' +
      fixes.map(function (f) { return '<button type="button" class="chip" data-action="rap-fix" data-fix="' + f + '" data-i="' + i + '">' + RAP_FIX[f] + '</button>'; }).join(' ') + '</div>';
  }

  function artifactCard(o, i) {
    const def = D.objectDef(o.type);
    const draftTable = APB.rap.isDraftTable(S.get(), o);
    const builder = D.hasBuilder(o) && !draftTable;
    const done = draftTable || (builder ? C.detailFilled(o) : V.isFilled(o.detail.used));
    const base = 'objects.' + i + '.detail';
    let body;
    if (draftTable) {
      body = '<p class="rap-draft">Draft table of a RAP business object: it is generated from the behavior definition (ADT quick fix on <code>draft table</code>) with one field per CDS element plus <code>"%admin" : include sych_bdl_draft_admin_inc</code>. Only the name is needed — set it in step 3.</p>';
    } else if (builder) {
      body = (o.status === 'change' ? '<p class="note">Describe only what changes (new fields, new parameters, changed logic).</p>' : '') +
        (o.type === 'RAP' ? rapFindings(S.get(), i) : '') + fieldsBlock(def.fields, o.detail, base);
    } else {
      body = '<div class="form-grid">' + fieldHtml({ id: 'used', label: o.status === 'tbc' ? 'What would you need from it?' : 'What do you need from it?', kind: 'textarea', placeholder: def.usedHint }, o.detail, base, []) + '</div>' +
        (def.fields.length ? '<p class="muted small">Set the status to <strong>New</strong> or <strong>Existing – change</strong> in step 3 to get the full ' + esc(o.type) + ' designer.</p>' : '');
    }
    const rapIssues = builder && o.type === 'RAP' ? APB.rap.checks(S.get()).filter(function (c) { return c.i === i; }).length : 0;
    return '<details class="artifact" id="obj-' + o.id + '"' + detailsAttrs('obj:' + o.id, builder && (!done || rapIssues > 0)) + '>' +
      '<summary><span class="badge s-' + o.status + '">' + esc(D.statusLabel(o.status)) + '</span> <span class="a-type">' + esc(o.type) + (def.tcode ? ' <span class="tcode">' + esc(def.tcode) + '</span>' : '') + '</span> ' +
      '<span class="a-name">' + esc(o.name || '(no name yet)') + '</span>' + (o.purpose ? ' <span class="muted small a-purpose">' + esc(o.purpose) + '</span>' : '') +
      '<span class="a-state ' + (done && !rapIssues ? 'ok' : 'todo') + '">' + (rapIssues ? '⚠ ' + rapIssues + ' RAP finding' + (rapIssues > 1 ? 's' : '') : done ? '✓ specified' : builder ? 'to specify' : 'optional') + '</span></summary>' +
      '<div class="artifact-body">' + body + '</div></details>';
  }

  function step4(s) {
    const refs = C.unlistedReferences(s);
    const perfRelevant = D.performanceRelevant(s.types);
    // performance questions only where they matter (or when already answered)
    const quality = D.quality.filter(function (f) { return !f.perfOnly || perfRelevant || V.isFilled(s.quality[f.id]); });
    const index = s.objects.length ? '<nav class="obj-index" aria-label="Objects">' + s.objects.map(function (o) {
      const done = APB.rap.isDraftTable(s, o) || (D.hasBuilder(o) ? C.detailFilled(o) : true);
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

  /* Readiness ring: a visual cue only — no percentage, by design. */
  function ring(ev) {
    const C2 = 2 * Math.PI * 18;
    const p = Math.max(0.04, Math.min(1, ev.progress || 0));
    const glyph = ev.level === 'ready' ? '✓' : ev.level === 'almost' ? '…' : '·';
    return '<svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f99d"/><stop offset=".5" stop-color="#84bd00"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient></defs>' +
      '<circle class="track" cx="22" cy="22" r="18"/><circle class="val" cx="22" cy="22" r="18" stroke-dasharray="' + C2.toFixed(1) + '" stroke-dashoffset="' + (C2 * (1 - p)).toFixed(1) + '"/>' +
      '<text x="22" y="22">' + glyph + '</text></svg>';
  }

  function statusHtml(ev, detailed) {
    if (ev.level === 'blocked') {
      return '<div class="status is-blocked">' + ring(ev) + '<div><strong>Almost there</strong>' + (detailed ? '<p>Add ' + ev.mandatory.map(function (r) { return esc(r.label.toLowerCase()); }).join(' and ') + ' to get started.</p>' : '') + '</div></div>';
    }
    if (ev.level === 'almost') {
      return '<div class="status is-almost">' + ring(ev) + '<div><strong>A few details could improve the result</strong>' +
        '<p>Consider adding:</p><ul>' + ev.important.map(function (r) { return '<li>' + esc(r.label) + '</li>'; }).join('') + '</ul></div></div>';
    }
    if (isFs()) return '<div class="status is-ready">' + ring(ev) + '<div><strong>Ready for sign-off</strong>' + (detailed ? '<p>The specification covers the essentials for review and approval.</p>' : '') + '</div></div>';
    return '<div class="status is-ready">' + ring(ev) + '<div><strong>Ready for Copilot</strong>' + (detailed ? '<p>Your requirement contains the essential information.</p>' : '') + '</div></div>';
  }

  function generatedView(s) {
    const md = M.build(s);
    return '<div class="gen-head"><h2 class="step-title">Your specification is ready</h2>' +
      '<p class="muted">Not sure which VS Code agent to use? See <button type="button" class="link" data-action="agents">Agent workflows</button>.</p>' +
      '<p class="muted">Use <strong>' + VS_LABEL + '</strong> to ' + (H.isVscode ? 'hand the prompt to <code>dewa-abap</code> in Copilot Chat' : 'copy the prompt and jump straight into your project') + ', or download <code>' + esc(M.filename(s)) + '</code> into your project folder — <code>dewa-abap</code> reads it as its requirement source — and reference it in Copilot Chat (<code>#file</code> in VS Code, or attach it in Eclipse ADT).</p></div>' +
      '<div class="gen-actions"><button type="button" class="btn btn-primary btn-lg" data-action="vscode"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3 8 12l9 9 4-2V5z"/><path d="M8 12 3 8m5 4-5 4"/></svg> ' + VS_LABEL + '</button>' +
      '<button type="button" class="btn btn-ghost btn-lg" data-action="download">Download file</button>' +
      '<button type="button" class="btn btn-ghost" data-action="copy">Copy Markdown</button>' +
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
    const el = $('#stepper');
    el.style.setProperty('--p', ui.generated ? 1 : (ui.step - 1) / (steps().length - 1));
    el.innerHTML = steps().map(function (st) {
      const cur = !ui.generated && st.n === ui.step;
      const cls = cur ? 'is-current' : (ui.generated || st.n < ui.step) ? 'is-done' : '';
      return '<li><button type="button" data-action="goto" data-step="' + st.n + '"' + (cur ? ' aria-current="step"' : '') + ' class="' + cls + '"><span class="step-n">' + st.n + '</span><span class="step-l">' + st.label + '</span></button></li>';
    }).join('');
  }

  function renderMain() {
    const s = S.get();
    if (stream) { clearInterval(stream.timer); stream = null; }
    const info = ui.view === 'agents';
    keepFocus(function () {
      if (info) { $('#main').innerHTML = APB.agentsGuide.html(); return; }
      const html = isFs() ? (ui.generated ? FA.generatedView(s, ui) : FA.renderStep(ui.step, s, ui))
        : ui.generated ? generatedView(s) : [step1, step2, step3, step4, step5][ui.step - 1](s);
      $('#main').innerHTML = '<p class="step-count">' + (ui.generated ? 'Done' : 'Step ' + ui.step + ' of 5') + '</p>' + html;
    });
    applyChrome();
    renderStepper();
    renderMap();
    document.body.classList.toggle('is-info', info);
    document.body.classList.toggle('is-generated', ui.generated && !info);
    document.body.classList.toggle('is-wide', !info && !ui.generated && (isFs() ? ui.step >= 2 : ui.step === 3 || ui.step === 4));
    $('#hero').hidden = info || ui.generated || ui.step !== 1;
    renderPreview();
  }

  let pvQueued = false;
  function renderPreview() {
    if (pvQueued) return;
    pvQueued = true;
    requestAnimationFrame(function () {
      pvQueued = false;
      const s = S.get();
      const md = buildMd(s);
      $('#pv-status').innerHTML = statusHtml(evaluate(s), false);
      const blank = ST.isEmpty(s);
      $('#pv-body').innerHTML = blank ? '<p class="muted">Your ' + (isFs() ? 'functional ' : '') + 'specification builds here as you fill in the form.</p>' : ui.raw ? '<pre>' + esc(md) + '</pre>' : M.toHtml(md);
      $$('[data-action="view-rendered"]').forEach(function (b) { b.setAttribute('aria-pressed', String(!ui.raw)); });
      $$('[data-action="view-raw"]').forEach(function (b) { b.setAttribute('aria-pressed', String(ui.raw)); });
      if (ui.generated) {
        const g = $('.gen-doc');
        if (g) g.innerHTML = ui.raw ? '<pre>' + esc(md) + '</pre>' : M.toHtml(md);
      }
    });
  }

  function setStep(n) {
    ui.view = null;
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
    ui.view = null;
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
    if (isFs()) return APB.fs.fieldAtPath(path);
    const parts = path.split('.');
    let fields, i;
    if (parts[0] === 'objects') { fields = D.objectDef(s.objects[Number(parts[1])].type).fields; i = 3; }
    else { fields = D.quality; i = 1; }
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
      const fs = d.kind === 'fs';
      return '<li><div><strong><span class="module' + (fs ? ' kind-fs' : '') + '">' + (fs ? 'FS' : 'DEV') + '</span> ' + esc(d.name) + '</strong><span class="muted small">' + esc(fs ? (d.module || 'no module') : (d.types || []).join(' + ') || 'no object selected') + ' · ' + new Date(d.updated).toLocaleString() + (d.id === S.get().id ? ' · current' : '') + '</span></div>' +
        '<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="resume" data-id="' + esc(d.id) + '">Resume</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="delete-draft" data-id="' + esc(d.id) + '">Delete</button></div></li>';
    }).join('') + '</ul>' : '<p class="empty">No saved drafts yet. Your work is saved automatically as you type.</p>';
    openDialog('#drafts-dialog');
  }

  function openExamples() {
    if (isFs()) {
      $('#examples-list').innerHTML = '<ul class="draft-list">' + APB.fs.templates.examples().map(function (e) {
        const st = e.state;
        return '<li><div><strong><span class="module">' + esc(e.module) + '</span> ' + esc(e.label) + '</strong><span class="muted small">Functional specification · ' + (st.reqs.frs || []).length + ' FRs · ' + ((st.solution || {}).ricefw || []).length + ' RICEFW</span></div>' +
          '<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="load-example" data-id="' + esc(e.id) + '">Load</button></div></li>';
      }).join('') + '</ul>';
      openDialog('#examples-dialog');
      return;
    }
    $('#examples-list').innerHTML = '<ul class="draft-list">' + T.examples().map(function (e) {
      const st = e.state;
      return '<li><div><strong><span class="module">' + esc(e.module) + '</span> ' + esc(e.label) + '</strong><span class="muted small">' + esc(st.types.map(function (t) { return D.types[t].label; }).join(' + ')) + ' · ' + st.objects.length + ' objects</span></div>' +
        '<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="load-example" data-id="' + esc(e.id) + '">Load</button></div></li>';
    }).join('') + '</ul>';
    openDialog('#examples-dialog');
  }

  /* ----------------------------------------------------------------- actions */
  function copyMarkdown() {
    Promise.resolve(X.copy(buildMd(S.get()))).then(function (ok) { toast(ok ? 'Markdown copied to clipboard' : 'Copy failed – select the text in Markdown view instead'); });
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
      if (ui.step === 1 && mandatoryMissing(S.get()).length) {
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
    'load-example': function (el) { closeDialogs(); loadState(isFs() ? APB.fs.templates.example(el.dataset.id) : T.example(el.dataset.id), 'Example loaded'); },
    new: function () { loadState(S.blank(isFs() ? 'fs' : 'dev'), isFs() ? 'Started a new functional specification' : 'Started a new requirement'); },
    mode: function (el) {
      const want = el.dataset.mode === 'fs' ? 'fs' : 'dev';
      if ((isFs() ? 'fs' : 'dev') === want) { if (ui.view) { ui.view = null; renderMain(); } return; }
      const d = ST.latest(want);
      loadState(d ? d.state : S.blank(want), want === 'fs' ? 'Functional specification' : 'Technical development specification');
    },
    drafts: openDrafts,
    resume: function (el) {
      const d = ST.load(el.dataset.id);
      closeDialogs();
      if (d) loadState(d, 'Draft resumed');
    },
    'delete-draft': function (el) {
      const id = el.dataset.id;
      ST.remove(id);
      if (id === S.get().id) { S.replace(S.blank(isFs() ? 'fs' : 'dev')); ui.step = 1; ui.generated = false; renderMain(); }
      openDrafts();
      toast('Draft deleted');
    },
    share: function () {
      X.shareLink(S.get()).then(function (url) {
        return X.copy(url).then(function (ok) { toast(ok ? 'Share link copied (' + Math.ceil(url.length / 1024) + ' KB). Anyone with it can open this spec.' : 'Could not copy the link'); });
      }, function () { toast('Could not create a share link – use Copy Markdown instead'); });
    },
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
    'rap-fix': function (el) {
      let n = 0;
      updateSteps(function (s) { n = APB.rap.fix(s, Number(el.dataset.i), el.dataset.fix); });
      toast(n ? 'RAP fix applied (' + n + ' change' + (n > 1 ? 's' : '') + ') – review the table and CDS objects' : 'Nothing to add');
    },
    'add-rule': function () { updateSteps(function (s) { s.rules.push({ id: S.uid(), condition: '', behavior: '' }); }); focusLast('[data-bind$=".condition"]'); },
    'remove-rule': function (el) { updateSteps(function (s) { s.rules.splice(Number(el.dataset.i), 1); }); },
    'add-ac': function () { updateSteps(function (s) { s.acceptance.push({ id: S.uid(), text: '' }); }); focusLast('[data-bind^="acceptance."]'); },
    'remove-ac': function (el) { updateSteps(function (s) { s.acceptance.splice(Number(el.dataset.i), 1); }); },
    'add-dod': function () { updateSteps(function (s) { s.dod.push({ id: S.uid(), text: '', on: true }); }); focusLast('[data-bind^="dod."]'); },
    'remove-dod': function (el) { updateSteps(function (s) { s.dod.splice(Number(el.dataset.i), 1); }); },
    missing: function () {
      const ev = evaluate(S.get());
      const first = ev.important[0] || ev.optional[0];
      if (first) setStep(first.step);
    },
    generate: function () {
      if (mandatoryMissing(S.get()).length) return;
      ui.generated = true;
      renderMain();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#main').focus({ preventScroll: true });
      streamDoc();
    },
    'skip-stream': function () { stopStream(true); },
    start: function () {
      if (ui.step !== 1 || ui.generated) setStep(1);
      const r = $('#req') || $('#fs-req');
      if (r) { r.scrollIntoView({ behavior: 'smooth', block: 'center' }); r.focus({ preventScroll: true }); }
    },
    theme: function () {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      ST.setTheme(next);
      toast(next === 'light' ? 'Light theme' : 'Dark theme');
    },
    palette: openPalette,
    edit: function () { ui.view = null; ui.generated = false; ui.step = 5; renderMain(); },
    agents: function () {
      ui.view = 'agents';
      renderMain();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#main').focus({ preventScroll: true });
    },
    'close-info': function () { ui.view = null; renderMain(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    'info-jump': function (el, e) {
      e.preventDefault();
      const t = document.getElementById(el.dataset.id);
      if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
    },
    download: function () {
      const s = S.get();
      if (mandatoryMissing(s).length) { toast(isFs() ? (APB.fs.isSap(s) ? 'Add the business requirement and the module first' : 'Describe the business requirement first') : 'Add a requirement and a development object first'); return; }
      const name = isFs() ? FM.filename(s) : M.filename(s);
      // the file carries the builder data (hidden comment at the end), so Upload restores it exactly
      APB.mdImport.embed(buildMd(s), s).then(function (md) {
        X.download(name, md, 'text/markdown');
        toast(savedMsg(name));
      });
    },
    upload: function () {
      closeDialogs();
      const inp = $('#md-upload');
      inp.value = '';
      inp.click();
    },
    copy: copyMarkdown,
    vscode: function () {
      const s = S.get();
      if (isFs()) { FA.actions['fs-discover'](); return; }
      if (H.isVscode) {
        if (V.checkMandatory(s).length) { toast('Add a requirement and a development object first'); return; }
        H.post({ type: 'open-chat', agent: 'dewa-abap', prompt: M.chatPrompt(s) });
        toast('Copilot Chat opens with dewa-abap and the specification — review it and press Enter', 6000);
        return;
      }
      if (V.checkMandatory(s).length) { toast('Add a requirement and a development object first'); return; }
      const copied = X.copyNow(M.chatPrompt(s));
      X.launchVscode();
      toast(copied ? 'Prompt copied ✓ VS Code is opening — press Ctrl+Alt+I for Copilot Chat, then Ctrl+V' : 'VS Code is opening — copying failed, use Copy Markdown', 7000);
    },
    'view-raw': function () { ui.raw = true; renderPreview(); },
    'view-rendered': function () { ui.raw = false; renderPreview(); }
  };

  function focusLast(sel) { const els = $$('#main ' + sel); const el = els[els.length - 1]; if (el) el.focus(); }

  function setTab(tab) {
    ui.tab = tab;
    $('#layout').dataset.tab = tab;
    $$('.view-tabs [role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
  }

  /* ------------------------------------------------------- generation effects */
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stream = null;

  /* Reveal the finished document line by line, like an AI answer streaming in. Purely cosmetic. */
  function streamDoc() {
    const doc = $('.gen-doc');
    if (!doc || reduceMotion || ui.raw) { confetti(); return; }
    const lines = buildMd(S.get()).split('\n');
    const bar = document.createElement('div');
    bar.className = 'streambar';
    bar.innerHTML = '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span><span>Generating specification…</span><button type="button" class="btn btn-ghost btn-sm" data-action="skip-stream">Skip</button>';
    doc.parentNode.insertBefore(bar, doc);
    doc.classList.add('streaming');
    let n = 0;
    const step = Math.max(2, Math.ceil(lines.length / 45));
    stream = { bar: bar, doc: doc, timer: setInterval(function () {
      n += step;
      doc.innerHTML = M.toHtml(lines.slice(0, n).join('\n'));
      if (n >= lines.length) stopStream(false);
    }, 28) };
  }

  function stopStream(skipped) {
    if (!stream) return;
    clearInterval(stream.timer);
    stream.doc.classList.remove('streaming');
    stream.doc.innerHTML = M.toHtml(buildMd(S.get()));
    stream.bar.remove();
    stream = null;
    if (!skipped) confetti();
    toast('Specification ready ✦');
  }

  function confetti() {
    if (reduceMotion) return;
    const fx = $('#fx');
    const colors = ['#a3e635', '#84bd00', '#2dd4bf', '#d9f99d', '#8b5cf6', '#ffffff'];
    let html = '';
    for (let i = 0; i < 70; i++) {
      html += '<i style="left:' + (Math.random() * 100).toFixed(1) + 'vw;background:' + colors[i % colors.length] +
        ';--x:' + ((Math.random() - .5) * 30).toFixed(1) + 'vw;--r:' + Math.round(Math.random() * 900 - 450) + 'deg;--d:' + (1.2 + Math.random() * 1.3).toFixed(2) + 's;animation-delay:' + (Math.random() * .25).toFixed(2) + 's"></i>';
    }
    fx.innerHTML = html;
    setTimeout(function () { fx.innerHTML = ''; }, 3000);
  }

  /* Hero typewriter. */
  function startRotator() {
    let el = $('#rotator-text');
    if (!el || reduceMotion) return;
    const devWords = ['ABAP reports', 'RAP business objects', 'CDS view entities', 'RFC function modules', 'CAP services', 'DDIC tables', 'BAdI implementations', 'Fiori apps'];
    let w = 0, i = devWords[0].length, del = true;
    (function tick() {
      const target = $('#rotator-text');
      if (target !== el) { el = target; w = 0; i = 0; del = false; } // hero re-rendered for the other mode
      const words = isFs() ? FA.rotator : devWords;
      const word = words[w % words.length];
      if (!el) { setTimeout(tick, 400); return; }
      i += del ? -1 : 1;
      el.textContent = word.slice(0, i);
      let wait = del ? 35 : 70;
      if (!del && i === word.length) { del = true; wait = 1600; }
      else if (del && i <= 0) { del = false; w = (w + 1) % words.length; wait = 250; }
      setTimeout(tick, wait);
    })();
  }

  /* --------------------------------------------------------- command palette */
  let palItems = [], palIndex = 0;

  function commands() {
    const modeCmd = { g: 'Mode', i: '⇄', t: isFs() ? 'Switch to Technical (development spec)' : 'Switch to Functional (functional spec)', run: function () { actions.mode({ dataset: { mode: isFs() ? 'dev' : 'fs' } }); } };
    if (isFs()) {
      return FA.commands({ setStep: setStep, actions: actions, loadState: loadState }).concat([
        modeCmd,
        { g: 'Share', i: '🔗', t: 'Copy share link', run: actions.share },
        { g: 'Drafts', i: '☰', t: 'Saved drafts', run: openDrafts },
        { g: 'Drafts', i: '⬆', t: 'Upload .md file', run: actions.upload },
        { g: 'Info', i: 'ℹ', t: 'Agent workflows (dewa-fs-discovery, dewa-abap, dewa-codereview)', run: actions.agents },
        { g: 'View', i: '◐', t: 'Toggle light / dark theme', run: actions.theme }
      ]);
    }
    const list = [modeCmd,
      { g: 'Navigate', i: '1', t: 'Step 1 · What are you building?', run: function () { setStep(1); } },
      { g: 'Navigate', i: '2', t: 'Step 2 · Requirement details', run: function () { setStep(2); } },
      { g: 'Navigate', i: '3', t: 'Step 3 · SAP objects', run: function () { setStep(3); } },
      { g: 'Navigate', i: '4', t: 'Step 4 · Specify objects', run: function () { setStep(4); } },
      { g: 'Navigate', i: '5', t: 'Step 5 · Review & generate', run: function () { setStep(5); } },
      { g: 'Create', i: '✦', t: 'Generate specification', run: function () { setStep(5); actions.generate(); } },
      { g: 'Create', i: '+', t: 'New requirement', run: actions.new },
      { g: 'Create', i: '⬇', t: 'Download file', run: actions.download },
      { g: 'Create', i: '⧉', t: 'Copy Markdown', run: actions.copy },
      { g: 'Create', i: '›', t: H.isVscode ? 'Open in Copilot Chat (dewa-abap)' : 'Open in VS Code (copy prompt for Copilot Chat)', run: actions.vscode },
      { g: 'Share', i: '🔗', t: 'Copy share link', run: actions.share },
      { g: 'Drafts', i: '☰', t: 'Saved drafts', run: openDrafts },
      { g: 'Drafts', i: '⬆', t: 'Upload .md file', run: actions.upload },
      { g: 'Info', i: 'ℹ', t: 'Agent workflows (dewa-abap, dewa-codereview, dewa-fs-discovery)', run: actions.agents },
      { g: 'View', i: '◐', t: 'Toggle light / dark theme', run: actions.theme }
    ];
    T.examples().forEach(function (e) { list.push({ g: 'Example', i: e.module, t: e.label, run: function () { loadState(T.example(e.id), 'Example loaded'); } }); });
    D.typeKeys().forEach(function (k) {
      const on = S.get().types.indexOf(k) >= 0;
      list.push({ g: 'Build', i: '◇', t: (on ? 'Remove ' : 'Add ') + D.types[k].label, run: function () { actions['toggle-type']({ dataset: { type: k } }); } });
    });
    D.objectTypes.forEach(function (t) { list.push({ g: 'Object', i: '+', t: 'Add object: ' + t, run: function () { setStep(3); addObject(t, 'new'); } }); });
    return list;
  }

  function renderPalette() {
    const q = $('#palette-input').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    palItems = commands().filter(function (c) { return !(H.isVscode && c.run === actions.share); }).filter(function (c) { const h = (c.t + ' ' + c.g).toLowerCase(); return q.every(function (w) { return h.indexOf(w) >= 0; }); }).slice(0, 40);
    palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
    $('#palette-list').innerHTML = palItems.length ? palItems.map(function (c, i) {
      return '<li role="option" id="pal-' + i + '" data-pal="' + i + '" aria-selected="' + (i === palIndex) + '"><span class="p-ico" aria-hidden="true">' + esc(c.i) + '</span><span>' + esc(c.t) + '</span><span class="p-group">' + esc(c.g) + '</span></li>';
    }).join('') : '<li class="p-empty">No matching command</li>';
    $('#palette-input').setAttribute('aria-activedescendant', palItems.length ? 'pal-' + palIndex : '');
    const sel = $('#pal-' + palIndex);
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    closeDialogs();
    $('#palette-input').value = '';
    palIndex = 0;
    renderPalette();
    openDialog('#palette');
    $('#palette-input').focus();
  }

  function runPalette(i) {
    const c = palItems[i];
    if (!c) return;
    closeDialogs();
    c.run();
  }

  $('#palette-input').addEventListener('input', function () { palIndex = 0; renderPalette(); });
  $('#palette-input').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
  });
  $('#palette-list').addEventListener('click', function (e) { const li = e.target.closest('[data-pal]'); if (li) runPalette(Number(li.dataset.pal)); });
  $('#palette-list').addEventListener('mousemove', function (e) {
    const li = e.target.closest('[data-pal]');
    if (li && Number(li.dataset.pal) !== palIndex) { palIndex = Number(li.dataset.pal); renderPalette(); }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
    if (e.altKey && !ui.generated && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      setStep(ui.step + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });

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

  function uploadFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('This file is too large for a specification (max 5 MB)'); return; }
    file.text().then(APB.mdImport.read).then(function (r) {
      const what = r.state.kind === 'fs' ? 'Functional specification' : 'Technical specification';
      loadState(r.state, r.mode === 'partial' ? what + ' partly restored from the Markdown – check every step' :
        r.edited ? what + ' restored as generated – manual edits made in the file are not taken over' : what + ' restored from ' + file.name);
    }).catch(function (err) { toast((err && err.message) || 'The file could not be read', 7000); });
  }

  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t.id === 'md-upload') { uploadFile(t.files && t.files[0]); return; }
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
  /* Static lists from the config plus, in FS mode, the names found by system discovery (ds-tx, ds-obj). */
  function renderDatalists() {
    const lists = Object.assign({}, D.datalists, APB.discovery.datalists(isFs() ? S.get().discovery : null));
    $('#datalists').innerHTML = Object.keys(lists).map(function (id) {
      return '<datalist id="' + id + '">' + lists[id].map(function (v) {
        return typeof v === 'object' ? '<option value="' + esc(v.v) + '" label="' + esc(v.l) + '">' : '<option value="' + esc(v) + '">';
      }).join('') + '</datalist>';
    }).join('');
  }

  /* Header toggle, hero, preview title and actions follow the mode. */
  let chromeMode = null, devHero = '', devPvActions = '';
  function applyChrome() {
    const mode = isFs() ? 'fs' : 'dev';
    $$('[data-action="mode"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    if (mode === chromeMode) return;
    chromeMode = mode;
    document.body.dataset.kind = mode;
    $('#hero').innerHTML = mode === 'fs' ? FA.hero : devHero;
    $('.pv-actions').innerHTML = mode === 'fs' ? FA.previewActions : devPvActions;
    $('#pv-file').textContent = mode === 'fs' ? FA.fileLabel : 'Business requirement';
    document.title = mode === 'fs' ? 'SAP Functional Specification Builder' : 'SAP Development Specification Builder';
    if (mode === 'dev') $('#designer-count').textContent = D.objectTypes.filter(function (t) { return D.objectDef(t).fields.length; }).length;
    renderDatalists();
  }

  Object.assign(actions, FA.actions);

  /* Shared with js/fs-app.js. */
  APB.ui = {
    ui: ui, esc: esc, toast: toast, nav: nav, stat: stat, statusHtml: statusHtml, detailsAttrs: detailsAttrs,
    fieldsBlock: fieldsBlock, fieldHtml: fieldHtml, renderMain: renderMain, updateSteps: updateSteps, loadState: loadState,
    renderDatalists: renderDatalists, savedMsg: savedMsg
  };

  async function init() {
    document.body.classList.toggle('host-vscode', H.isVscode);
    devHero = $('#hero').innerHTML;
    devPvActions = $('.pv-actions').innerHTML.replace('Open in VS Code', VS_LABEL);
    renderDatalists();
    $('#designer-count').textContent = D.objectTypes.filter(function (t) { return D.objectDef(t).fields.length; }).length;
    document.documentElement.dataset.theme = ST.getTheme();
    startRotator();
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
