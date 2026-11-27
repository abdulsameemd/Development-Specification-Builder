/* "Complete the TS with Copilot": Copilot fills the EMPTY parts of a Technical spec from the FS extract the TS keeps
   (origin.fsText), the business requirement and the facts read from SAP (Check & read in SAP). No tools in this step.
   The answer (kind dewa-ts-draft) is untrusted: only designer field ids and allowed option values are kept, filled
   values are never overwritten, and every TABLE-FIELD / custom object name that is not in the FS, the TS or the SAP
   facts is marked [TO BE CONFIRMED] before the developer reviews it. Authorization is never changed here. */
(function (APB) {
  'use strict';

  const MARK = 'TS-DRAFT v1';
  const KIND = 'dewa-ts-draft';
  const TBC = '[TO BE CONFIRMED]';
  const MAX_TEXT = 400000;

  function D() { return APB.defs; }
  function V() { return APB.validation; }
  function str(v, max) { return (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').trim().slice(0, max || 4000); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function filled(v) { return V().isFilled(v); }

  /* ------------------------------------------------------------ grounding */
  /* SAP names the TS may use without confirmation: FS names, TS objects, SAP check results and what SAP returned */
  function knownNames(s) {
    const k = {};
    const add = function (n) { n = str(n, 80).toUpperCase(); if (n) k[n] = 1; };
    ((s.origin && s.origin.names) || []).forEach(add);
    s.objects.forEach(function (o) {
      add(o.name);
      if (o.sap) { add(o.sap.type); (o.sap.uses || []).forEach(add); (o.sap.usedBy || []).forEach(add); walk(o.sap.detail, function (t) { refs(t).forEach(add); }); }
      walk(o.detail, function (t) { refs(t).forEach(add); });
    });
    ((s.sapCheck && s.sapCheck.results) || []).forEach(function (r) { add(r.name); });
    ((s.quality && s.quality.authChecks) || []).forEach(function (a) { add(a && a.object); });
    return k;
  }
  /* strings inside a value (grids, records, lines) */
  function walk(v, fn) {
    if (typeof v === 'string') fn(v);
    else if (Array.isArray(v)) v.forEach(function (x) { walk(x, fn); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k], fn); });
  }
  // TABLE-FIELD (VBAK-VKORG), and custom object names (Z…/Y…/ /NS/…) – the names a model is most likely to invent
  const REF_RE = /(?:\/[A-Z0-9]{1,10}\/[A-Z0-9_]+|\b[A-Z][A-Z0-9_]{1,29}-[A-Z][A-Z0-9_]{0,29}\b|\b[ZY][A-Z0-9]*_[A-Z0-9_]{2,40}\b)/g;
  const ALWAYS = /^(SY-[A-Z0-9_]+|SELECT-OPTIONS|SELECTION-SCREEN|END-OF-SELECTION|START-OF-SELECTION|AT-SELECTION-SCREEN|TOP-OF-PAGE|LOAD-OF-PROGRAM|INITIALIZATION-.*|NON-UNIQUE|READ-ONLY|E-MAIL|CL_[A-Z0-9_]+|IF_[A-Z0-9_]+|BAPI_[A-Z0-9_]+|BAPIRET2.*)$/;
  function refs(text) { return (String(text || '').toUpperCase().match(REF_RE) || []).filter(function (n) { return !ALWAYS.test(n); }); }
  // non-SAP: Entity.Field / Table.Column names (framework members such as DateTime.Now are fine)
  const GREF_RE = /\b[A-Z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\b/g;
  const G_ALWAYS = /^(SYSTEM|MATH|DATETIME|DATETIMEOFFSET|STRING|CONSOLE|JSON|OBJECT|ARRAY|LIST|OPTIONAL|LOCALDATE|LOCALDATETIME|INSTANT|GUID|UUID|HTTPSTATUS|HTTPSTATUSCODE|RESULTS|TASK|ENVIRONMENT|PROCESS|PATH|FILE|LOGGER|ILOGGER|CONFIGURATION|COLLECTORS|STREAM|INTEGER|LONG|DECIMAL|BIGDECIMAL|BOOLEAN|ENUM|PROMISE|WINDOW|DOCUMENT|DATE|NUMBER|POWER|PATCH|LOOKUP|FILTER|SORTBYCOLUMNS|USER|TODAY|NOW|NEXT|FIRST|LAST|COUNTROWS|THISITEM|SELF|PARENT|GALLERY\d*|FORM\d*|SCREEN\d*|APP|VARIABLES|TRIGGEROUTPUTS|OUTPUTS|BODY|ITEMS)\./;
  function genericKnown(s) {
    const k = {};
    const add = function (n) { n = str(n, 120).toUpperCase(); if (n) k[n] = 1; };
    ((s.origin && s.origin.names) || []).forEach(function (n) { add(n); if (n.indexOf('-') > 0) add(n.replace('-', '.')); });
    s.objects.forEach(function (o) { add(o.name); walk(o.detail, function (t) { (String(t).match(GREF_RE) || []).forEach(add); }); });
    // FS data rows "table.field" written in the FS extract
    (String((s.origin && s.origin.fsText) || '').match(GREF_RE) || []).forEach(add);
    return k;
  }
  function groundGeneric(text, known) {
    let n = 0;
    const out = String(text).replace(GREF_RE, function (m, off, all) {
      const u = m.toUpperCase();
      if (G_ALWAYS.test(u) || known[u] || (known[u.split('.')[0]] && known[u.split('.')[1]])) return m;
      if (all.slice(Math.max(0, off - TBC.length - 1), off).indexOf(TBC) >= 0) return m;
      n++;
      return TBC + ' ' + m;
    });
    return [out, n];
  }
  /* mark unknown names in a string → [text, count] */
  function ground(text, known) {
    let n = 0;
    const out = String(text).replace(REF_RE, function (m, off, all) {
      const u = m.toUpperCase();
      if (ALWAYS.test(u) || known[u] || known[u.split('-')[0]] && known[u.split('-')[1]]) return m;
      if (all.slice(Math.max(0, off - TBC.length - 1), off).indexOf(TBC) >= 0) return m;
      n++;
      return TBC + ' ' + m;
    });
    return [out, n];
  }
  function groundValue(v, known, count) {
    if (typeof v === 'string') { const g = known.__generic ? groundGeneric(v, known) : ground(v, known); count.n += g[1]; return g[0]; }
    if (Array.isArray(v)) return v.map(function (x) { return groundValue(x, known, count); });
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(function (k) { o[k] = groundValue(v[k], known, count); }); return o; }
    return v;
  }

  /* --------------------------------------------------------------- prompt */
  function optionText(f) { return (f.options || []).filter(function (o) { return o.value; }).map(function (o) { return o.value; }).join(' | '); }
  function schemaLine(type) {
    const fields = (D().objectDef(type).fields || []).filter(function (f) { return f.id !== 'used'; });
    return fields.map(function (f) {
      const sub = f.kind === 'grid' ? f.columns : f.kind === 'records' ? f.fields : null;
      const kind = { select: 'one of', radio: 'one of', multicheck: 'list of' }[f.kind];
      return '  - ' + f.id + ' (' + f.label + ')' + (kind ? ': ' + kind + ' ' + optionText(f) : f.kind === 'check' ? ': true/false' : f.kind === 'lines' ? ': text, one item per line' : '') +
        (sub ? ': array of { ' + sub.map(function (c) { const o = c.options && optionText(c); return c.id + (o ? ' (' + o + ')' : c.kind === 'check' ? ' (true/false)' : ''); }).join(', ') + ' }' : '');
    }).join('\n');
  }
  function quality(s) { return D().quality.filter(function (f) { return ['dataVolume', 'performanceReq', 'testScenarios', 'cleanCore', 'cleanCoreNote'].indexOf(f.id) >= 0 && !(s && D().isGeneric(s) && /^cleanCore/.test(f.id)); }); }

  function tsView(s) {
    return {
      development: s.types.map(function (t) { return (D().types[t] && D().types[t].label) || t; }),
      requirement: s.requirement,
      objects: s.objects.map(function (o) {
        return { type: o.type, name: o.name, status: o.status, purpose: o.purpose, detail: o.detail || {},
          currentStateInSap: o.sap ? { summary: o.sap.summary, detail: o.sap.detail, uses: o.sap.uses } : undefined };
      }),
      rules: s.rules.filter(filled).map(function (r) { return { condition: r.condition, behavior: r.behavior }; }),
      acceptance: s.acceptance.filter(filled).map(function (a) { return a.text; }),
      quality: { authorization: s.quality.authorization, dataVolume: s.quality.dataVolume, performanceReq: s.quality.performanceReq, testScenarios: s.quality.testScenarios, cleanCore: s.quality.cleanCore },
      sapCheck: s.sapCheck ? s.sapCheck.results.map(function (r) { return r.name + ': ' + r.result; }) : []
    };
  }

  /* non-SAP platform: the same completion without SAP wording, sources or naming rules */
  function genericPrompt(s) {
    const targets = s.objects.filter(function (o) { return o.status === 'new' || o.status === 'change'; });
    const types = [];
    targets.forEach(function (o) { if (types.indexOf(o.type) < 0 && (D().objectDef(o.type).fields || []).length) types.push(o.type); });
    const q = quality(s);
    const fsText = (s.origin && s.origin.fsText) || '';
    return [MARK,
      'Complete the technical specification below for GitHub Copilot (agent mode), which will implement it in the project repository' + (s.stack ? ' (' + s.stack + ')' : '') + '. Fill ONLY the parts that are still EMPTY. You have no tools in this step.',
      '',
      'Sources you may use – nothing else:',
      '1. the functional specification extract (FS) below' + (fsText ? '' : ' (none – use the business requirement)') + ';',
      '2. the technical specification as it is now (TS JSON) – its requirement, rules, acceptance criteria and components.',
      '',
      'Rules:',
      '- Fill every EMPTY designer field of the components with status new or change that these sources support: processing logic step by step, request / response, columns, screen fields, mapping, error handling, schedule – in the shape given below. Never change a field that already has a value.',
      '- Use only tables, columns, entities, endpoints, systems and connectors that appear in the sources. A name you need but cannot find in them: write "' + TBC + '" in front of it (e.g. "' + TBC + ' Order.DeliveryDate"). Never invent table, column or endpoint names.',
      '- No new business rules: derive the logic from the FS requirements, rules, data and TO-BE steps. Anything the sources do not answer goes to openQuestions.',
      '- Authorization: do not change it (it stays "' + (s.quality.authorization || 'no') + '").',
      '- Use the option values exactly as listed. Field references as Entity.Field.',
      '- testScenarios: one per line, "scenario => expected result", covering every acceptance criterion; dataVolume one of ' + optionText(q.filter(function (f) { return f.id === 'dataVolume'; })[0] || {}) + '.',
      '',
      'Designer fields per component type (use only these ids):',
      types.map(function (t) { return t + ':\n' + schemaLine(t); }).join('\n') || '(no component to complete)',
      '',
      fsText ? (APB.guard ? APB.guard.fence('FS EXTRACT', fsText) : '=== FS EXTRACT ===\n' + fsText + '\n=== END FS EXTRACT ===') : '',
      '',
      'TS JSON (as it is now):',
      '```json',
      JSON.stringify(Object.assign(tsView(s), { platform: 'other platform', stack: s.stack || '', sapCheck: undefined }), null, 1),
      '```',
      '',
      'Answer with a short summary and then exactly one ```json block:',
      '```json',
      JSON.stringify({ kind: KIND, version: 1, objects: targets.map(function (o) { return { name: o.name, type: o.type, detail: {} }; }), expectedOutput: '',
        quality: { dataVolume: '', performanceReq: '', testScenarios: '' }, openQuestions: [''] }, null, 1),
      '```'
    ].join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function prompt(s) {
    if (D().isGeneric(s)) return genericPrompt(s);
    const targets = s.objects.filter(function (o) { return o.status === 'new' || o.status === 'change'; });
    const types = [];
    targets.forEach(function (o) { if (types.indexOf(o.type) < 0 && (D().objectDef(o.type).fields || []).length) types.push(o.type); });
    const q = quality();
    const fsText = (s.origin && s.origin.fsText) || '';
    return [MARK,
      'Complete the technical (development) specification below for GitHub Copilot (dewa-abap), which will implement it in SAP. Fill ONLY the parts that are still EMPTY. You have no tools in this step.',
      '',
      'Sources you may use – nothing else:',
      '1. the functional specification extract (FS) below' + (fsText ? '' : ' (none – use the business requirement)') + ';',
      '2. the technical specification as it is now (TS JSON) – its requirement, rules, acceptance criteria and objects;',
      '3. the facts read from the SAP system (currentStateInSap, sapCheck in the TS JSON).',
      '',
      'Rules:',
      '- Fill every EMPTY designer field of the objects with status new or change that these sources support: processing logic step by step, output, selection screen, columns, parameters, error handling, background execution, messages – in the shape given below. Never change a field that already has a value.',
      '- Use only SAP tables, fields, CDS views, BAPIs, classes and objects that appear in the sources. A name you need but cannot find in them: write "' + TBC + '" in front of it (e.g. "' + TBC + ' VBAP-ABGRU"). Never invent table or field names.',
      '- No new business rules: derive the logic from the FS requirements, rules, data and TO-BE steps. Anything the sources do not answer goes to openQuestions.',
      '- Authorization: do not change it (it stays "' + (s.quality.authorization || 'no') + '").',
      '- Use the option values exactly as listed. Selection-screen names at most 8 characters (S_ / P_ prefix). Field references as TABLE-FIELD.',
      '- testScenarios: one per line, "scenario => expected result", covering every acceptance criterion; dataVolume one of ' + optionText(q.filter(function (f) { return f.id === 'dataVolume'; })[0] || {}) + '; cleanCore one of ' + optionText(q.filter(function (f) { return f.id === 'cleanCore'; })[0] || {}) + '.',
      '',
      'Designer fields per object type (use only these ids):',
      types.map(function (t) { return t + ':\n' + schemaLine(t); }).join('\n') || '(no object to complete)',
      '',
      fsText ? (APB.guard ? APB.guard.fence('FS EXTRACT', fsText) : '=== FS EXTRACT ===\n' + fsText + '\n=== END FS EXTRACT ===') : '',
      '',
      'TS JSON (as it is now):',
      '```json',
      JSON.stringify(tsView(s), null, 1),
      '```',
      '',
      'Answer with a short summary and then exactly one ```json block:',
      '```json',
      JSON.stringify({
        kind: KIND, version: 1,
        objects: targets.map(function (o) { return { name: o.name, type: o.type, detail: {} }; }),
        expectedOutput: '',
        quality: { dataVolume: '', performanceReq: '', testScenarios: '', cleanCore: '', cleanCoreNote: '' },
        openQuestions: ['']
      }, null, 1),
      '```'
    ].filter(function (l) { return l !== null; }).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  /* ------------------------------------------------------ parse & ground */
  function normalize(raw, s) {
    const known = D().isGeneric(s) ? Object.assign(genericKnown(s), { __generic: 1 }) : knownNames(s);
    const count = { n: 0 };
    const objects = [];
    (Array.isArray(raw.objects) ? raw.objects : []).slice(0, 30).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      const name = str(r.name, 60).toUpperCase();
      const o = s.objects.filter(function (x) { return x.name.trim().toUpperCase() === name && name; })[0] ||
        s.objects.filter(function (x) { return !x.name.trim() && x.type === r.type; })[0];
      if (!o || (o.status !== 'new' && o.status !== 'change')) return;
      const detail = APB.devSap.sanitize(D().objectDef(o.type).fields, r.detail);
      objects.push({ id: o.id, name: o.name || o.type, type: o.type, detail: groundValue(detail, known, count) });
    });
    const q = {};
    const qraw = raw.quality && typeof raw.quality === 'object' ? raw.quality : {};
    const qs = APB.devSap.sanitize(quality(s), qraw);
    Object.keys(qs).forEach(function (k) { q[k] = groundValue(qs[k], known, count); });
    return {
      kind: KIND, version: 1, objects: objects, quality: q,
      expectedOutput: groundValue(str(raw.expectedOutput, 2000), known, count),
      openQuestions: (Array.isArray(raw.openQuestions) ? raw.openQuestions : []).map(function (x) { return str(x, 400); }).filter(Boolean).slice(0, 20),
      unconfirmed: count.n
    };
  }

  function parse(text, s) {
    text = String(text || '');
    if (text.length > MAX_TEXT) return { draft: null, error: 'The answer is too long.' };
    const cands = [];
    text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, function (_, b) { cands.push(b); return _; });
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) cands.push(text.slice(a, b + 1));
    for (let i = cands.length - 1; i >= 0; i--) {
      let raw;
      try { raw = JSON.parse(cands[i]); } catch (e) { continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.kind !== KIND) continue;
      return { draft: normalize(raw, s), error: '' };
    }
    return { draft: null, error: 'No TS completion found in the answer – paste the whole answer including the ```json block (kind "' + KIND + '").' };
  }

  /* ------------------------------------------------------- review & apply */
  function label(type, id) { const f = (D().objectDef(type).fields || []).filter(function (x) { return x.id === id; })[0]; return f ? f.label : id; }
  function qlabel(id) { const f = quality().filter(function (x) { return x.id === id; })[0]; return f ? f.label : id; }
  function shortVal(v) {
    if (Array.isArray(v)) return v.length + ' ' + (v.length === 1 ? 'entry' : 'entries') + (typeof v[0] === 'string' ? ': ' + v.join(', ') : '');
    if (v === true) return 'yes';
    return String(v).replace(/\s*\n\s*/g, ' · ').slice(0, 140);
  }
  function hasTbc(v) { let t = false; walk(v, function (x) { if (x.indexOf(TBC) >= 0) t = true; }); return t; }

  /* → [{ id, label, items[], checked }] – only parts that would fill something still empty */
  function preview(s, d) {
    const parts = [];
    d.objects.forEach(function (r) {
      const o = s.objects.filter(function (x) { return x.id === r.id; })[0];
      if (!o) return;
      Object.keys(r.detail).forEach(function (k) {
        if (filled((o.detail || {})[k])) return;
        parts.push({ id: 'obj:' + o.id + ':' + k, label: (o.name || o.type) + ' – ' + label(o.type, k) + (hasTbc(r.detail[k]) ? ' (contains ' + TBC + ')' : ''), items: [shortVal(r.detail[k])], checked: true, source: 'Copilot proposal' });
      });
    });
    Object.keys(d.quality).forEach(function (k) {
      if (filled(s.quality[k])) return;
      parts.push({ id: 'q:' + k, label: qlabel(k), items: [shortVal(d.quality[k])], checked: true, source: 'Copilot proposal' });
    });
    if (d.expectedOutput && !filled(s.requirement.expectedOutput)) parts.push({ id: 'output', label: 'Expected output', items: [shortVal(d.expectedOutput)], checked: true, source: 'Copilot proposal' });
    if (d.openQuestions.length) parts.push({ id: 'questions', label: 'Open questions (added to Assumptions & open points)', items: d.openQuestions, checked: true, source: 'Copilot' });
    if (d.unconfirmed) parts.push(D().isGeneric(s)
      ? { id: 'grounding', label: d.unconfirmed + ' name' + (d.unconfirmed > 1 ? 's' : '') + ' not found in the FS or the TS – marked ' + TBC, items: ['Confirm them (repository, data model, interface owner) before Copilot implements them.'], checked: true, info: true }
      : { id: 'grounding', label: d.unconfirmed + ' SAP name' + (d.unconfirmed > 1 ? 's' : '') + ' not found in the FS, the TS or SAP – marked ' + TBC, items: ['Confirm them (Check & read in SAP) before Copilot implements them.'], checked: true, info: true });
    return parts;
  }

  /* ids: picked part ids → { state, applied[] } – fills only empty fields */
  function apply(s, d, ids) {
    const next = clone(s);
    const on = function (id) { return ids.indexOf(id) >= 0; };
    const applied = [];
    d.objects.forEach(function (r) {
      const o = next.objects.filter(function (x) { return x.id === r.id; })[0];
      if (!o) return;
      o.detail = o.detail || {};
      Object.keys(r.detail).forEach(function (k) {
        if (!on('obj:' + o.id + ':' + k) || filled(o.detail[k])) return;
        o.detail[k] = clone(r.detail[k]);
        applied.push((o.name || o.type) + '.' + k);
      });
    });
    Object.keys(d.quality).forEach(function (k) {
      if (!on('q:' + k) || filled(next.quality[k])) return;
      next.quality[k] = clone(d.quality[k]);
      applied.push('quality.' + k);
    });
    if (on('output') && d.expectedOutput && !filled(next.requirement.expectedOutput)) { next.requirement.expectedOutput = d.expectedOutput; applied.push('expected output'); }
    if (on('questions') && d.openQuestions.length) {
      next.assumptions = [str(next.assumptions, 20000), 'Open questions (Copilot):\n' + d.openQuestions.map(function (q) { return '- ' + TBC + ' ' + q; }).join('\n')].filter(Boolean).join('\n\n');
      applied.push(d.openQuestions.length + ' open question' + (d.openQuestions.length > 1 ? 's' : ''));
    }
    if (applied.length) {
      next.origin = next.origin || { fsText: '', names: [] };
      next.origin.copilot = (next.origin.copilot || []).concat(applied.filter(function (a) { return next.origin.copilot ? next.origin.copilot.indexOf(a) < 0 : true; })).slice(0, 200);
    }
    return { state: next, applied: applied };
  }

  APB.tsDraft = { MARK: MARK, KIND: KIND, prompt: prompt, parse: parse, preview: preview, apply: apply, knownNames: knownNames, ground: ground, refs: refs };
})(window.APB = window.APB || {});
