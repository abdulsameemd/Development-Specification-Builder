/* Functional → Technical link. A Technical spec created from a functional spec (RICEFW hand-off or "change the
   program") remembers its source: the FS key, which item it came from, and a snapshot of what the FS gave it.
   When the FS changes – also after an Upload – the Technical spec offers "Update from FS". The update is a
   three-way merge (snapshot / current / new): only what still equals the FS's earlier content is replaced, so
   whatever the developer added or edited stays. Nothing flows from Technical back to Functional. */
(function (APB) {
  'use strict';

  function str(v) { return typeof v === 'string' ? v : ''; }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* What the FS gave the Technical spec (only these parts are ever updated). */
  function snapshot(dev) {
    const q = dev.quality || {};
    return {
      text: str(dev.requirement.text), objective: str(dev.requirement.objective),
      rules: (dev.rules || []).map(ruleKey),
      acceptance: (dev.acceptance || []).map(function (a) { return str(a.text); }),
      objects: (dev.objects || []).map(function (o) { return { type: o.type, name: str(o.name).toUpperCase(), status: o.status, purpose: str(o.purpose) }; }),
      assumptions: str(dev.assumptions), tests: str(q.testScenarios), performance: str(q.performanceReq)
    };
  }
  function ruleKey(r) { return str(r.condition) + '\u0001' + str(r.behavior); }

  function normalizeSource(src) {
    if (!src || typeof src !== 'object' || typeof src.fsKey !== 'string' || !src.ref || typeof src.ref !== 'object') return null;
    const ref = src.ref.kind === 'program' ? { kind: 'program', name: str(src.ref.name) } : { kind: 'ricefw', name: str(src.ref.name), type: str(src.ref.type), index: Number(src.ref.index) || 0 };
    return { fsKey: src.fsKey, fsName: str(src.fsName), ref: ref, label: str(src.label), base: src.base && typeof src.base === 'object' ? JSON.parse(JSON.stringify(src.base)) : null, at: str(src.at) };
  }

  /* ------------------------------------------------------------ the FS side */
  /* Where in the FS the Technical spec came from: the RICEFW item by name (else type + position), or the program. */
  function derive(fs, ref) {
    const FA = APB.fsApp;
    if (ref.kind === 'program') {
      const dev = FA.toDevSpecFromProgram(fs);
      return dev && dev.objects[0].name === ref.name.toUpperCase() ? dev : null;
    }
    const list = fs.solution.ricefw || [];
    let i = ref.name ? list.findIndex(function (r) { return r && str(r.name).trim().toUpperCase() === ref.name.toUpperCase(); }) : -1;
    if (i < 0 && list[ref.index] && list[ref.index].type === ref.type) i = ref.index;
    return i >= 0 ? FA.toDevSpec(fs, i) : null;
  }

  function refOf(fs, kind, i) {
    if (kind === 'program') return { kind: 'program', name: APB.fsApp.toDevSpecFromProgram(fs).objects[0].name };
    const r = fs.solution.ricefw[i] || {};
    return { kind: 'ricefw', name: str(r.name).trim().toUpperCase(), type: str(r.type), index: i };
  }

  /* Called by the hand-off: dev was just created from fs. */
  function stamp(dev, fs, kind, i) {
    const ref = refOf(fs, kind, i);
    dev.source = {
      fsKey: fs.key, fsName: APB.fs.model.name(fs), ref: ref,
      label: kind === 'program' ? 'change ' + ref.name : APB.fs.ricefwIds(fs.solution.ricefw)[i] + (ref.name ? ' ' + ref.name : ''),
      base: snapshot(dev), at: today()
    };
    return dev;
  }

  function load(id) { const raw = APB.storage.load(id); return raw ? APB.state.migrate(raw) : null; }

  /* The newest FS draft with this key (an uploaded or shared copy keeps the key). */
  function findFs(key) {
    const ST = APB.storage;
    const cur = APB.state.get();
    // the FS on screen is the newest copy (an upload is saved to Drafts only a moment later)
    let best = cur && cur.kind === 'fs' && cur.key === key ? { state: cur, updated: Infinity } : null;
    ST.list().forEach(function (d) {
      if (d.kind !== 'fs') return;
      const s = cur && cur.id === d.id ? cur : load(d.id);
      if (s && s.key === key && (!best || d.updated > best.updated)) best = { state: s, updated: d.updated };
    });
    return best ? best.state : null;
  }

  /* → { state: 'none' | 'missing' | 'gone' | 'current' | 'changed', fs, next, changes[] } */
  function status(dev) {
    const src = dev && dev.source;
    if (!src) return { state: 'none' };
    const fs = findFs(src.fsKey);
    if (!fs) return { state: 'missing' };
    const next = derive(fs, src.ref);
    if (!next) return { state: 'gone', fs: fs };
    const a = src.base, b = snapshot(next);
    if (JSON.stringify(a) === JSON.stringify(b)) return { state: 'current', fs: fs, next: next };
    return { state: 'changed', fs: fs, next: next, changes: describe(a || {}, b) };
  }

  function describe(a, b) {
    const out = [];
    const added = function (x, y) { return (y || []).filter(function (v) { return (x || []).indexOf(v) < 0; }).length; };
    if (a.text !== b.text) out.push('requirement text');
    if (a.objective !== b.objective) out.push('objective');
    const ac = added(a.acceptance, b.acceptance), ru = added(a.rules, b.rules);
    if (ac) out.push('+' + ac + ' acceptance criteri' + (ac > 1 ? 'a' : 'on'));
    if (ru) out.push('+' + ru + ' rule' + (ru > 1 ? 's' : ''));
    const names = function (l) { return (l || []).map(function (o) { return o.name; }); };
    const no = added(names(a.objects), names(b.objects));
    if (no) out.push('+' + no + ' object' + (no > 1 ? 's' : ''));
    if (a.tests !== b.tests) out.push('test scenarios');
    if (!out.length) out.push('details');
    return out;
  }

  /* ---------------------------------------------------------------- update */
  function update(dev) {
    const st = status(dev);
    if (st.state !== 'changed' && st.state !== 'current') return null;
    const base = dev.source.base || snapshot({ requirement: {}, rules: [], acceptance: [], objects: [] });
    const nb = snapshot(st.next);
    const next = JSON.parse(JSON.stringify(dev));
    const kept = [], added = [];
    function scalar(label, get, set, b, n) {
      const curV = get(next);
      if (curV === b || !curV.trim()) { if (curV !== n) set(next, n); }
      else if (n !== b) kept.push(label);
    }
    scalar('your edited requirement text', function (s) { return s.requirement.text; }, function (s, v) { s.requirement.text = v; }, base.text, nb.text);
    scalar('your edited objective', function (s) { return s.requirement.objective; }, function (s, v) { s.requirement.objective = v; }, base.objective, nb.objective);
    scalar('your edited assumptions', function (s) { return s.assumptions; }, function (s, v) { s.assumptions = v; }, base.assumptions, nb.assumptions);
    next.quality = next.quality || {};
    scalar('your edited test scenarios', function (s) { return str(s.quality.testScenarios); }, function (s, v) { s.quality.testScenarios = v; }, base.tests, nb.tests);
    scalar('your edited performance', function (s) { return str(s.quality.performanceReq); }, function (s, v) { s.quality.performanceReq = v; }, base.performance, nb.performance);

    // lists: keep own / edited items, drop FS items the developer deleted, add what is new in the FS
    function list(items, key, baseKeys, newItems, make, label) {
      const curKeys = items.map(key);
      const removed = baseKeys.filter(function (k) { return curKeys.indexOf(k) < 0; });
      const own = items.filter(function (it) { return baseKeys.indexOf(key(it)) < 0; });
      const fromFs = newItems.filter(function (it) { return removed.indexOf(key(it)) < 0 || baseKeys.indexOf(key(it)) < 0; });
      const merged = [];
      // FS items in the FS order, each own item after them
      fromFs.forEach(function (it) { const i = curKeys.indexOf(key(it)); merged.push(i >= 0 ? items[i] : make(it)); });
      own.forEach(function (it) { if (merged.indexOf(it) < 0) merged.push(it); });
      const n = fromFs.filter(function (it) { return curKeys.indexOf(key(it)) < 0; }).length;
      if (n) added.push(n + ' ' + label);
      return merged;
    }
    next.rules = list(next.rules, ruleKey, base.rules, st.next.rules, function (r) { return { id: APB.state.uid(), condition: r.condition, behavior: r.behavior }; }, 'rule(s)');
    next.acceptance = list(next.acceptance, function (a) { return str(a.text); }, base.acceptance, st.next.acceptance, function (a) { return { id: APB.state.uid(), text: a.text }; }, 'acceptance criteria');

    // objects by name: existing ones keep everything the developer specified
    const have = next.objects.map(function (o) { return str(o.name).toUpperCase(); });
    st.next.objects.forEach(function (o) {
      if (have.indexOf(str(o.name).toUpperCase()) >= 0) return;
      next.objects.push({ id: APB.state.uid(), type: o.type, name: o.name, status: o.status, purpose: o.purpose, parent: '', detail: {} });
      added.push('object ' + o.name);
    });
    const nowNames = nb.objects.map(function (o) { return o.name; });
    const dropped = base.objects.map(function (o) { return o.name; }).filter(function (n) { return n && nowNames.indexOf(n) < 0 && have.indexOf(n) >= 0; });

    next.source = Object.assign({}, dev.source, { base: nb, at: today(), fsName: APB.fs.model.name(st.fs) });
    return { state: APB.state.migrate(next), kept: kept, added: added, dropped: dropped };
  }

  /* "Keep my version": accept the current FS as the new baseline without changing the content. */
  function dismiss(dev) {
    const st = status(dev);
    if (!st.next) return null;
    const next = JSON.parse(JSON.stringify(dev));
    next.source = Object.assign({}, dev.source, { base: snapshot(st.next), at: today() });
    return APB.state.migrate(next);
  }

  /* Technical drafts created from this FS, with their status. */
  function linkedTo(fs) {
    if (!fs || !fs.key) return [];
    const ST = APB.storage;
    return ST.list().filter(function (d) { return d.kind !== 'fs'; }).map(function (d) { return load(d.id); })
      .filter(function (s) { return s && s.source && s.source.fsKey === fs.key; })
      .map(function (s) { const st = status(s); return { id: s.id, label: s.source.label || s.project.name, state: st.state }; });
  }

  APB.specLink = { normalizeSource: normalizeSource, snapshot: snapshot, stamp: stamp, status: status, update: update, dismiss: dismiss, linkedTo: linkedTo, findFs: findFs };
})(window.APB = window.APB || {});
