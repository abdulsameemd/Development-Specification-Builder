/* Functional Specification (FS) mode: configuration accessors, document model and templates.
   An FS state is { kind: 'fs', context, process, reqs, solution, quality, control, discovery, … };
   each section is a plain bag of values keyed by the field ids in config/fs-definitions.json. */
(function (APB) {
  'use strict';

  const cfg = APB.config.fsDefinitions;
  const tpl = APB.config.fsTemplates;
  const SCHEMA_VERSION = 1;

  /* "optionsRef": "modules" → the shared option list, resolved once. */
  (function resolveRefs(fields) {
    fields.forEach(function (f) {
      if (f.optionsRef) f.options = cfg[f.optionsRef];
      if (f.fields) resolveRefs(f.fields);
    });
  })(cfg.sections.reduce(function (all, s) { return all.concat(s.fields); }, []));

  const sections = {};
  cfg.sections.forEach(function (s) { sections[s.id] = s; });

  function field(sectionId, fieldId) {
    return ((sections[sectionId] || {}).fields || []).filter(function (f) { return f.id === fieldId; })[0] || null;
  }

  /* Field definition for a state path such as reqs.frs.0.acceptance or process.toBe (grids/records only nest). */
  function fieldAtPath(path) {
    const parts = String(path).split('.');
    let fields = (sections[parts[0]] || {}).fields;
    let f = null;
    for (let i = 1; i < parts.length; i++) {
      if (/^\d+$/.test(parts[i])) continue;
      f = (fields || []).filter(function (x) { return x.id === parts[i]; })[0];
      if (!f) return null;
      fields = f.fields;
    }
    return f;
  }

  function ricefwType(value) { return cfg.ricefw.filter(function (r) { return r.value === value; })[0] || cfg.ricefw[0]; }

  /* ---------------------------------------------------------------- model */
  function uid() { return APB.state.uid(); }
  function today() { return new Date().toISOString().slice(0, 10); }

  function blank() {
    const now = Date.now();
    const s = { kind: 'fs', schema: SCHEMA_VERSION, id: uid(), discovery: null, meta: { created: now, updated: now } };
    cfg.sections.forEach(function (sec) { s[sec.id] = {}; });
    s.control.version = '0.1';
    s.control.status = 'draft';
    return s;
  }

  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /* Keep only known fields, coerced to the type their kind expects. */
  function coerce(fields, input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    fields.forEach(function (f) {
      const v = input[f.id];
      if (v === undefined) return;
      switch (f.kind) {
        case 'check': out[f.id] = v === true; break;
        case 'multicheck': out[f.id] = Array.isArray(v) ? v.map(str) : []; break;
        case 'grid':
          out[f.id] = Array.isArray(v) ? v.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
            const row = {};
            f.columns.forEach(function (c) { if (r[c.id] !== undefined) row[c.id] = c.kind === 'check' ? r[c.id] === true : str(r[c.id]); });
            return row;
          }) : [];
          break;
        case 'records':
          out[f.id] = Array.isArray(v) ? v.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) { return coerce(f.fields, r); }) : [];
          break;
        default: out[f.id] = str(v);
      }
    });
    return out;
  }

  function migrate(input) {
    const s = blank();
    if (!input || typeof input !== 'object') return s;
    s.id = typeof input.id === 'string' && input.id ? input.id : s.id;
    cfg.sections.forEach(function (sec) { Object.assign(s[sec.id], coerce(sec.fields, input[sec.id])); });
    if (!s.control.status) s.control.status = 'draft';
    s.discovery = input.discovery && APB.discovery ? APB.discovery.normalize(input.discovery).pack : null;
    if (input.meta && typeof input.meta === 'object') {
      s.meta.created = Number(input.meta.created) || s.meta.created;
      s.meta.updated = Number(input.meta.updated) || s.meta.updated;
    }
    return s;
  }

  function isEmpty(s) {
    const c = s.context || {};
    return !str(c.requirement).trim() && !str(c.title).trim() && !c.module && !((s.reqs || {}).frs || []).length && !((s.process || {}).toBe || []).length;
  }

  function name(s) {
    const c = s.context || {};
    return str(c.title).trim() || str(c.requirement).trim().split(/\r?\n/)[0].slice(0, 60) || 'Untitled functional specification';
  }

  /* FR-01, FR-02 … (two digits keep tables sortable). */
  function frId(i) { return 'FR-' + (i < 9 ? '0' : '') + (i + 1); }

  /* RICEFW ids numbered per type: R-01, E-01, UI-01 … */
  function ricefwIds(items) {
    const n = {};
    return (items || []).map(function (r) {
      const code = ricefwType(r && r.type).code;
      n[code] = (n[code] || 0) + 1;
      return code + '-' + (n[code] < 10 ? '0' : '') + n[code];
    });
  }

  /* "FR-1, fr 03" → ['FR-01', 'FR-03'] */
  function parseFrRefs(text) {
    const out = [];
    String(text || '').replace(/FR[\s-]*0*(\d+)/gi, function (_, d) { const id = frId(Number(d) - 1); if (out.indexOf(id) < 0) out.push(id); return _; });
    return out;
  }

  /* ------------------------------------------------------------- templates */
  function fromTemplate(id, current) {
    const t = tpl.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return null;
    const next = JSON.parse(JSON.stringify(current));
    Object.keys(t.data).forEach(function (sec) {
      next[sec] = next[sec] || {};
      Object.keys(t.data[sec]).forEach(function (k) {
        const v = t.data[sec][k];
        const have = next[sec][k];
        // never overwrite what the consultant typed; lists are only filled when empty
        if (Array.isArray(v)) { if (!Array.isArray(have) || !have.some(APB.validation.isFilled)) next[sec][k] = JSON.parse(JSON.stringify(v)); }
        else if (!str(have).trim()) next[sec][k] = v;
      });
    });
    return migrate(next);
  }

  function example(id) {
    const e = tpl.examples.filter(function (x) { return x.id === id; })[0] || tpl.examples[0];
    const s = migrate(JSON.parse(JSON.stringify(e.state)));
    s.id = uid();
    if (!(s.control.history || []).length) s.control.history = [{ version: s.control.version || '0.1', date: today(), author: s.control.author || '', change: 'First draft' }];
    return s;
  }

  APB.fs = {
    cfg: cfg,
    steps: cfg.steps,
    sections: cfg.sections,
    section: function (id) { return sections[id]; },
    stepSections: function (n) { return cfg.sections.filter(function (s) { return s.step === n; }); },
    field: field,
    fieldAtPath: fieldAtPath,
    ricefwType: ricefwType,
    frId: frId,
    ricefwIds: ricefwIds,
    parseFrRefs: parseFrRefs,
    today: today,
    model: { blank: blank, migrate: migrate, isEmpty: isEmpty, name: name },
    templates: {
      list: function () { return tpl.templates; },
      examples: function () { return tpl.examples; },
      fromTemplate: fromTemplate,
      example: example
    }
  };
})(window.APB = window.APB || {});
