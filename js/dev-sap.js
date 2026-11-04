/* "Check & read in SAP" for development (Technical) specs. The browser never talks to SAP: Copilot reads the system
   READ-ONLY through the SAP MCP servers (automatically in VS Code, in Copilot Chat with dewa-fs-discovery, or via a
   copied prompt) and answers with a dewa-dev-context JSON. This module builds the prompt, validates the answer
   (untrusted input), previews it for review and applies only what the developer picks:
   - the reference check (✓ in system · ✗ not found · ⚠ already exists) per object name;
   - status of "To Be Confirmed" objects → Existing (found) or New (not found);
   - what an existing object looks like today (o.sap: summary, designer-shaped details, uses / used by) – kept
     apart from the developer's own designer fields, which are never changed. */
(function (APB) {
  'use strict';

  const MARK = 'DEV-CONTEXT v1';
  const KIND = 'dewa-dev-context';
  const MAX_TEXT = 400000;
  const MAX_READ = 10;
  const NAME_RE = /^[A-Z0-9_\/]{1,40}$/;
  const RESULTS = ['verified', 'missing', 'clash'];

  function D() { return APB.defs; }
  function str(v, max) { return (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').trim().slice(0, max || 2000); }
  function upper(n) { return str(n, 60).toUpperCase(); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function arr(v, max) { return (Array.isArray(v) ? v : []).slice(0, max || 50); }
  function names(v, max) {
    const out = [];
    arr(v, max || 30).forEach(function (x) { const n = upper(typeof x === 'object' && x ? x.name : x); if (NAME_RE.test(n) && out.indexOf(n) < 0) out.push(n); });
    return out;
  }

  /* Objects whose current state is worth reading: reused, changed or still unconfirmed, with a name. */
  function readTargets(s) {
    return s.objects.filter(function (o) { return o.name.trim() && o.status !== 'new' && !(APB.rap && APB.rap.isDraftTable(s, o)); }).slice(0, MAX_READ);
  }
  function checkTargets(s) { return s.objects.filter(function (o) { return o.name.trim(); }); }

  /* Designer field ids (and grid columns / record fields) the answer may use for a type. */
  function schemaLine(type) {
    const fields = D().objectDef(type).fields || [];
    if (!fields.length) return '';
    return fields.filter(function (f) { return f.id !== 'used'; }).map(function (f) {
      const sub = f.kind === 'grid' ? f.columns : f.kind === 'records' ? f.fields : null;
      return f.id + (sub ? '[' + sub.map(function (c) { return c.id; }).join(', ') + ']' : '');
    }).join('; ');
  }

  function prompt(s) {
    const st = { existing: 'Existing – reuse', change: 'Existing – change', new: 'New (check that the name is free)', tbc: 'To Be Confirmed (does it exist?)' };
    const all = checkTargets(s);
    const read = readTargets(s);
    const types = [];
    read.forEach(function (o) { if (types.indexOf(o.type) < 0 && schemaLine(o.type)) types.push(o.type); });
    return [MARK,
      'Check the object names below in the SAP system and read the existing objects, READ-ONLY, for a development specification that GitHub Copilot (dewa-abap) will implement.',
      '',
      s.types.length ? 'Development: ' + s.types.map(function (t) { return (D().types[t] && D().types[t].label) || t; }).join(', ') : '',
      s.requirement.text.trim() ? 'Requirement (why the developer asks):\n' + s.requirement.text.trim().slice(0, 3000) : '',
      '',
      'Objects to check (every name):',
      all.map(function (o, i) { return (i + 1) + '. ' + o.type + ' ' + o.name.trim().toUpperCase() + ' – ' + st[o.status]; }).join('\n') || '(none)',
      '',
      read.length ? 'Objects to read (current state): ' + read.map(function (o) { return o.name.trim().toUpperCase(); }).join(', ') : 'Nothing to read – only check the names.',
      types.length ? '\nDetail fields per type (use only these ids; grids and records are arrays of objects with the ids in [ ]):\n' + types.map(function (t) { return '- ' + t + ': ' + schemaLine(t); }).join('\n') : '',
      '',
      'Rules:',
      '- READ ONLY: never create, change, delete, activate, lock, run or transport anything. Do not read table contents.',
      '- checked: one entry per listed name. result "verified" = exists, "missing" = not found, "clash" = listed as New but the name already exists.',
      '- objects: for each object to read that exists – summary (what it does today, 1-4 sentences), detail (only the ids above, only what a tool returned), uses (objects it reads or calls), usedBy (main where-used, at most 10).',
      '- For tables, structures and CDS views give the fields with keys and types; for classes, interfaces and function modules the signatures (no full source); for reports the selection screen and the logic in a few sentences.',
      '- Never invent: everything you could not read goes into notFound.',
      '',
      'Answer with a short summary and then exactly one ```json block:',
      '```json',
      JSON.stringify({
        kind: KIND, version: 1, system: '',
        checked: [{ name: 'NAME', type: 'Table', result: 'verified', description: '' }],
        objects: [{ name: 'NAME', type: 'Table', summary: '', detail: {}, uses: [], usedBy: [] }],
        notFound: []
      }, null, 1),
      '```'
    ].filter(function (l) { return l !== null; }).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  /* ------------------------------------------------------------ validation */
  function cellValue(col, v) {
    if (col.kind === 'check') return v === true || /^(x|yes|true|1|✓)$/i.test(str(v, 5));
    if (col.kind === 'select') {
      const t = str(v, 200);
      const opt = (col.options || []).filter(function (o) { return o.value === t || o.label === t; })[0];
      return opt ? opt.value : '';
    }
    if (col.kind === 'multicheck') return arr(v, 20).map(function (x) { return str(x, 100); }).filter(function (x) { return (col.options || []).some(function (o) { return o.value === x; }); });
    if (col.kind === 'lines' || col.kind === 'textarea') return Array.isArray(v) ? v.map(function (x) { return str(x, 500); }).filter(Boolean).join('\n').slice(0, 8000) : str(v, 8000);
    return str(v, 500);
  }

  /* Keep only the designer's field ids, with the designer's value shapes. */
  function sanitize(fields, raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    (fields || []).forEach(function (f) {
      if (f.id === 'used' || raw[f.id] === undefined || raw[f.id] === null) return;
      const v = raw[f.id];
      if (f.kind === 'grid') {
        const rows = arr(v, 200).filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); }).map(function (r) {
          const row = {};
          f.columns.forEach(function (c) { if (r[c.id] !== undefined) row[c.id] = cellValue(c, r[c.id]); });
          return row;
        }).filter(function (r) { return Object.keys(r).some(function (k) { return r[k] !== '' && r[k] !== false; }); });
        if (rows.length) out[f.id] = rows;
      } else if (f.kind === 'records') {
        const recs = arr(v, 50).map(function (r) { return sanitize(f.fields, r); }).filter(function (r) { return Object.keys(r).length; });
        if (recs.length) out[f.id] = recs;
      } else {
        const val = cellValue(f, v);
        if (val !== '' && val !== false && !(Array.isArray(val) && !val.length)) out[f.id] = val;
      }
    });
    return out;
  }

  function normalize(raw) {
    const known = D().objectTypes;
    const checked = [];
    arr(raw.checked, 100).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      const n = upper(c.name);
      const r = str(c.result, 20).toLowerCase();
      if (!NAME_RE.test(n) || RESULTS.indexOf(r) < 0 || checked.some(function (x) { return x.name === n; })) return;
      checked.push({ name: n, type: str(c.type, 40), result: r, description: str(c.description, 200) });
    });
    const objects = [];
    arr(raw.objects, 20).forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      const n = upper(o.name);
      if (!NAME_RE.test(n) || objects.some(function (x) { return x.name === n; })) return;
      const type = known.indexOf(str(o.type, 40)) >= 0 ? str(o.type, 40) : '';
      objects.push({ name: n, type: type, summary: str(o.summary, 3000), detail: type ? sanitize(D().objectDef(type).fields, o.detail) : {}, uses: names(o.uses), usedBy: names(o.usedBy, 10) });
    });
    return { kind: KIND, version: 1, system: str(raw.system, 40), checked: checked, objects: objects, notFound: names(raw.notFound, 50) };
  }

  /* text: the whole answer or only its JSON → { ctx, error } */
  function parse(text) {
    text = String(text || '');
    if (text.length > MAX_TEXT) return { ctx: null, error: 'The answer is too long.' };
    const cands = [];
    text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, function (_, b) { cands.push(b); return _; });
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) cands.push(text.slice(a, b + 1));
    for (let i = cands.length - 1; i >= 0; i--) {
      let raw;
      try { raw = JSON.parse(cands[i]); } catch (e) { continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.kind !== KIND) continue;
      const ctx = normalize(raw);
      if (ctx.checked.length || ctx.objects.length) return { ctx: ctx, error: '' };
    }
    return { ctx: null, error: 'No SAP check found in the answer – paste the whole answer including the ```json block (kind "' + KIND + '").' };
  }

  /* ------------------------------------------------------- review & apply */
  function find(list, name) { const n = upper(name); return list.filter(function (x) { return x.name === n; })[0] || null; }

  /* → [{ id, label, items[], checked }] for the review dialog */
  function preview(s, ctx) {
    const parts = [];
    const res = { verified: 0, missing: 0, clash: 0 };
    ctx.checked.forEach(function (c) { res[c.result]++; });
    parts.push({ id: 'check', label: 'Reference check: ' + res.verified + ' ✓ in system · ' + res.missing + ' ✗ not found' + (res.clash ? ' · ' + res.clash + ' ⚠ already exists' : ''), items: ctx.checked.map(function (c) { return c.name + ' – ' + ({ verified: '✓ in system', missing: '✗ not found', clash: '⚠ already exists' })[c.result] + (c.description ? ' (' + c.description + ')' : ''); }), checked: true });
    const status = [];
    s.objects.forEach(function (o) {
      const c = find(ctx.checked, o.name);
      if (c && o.status === 'tbc' && c.result !== 'clash') status.push(o.name.toUpperCase() + ': To Be Confirmed → ' + (c.result === 'verified' ? 'Existing – reuse' : 'New'));
    });
    if (status.length) parts.push({ id: 'status', label: 'Update the status of unconfirmed objects', items: status, checked: true });
    const read = [];
    s.objects.forEach(function (o) {
      const r = find(ctx.objects, o.name);
      if (!r) return;
      const ids = Object.keys(r.detail).map(function (k) { const f = (D().objectDef(r.type || o.type).fields || []).filter(function (x) { return x.id === k; })[0]; return f ? f.label : k; });
      read.push(o.name.toUpperCase() + ': ' + (r.summary ? r.summary.slice(0, 120) : 'current state') + (ids.length ? ' · ' + ids.join(', ') : ''));
    });
    if (read.length) parts.push({ id: 'current', label: 'Current state read from SAP (shown read-only, your design is not changed)', items: read, checked: true });
    const used = usedToAdd(s, ctx);
    if (used.length) parts.push({ id: 'used', label: 'Add the objects they use as Existing – reuse', items: used.map(function (u) { return u.name + ' (used by ' + u.by + ')'; }), checked: false });
    if (ctx.notFound.length) parts.push({ id: 'notfound', label: 'Could not be read', items: ctx.notFound, checked: true, info: true });
    return parts;
  }

  function usedToAdd(s, ctx) {
    const have = s.objects.map(function (o) { return o.name.trim().toUpperCase(); });
    const out = [];
    ctx.objects.forEach(function (r) {
      r.uses.forEach(function (n) { if (have.indexOf(n) < 0 && !out.some(function (x) { return x.name === n; })) out.push({ name: n, by: r.name }); });
    });
    return out.slice(0, 15);
  }

  /* ids: the picked part ids → { state, applied[] } (state is a copy) */
  function apply(s, ctx, ids) {
    const next = clone(s);
    const on = function (id) { return ids.indexOf(id) >= 0; };
    const applied = [];
    const now = Date.now();
    if (on('check')) {
      next.sapCheck = { at: now, system: ctx.system, results: ctx.checked.map(function (c) { return { name: c.name, type: c.type, result: c.result, description: c.description }; }), notFound: ctx.notFound.slice() };
      applied.push('reference check');
    }
    if (on('status')) {
      let n = 0;
      next.objects.forEach(function (o) {
        const c = find(ctx.checked, o.name);
        if (c && o.status === 'tbc' && c.result !== 'clash') { o.status = c.result === 'verified' ? 'existing' : 'new'; n++; }
      });
      if (n) applied.push(n + ' status' + (n > 1 ? 'es' : ''));
    }
    if (on('current')) {
      let n = 0;
      next.objects.forEach(function (o) {
        const r = find(ctx.objects, o.name);
        if (!r) return;
        o.sap = { at: now, system: ctx.system, type: r.type || o.type, summary: r.summary, detail: r.detail, uses: r.uses, usedBy: r.usedBy };
        n++;
      });
      if (n) applied.push('current state of ' + n + ' object' + (n > 1 ? 's' : ''));
    }
    if (on('used')) {
      const add = usedToAdd(next, ctx);
      add.forEach(function (u) {
        const c = find(ctx.checked, u.name);
        next.objects.push({ id: APB.state.uid(), type: guessType(c && c.type), name: u.name, status: 'existing', purpose: 'Used by ' + u.by + ' (read from SAP)', parent: '', detail: {}, sap: null });
      });
      if (add.length) applied.push(add.length + ' used object' + (add.length > 1 ? 's' : ''));
    }
    return { state: next, applied: applied };
  }

  function guessType(t) { const known = D().objectTypes; return t && known.indexOf(t) >= 0 ? t : 'Other'; }

  /* ---------------------------------------------------------------- views */
  /* Result of the last check for an object (by its current name) → { cls, text, title } | null */
  function badge(s, o) {
    const chk = s.sapCheck;
    if (!chk || !o.name.trim()) return null;
    const r = find(chk.results || [], o.name);
    if (!r) return { cls: '', text: '– not checked', title: 'Not in the last SAP check' };
    if (r.result === 'verified') return o.status === 'new' ? { cls: 'bad', text: '⚠ already exists', title: 'Planned as new, but the name exists in SAP' } : { cls: 'ok', text: '✓ in system', title: r.description || 'Found in SAP' };
    if (r.result === 'clash') return { cls: 'bad', text: '⚠ already exists', title: r.description || 'Planned as new, but the name exists in SAP' };
    return o.status === 'new' ? { cls: 'ok', text: '✓ name free', title: 'Not found in SAP – free for a new object' } : { cls: 'bad', text: '✗ not found', title: 'Marked as existing but not found in SAP' };
  }

  /* Open questions from the last check (completeness.js). */
  function questions(s) {
    const q = [];
    if (!s.sapCheck) return q;
    s.objects.forEach(function (o) {
      const b = badge(s, o);
      if (!b || b.cls !== 'bad') return;
      if (b.text.indexOf('already') >= 0) q.push('The proposed new name ' + o.name.trim() + ' already exists in SAP – choose another name or reuse the existing object.');
      else q.push(o.type + ' ' + o.name.trim() + ' is marked as existing but was not found in SAP – check the name.');
    });
    return q;
  }

  APB.devSap = { MARK: MARK, KIND: KIND, MAX_READ: MAX_READ, prompt: prompt, parse: parse, sanitize: sanitize, preview: preview, apply: apply, badge: badge, questions: questions, readTargets: readTargets, checkTargets: checkTargets };
})(window.APB = window.APB || {});
