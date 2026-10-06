/* Browser-only persistence (localStorage). Nothing leaves the machine. */
(function (APB) {
  'use strict';
  const KEY_DRAFTS = 'apb.drafts.v1';
  const KEY_CURRENT = 'apb.current.v1';
  const KEY_MODE = 'apb.mode.v1';
  const memory = {};

  function read(key) {
    try { const v = window.localStorage.getItem(key); return v == null ? memory[key] || null : v; } catch (e) { return memory[key] || null; }
  }
  function write(key, value) {
    memory[key] = value;
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function drafts() {
    try { const d = JSON.parse(read(KEY_DRAFTS) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
  }

  function draftName(s) {
    const n = s.project.name.trim() || s.requirement.text.trim().split(/\r?\n/)[0].slice(0, 60);
    return n || 'Untitled requirement';
  }

  /* A state with nothing typed is not worth keeping as a draft. */
  function isEmpty(s) {
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
      d[s.id] = { id: s.id, name: draftName(s), updated: Date.now(), types: s.types, state: s };
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
    getMode: function () { return read(KEY_MODE) === 'advanced' ? 'advanced' : 'quick'; },
    setMode: function (m) { write(KEY_MODE, m); },
    isEmpty: isEmpty
  };

  APB.storage = api;
})(window.APB = window.APB || {});
