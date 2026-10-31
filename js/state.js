/* Specification model + tiny observable store. The model is tool-neutral:
   GitHub Copilot is only an output profile (see markdown-generator.js). */
(function (APB) {
  'use strict';

  const SCHEMA_VERSION = 2;

  function uid() {
    return 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function getPath(obj, path) {
    return String(path).split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function setPath(obj, path, value) {
    const keys = String(path).split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = value;
  }

  function defaultDod() {
    return APB.config.definitions.definitionOfDone.map(function (text) { return { id: uid(), text: text, on: true }; });
  }

  /* kind 'fs' = functional specification (js/fs-state.js); anything else is the technical development spec. */
  function blank(kind) {
    if (kind === 'fs') return APB.fs.model.blank();
    const now = Date.now();
    return {
      schema: SCHEMA_VERSION,
      id: uid(),
      project: { name: '' },
      types: [],
      requirement: { text: '', objective: '', users: '', expectedOutput: '' },
      objects: [],
      rules: [],
      acceptance: [],
      assumptions: '',
      source: null,
      quality: { authorization: '', authChecks: [], dataVolume: '', performanceReq: '', testTypes: ['Unit', 'Functional', 'Integration'], testScenarios: '', cleanCore: '', cleanCoreNote: '' },
      dod: defaultDod(),
      meta: { created: now, updated: now }
    };
  }

  /* Coerce anything (imported JSON, old drafts) into a valid state. Unknown keys are dropped. */
  function migrate(input) {
    if (input && input.kind === 'fs') return APB.fs.model.migrate(input);
    const base = blank();
    if (!input || typeof input !== 'object') return base;
    const s = base;
    const known = APB.config.definitions.devTypes;
    s.id = typeof input.id === 'string' && input.id ? input.id : s.id;
    s.project.name = str(getPath(input, 'project.name'));
    s.types = Array.isArray(input.types) ? input.types.filter(function (t) { return known[t]; }) : [];
    ['text', 'objective', 'users', 'expectedOutput'].forEach(function (k) { s.requirement[k] = str(getPath(input, 'requirement.' + k)); });
    s.objects = arr(input.objects).map(function (o) {
      return {
        id: str(o.id) || uid(), type: APB.config.definitions.objectTypes[o.type] ? o.type : 'Other', name: str(o.name),
        status: ['existing', 'change', 'new', 'tbc'].indexOf(o.status) >= 0 ? o.status : 'tbc',
        purpose: str(o.purpose), parent: str(o.parent),
        detail: o.detail && typeof o.detail === 'object' ? clone(o.detail) : {}
      };
    });
    s.rules = arr(input.rules).map(function (r) { return { id: str(r.id) || uid(), condition: str(r.condition), behavior: str(r.behavior) }; });
    s.acceptance = arr(input.acceptance).map(function (a) { return { id: str(a.id) || uid(), text: str(a.text) }; });
    s.assumptions = str(input.assumptions);
    // link to the functional spec it was created from (spec-link.js); null for specs written directly
    s.source = APB.specLink ? APB.specLink.normalizeSource(input.source) : null;
    if (input.quality && typeof input.quality === 'object') Object.assign(s.quality, clone(input.quality));
    // schema 1 kept a single authorization object text
    if (s.quality.authObject && !s.quality.authChecks.length) s.quality.authChecks = [{ object: s.quality.authObject }];
    delete s.quality.authObject;
    if (!Array.isArray(s.quality.authChecks)) s.quality.authChecks = [];
    if (Array.isArray(input.dod)) s.dod = input.dod.map(function (d) { return { id: str(d.id) || uid(), text: str(d.text), on: d.on !== false }; });
    if (input.meta && typeof input.meta === 'object') {
      s.meta.created = Number(input.meta.created) || s.meta.created;
      s.meta.updated = Number(input.meta.updated) || s.meta.updated;
    }
    return s;
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }

  /* ---- store ---- */
  let current = blank();
  const listeners = [];

  function emit(meta) { listeners.forEach(function (fn) { fn(current, meta || {}); }); }

  APB.state = {
    uid: uid,
    getPath: getPath,
    setPath: setPath,
    blank: blank,
    migrate: migrate,
    get: function () { return current; },
    subscribe: function (fn) { listeners.push(fn); },
    set: function (path, value) {
      setPath(current, path, value);
      current.meta.updated = Date.now();
      emit({ path: path });
    },
    update: function (fn) {
      fn(current);
      current.meta.updated = Date.now();
      emit({ structural: true });
    },
    isFs: function (s) { return (s || current).kind === 'fs'; },
    replace: function (next) {
      current = migrate(next);
      emit({ replaced: true, structural: true });
    }
  };
})(window.APB = window.APB || {});
