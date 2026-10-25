/* Local persistence: localStorage in the browser, VS Code's extension storage in the VS Code panel (js/host.js).
   Nothing leaves the machine. */
(function (APB) {
  'use strict';
  const KEY_DRAFTS = 'apb.drafts.v1';
  const KEY_CURRENT = 'apb.current.v1';
  const memory = {};

  function read(key) {
    if (APB.host && APB.host.isVscode) return APB.host.storage.get(key);
    try { const v = window.localStorage.getItem(key); return v == null ? memory[key] || null : v; } catch (e) { return memory[key] || null; }
  }
  function write(key, value) {
    if (APB.host && APB.host.isVscode) return APB.host.storage.set(key, value);
    memory[key] = value;
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function drafts() {
    try { const d = JSON.parse(read(KEY_DRAFTS) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
  }

  function draftName(s) {
    if (s.kind === 'fs') return APB.fs.model.name(s);
    const n = s.project.name.trim() || s.requirement.text.trim().split(/\r?\n/)[0].slice(0, 60);
    return n || 'Untitled requirement';
  }

  /* A state with nothing typed is not worth keeping as a draft. */
  function isEmpty(s) {
    if (s.kind === 'fs') return APB.fs.model.isEmpty(s);
    return !s.types.length && !s.requirement.text.trim() && !s.objects.length && !s.rules.length && !s.project.name.trim();
  }

  const api = {
    list: function () {
      const d = drafts();
      return Object.keys(d).map(function (k) { return d[k]; }).sort(function (a, b) { return b.updated - a.updated; });
    },
    save: function (s) {
      if (isEmpty(s)) return false;
      const d = drafts();
      d[s.id] = { id: s.id, kind: s.kind === 'fs' ? 'fs' : 'dev', name: draftName(s), updated: Date.now(), types: s.types || [], module: s.kind === 'fs' ? s.context.module : '', state: s };
      write(KEY_CURRENT, s.id);
      return write(KEY_DRAFTS, JSON.stringify(d));
    },
    load: function (id) { const d = drafts()[id]; return d ? d.state : null; },
    remove: function (id) {
      const d = drafts();
      delete d[id];
      write(KEY_DRAFTS, JSON.stringify(d));
      if (read(KEY_CURRENT) === id) write(KEY_CURRENT, '');
    },
    currentId: function () { return read(KEY_CURRENT) || ''; },
    setCurrent: function (id) { write(KEY_CURRENT, id); },
    /* most recent draft of one kind ('fs' | 'dev'), used when switching modes */
    latest: function (kind) {
      return api.list().filter(function (d) { return (d.kind || 'dev') === kind; })[0] || null;
    },
    getPref: function (k, dflt) { const v = read('apb.pref.' + k); return v == null || v === '' ? dflt : v; },
    setPref: function (k, v) { write('apb.pref.' + k, v); },
    getTheme: function () {
      const t = read('apb.theme.v1');
      if (!t && APB.host && APB.host.isVscode) return APB.host.prefersDark() ? 'dark' : 'light'; // follow the VS Code theme
      return t === 'dark' ? 'dark' : 'light';
    },
    setTheme: function (t) { write('apb.theme.v1', t); },
    isEmpty: isEmpty
  };

  APB.storage = api;
})(window.APB = window.APB || {});
