/* AI draft for functional specifications: a prompt built from the business requirement, the answer's JSON
   parsed and size-limited (untrusted text), and a merge that only fills what is still empty. The consultant
   reviews every section before anything is added; nothing typed by hand is overwritten. */
(function (APB) {
  'use strict';
  const F = APB.fs, V = APB.validation;
  const MARK = 'FS-DRAFT v1', KIND = 'fs-draft';
  const MAX_ITEMS = 30, MAX_LEN = 2000;

  function str(v) { return typeof v === 'string' ? v.trim().slice(0, MAX_LEN) : (typeof v === 'number' ? String(v) : ''); }
  function lines(v) {
    return (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : []).map(function (l) { return str(l).replace(/^[-*•]\s+/, ''); }).filter(Boolean).slice(0, MAX_ITEMS);
  }

  /* An option value from what the model wrote ("must", "Must have", "MUST"). */
  function enumOf(options, v) {
    v = str(v).toLowerCase();
    if (!v) return '';
    const o = (options || []).filter(function (x) { return x.value && (x.value.toLowerCase() === v || x.label.toLowerCase() === v || x.label.toLowerCase().split(/[\s(–-]/)[0] === v.split(/[\s(–-]/)[0]); })[0];
    return o ? o.value : '';
  }
  function colOptions(sectionId, fieldId, colId) {
    const f = F.field(sectionId, fieldId);
    const c = f && (f.columns || f.fields || []).filter(function (x) { return x.id === colId; })[0];
    return c ? c.options : [];
  }

  /* What a draft can contain, where it goes in the spec, and how it is shown in the review. */
  const PARTS = [
    { id: 'title', label: 'Title', path: 'context.title', kind: 'text' },
    { id: 'objectives', label: 'Business objectives', path: 'context.objectives', kind: 'lines' },
    { id: 'kpis', label: 'KPIs / success measures', path: 'context.kpis', kind: 'lines' },
    { id: 'inScope', label: 'In scope', path: 'context.inScope', kind: 'lines' },
    { id: 'outOfScope', label: 'Out of scope', path: 'context.outOfScope', kind: 'lines' },
    { id: 'stakeholders', label: 'Stakeholders', path: 'context.stakeholders', kind: 'rows', keys: ['role', 'responsibility'], show: 'role' },
    { id: 'asIs', label: 'AS-IS steps', path: 'process.asIs', kind: 'rows', keys: ['step', 'role', 'pain'], show: 'step' },
    { id: 'toBe', label: 'TO-BE steps', path: 'process.toBe', kind: 'rows', keys: ['step', 'role', 'change'], enums: { change: ['process', 'toBe', 'change'] }, show: 'step' },
    { id: 'frs', label: 'Functional requirements', path: 'reqs.frs', kind: 'rows', keys: ['title', 'priority', 'description', 'acceptance'], enums: { priority: ['reqs', 'frs', 'priority'] }, show: 'title' },
    { id: 'rules', label: 'Business rules', path: 'reqs.rules', kind: 'rows', keys: ['rule', 'type', 'outcome', 'fr'], enums: { type: ['reqs', 'rules', 'type'] }, show: 'rule', frRefs: 'fr' },
    { id: 'uat', label: 'Test scenarios', path: 'quality.uat', kind: 'rows', keys: ['fr', 'scenario', 'type', 'expected'], enums: { type: ['quality', 'uat', 'type'] }, show: 'scenario', frRefs: 'fr' },
    { id: 'risks', label: 'Risks & assumptions', path: 'quality.risks', kind: 'rows', keys: ['type', 'text'], enums: { type: ['quality', 'risks', 'type'] }, show: 'text' }
  ];

  function normalize(raw) {
    const d = {};
    PARTS.forEach(function (p) {
      const v = raw[p.id];
      if (p.kind === 'text') d[p.id] = str(v).slice(0, 200);
      else if (p.kind === 'lines') d[p.id] = lines(v);
      else {
        d[p.id] = (Array.isArray(v) ? v : []).slice(0, MAX_ITEMS).filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
          const o = {};
          p.keys.forEach(function (k) {
            const e = p.enums && p.enums[k];
            o[k] = e ? enumOf(colOptions(e[0], e[1], e[2]), r[k]) : Array.isArray(r[k]) ? lines(r[k]).join('\n') : str(r[k]);
          });
          return o;
        }).filter(function (o) { return str(o[p.show]); });
      }
    });
    return d;
  }

  function isEmptyDraft(d) { return PARTS.every(function (p) { return p.kind === 'text' ? !d[p.id] : !d[p.id].length; }); }

  /* The last JSON object in the answer (```json block first, else the outermost braces). */
  function parse(text) {
    text = String(text || '');
    if (text.length > 400000) return { draft: null, error: 'The answer is too long.' };
    const cands = [];
    text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, function (_, b) { cands.push(b); return _; });
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) cands.push(text.slice(a, b + 1));
    for (let i = cands.length - 1; i >= 0; i--) {
      let raw;
      try { raw = JSON.parse(cands[i]); } catch (e) { continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      if (raw.kind && raw.kind !== KIND) continue;
      const d = normalize(raw);
      if (!isEmptyDraft(d)) return { draft: d, error: '' };
    }
    return { draft: null, error: 'No draft found in the answer – paste the whole answer including the ```json block.' };
  }

  /* -------------------------------------------------------------- prompt */
  function prompt(s) {
    const c = s.context;
    const sys = F.isSap(s) ? 'SAP' + (c.module ? ' (module ' + c.module + ')' : '')
      : c.system === 'other' ? 'Other system' + ((c.systemName || '').trim() ? ': ' + c.systemName.trim() : '') : 'Not decided yet';
    const have = [];
    PARTS.forEach(function (p) {
      const v = APB.state.getPath(s, p.path);
      if (p.kind === 'rows') { const l = (v || []).filter(V.isFilled); if (l.length) have.push(p.label + ': ' + l.map(function (r) { return (r[p.show] || '').trim(); }).filter(Boolean).join(' | ')); }
      else if (str(v)) have.push(p.label + ': ' + str(v).replace(/\s*\n\s*/g, ' | '));
    });
    const out = [MARK,
      'You help a business analyst write a functional specification. Draft the parts that are still missing from the business requirement below.',
      '',
      'System: ' + sys,
      (c.processArea || '').trim() ? 'Process area: ' + c.processArea.trim() : '',
      'Business requirement:',
      (c.requirement || '').trim(),
      '',
      have.length ? 'Already written (keep it, do not repeat it; leave those lists empty):\n' + have.map(function (h) { return '- ' + h; }).join('\n') + '\n' : '',
      'Rules:',
      '- Plain business language for business readers; short, concrete sentences.',
      '- Use only what the requirement says or what such a solution clearly needs. Mark every assumption with [TO BE CONFIRMED].',
      '- Do not invent technical names (transactions, tables, programs, apps, APIs), people or numbers that are not in the requirement.',
      '- No personal data.',
      '- 3 to 8 functional requirements, each one testable, with 1 to 3 acceptance criteria ("When …, then …"). Reference them as FR-01, FR-02 … in the order you list them.',
      '- Allowed values: priority must|should|could|wont · change unchanged|changed|new|automated · rule type validation|derivation|calculation|authorization|approval · test type positive|negative · risk type risk|assumption|open|dependency.',
      '',
      'Answer with a one-line summary and then exactly one ```json block:',
      '```json',
      JSON.stringify({
        kind: KIND, version: 1, title: '', objectives: [''], kpis: [''], inScope: [''], outOfScope: [''],
        stakeholders: [{ role: '', responsibility: '' }],
        asIs: [{ step: '', role: '', pain: '' }], toBe: [{ step: '', role: '', change: 'new' }],
        frs: [{ title: '', priority: 'must', description: '', acceptance: [''] }],
        rules: [{ rule: '', type: 'validation', outcome: '', fr: 'FR-01' }],
        uat: [{ fr: 'FR-01', scenario: '', type: 'positive', expected: '' }],
        risks: [{ type: 'assumption', text: '' }]
      }, null, 2),
      '```'];
    return out.filter(function (l, i) { return l !== '' || out[i - 1] !== ''; }).join('\n');
  }

  /* ---------------------------------------------------- review and merge */
  /* What the draft would add to this spec, per part (only parts with something new). */
  function preview(s, d) {
    return PARTS.map(function (p) {
      const cur = APB.state.getPath(s, p.path);
      let items = [];
      if (p.kind === 'text') items = !str(cur) && d[p.id] ? [d[p.id]] : [];
      else if (p.kind === 'lines') { const have = lines(cur).map(function (l) { return l.toLowerCase(); }); items = d[p.id].filter(function (l) { return have.indexOf(l.toLowerCase()) < 0; }); }
      else {
        const have = (cur || []).filter(V.isFilled).map(function (r) { return str(r[p.show]).toLowerCase(); });
        items = d[p.id].filter(function (r) { return have.indexOf(str(r[p.show]).toLowerCase()) < 0; }).map(function (r) { return r[p.show]; });
      }
      return { id: p.id, label: p.label, items: items };
    }).filter(function (x) { return x.items.length; });
  }

  function merge(s, d, ids) {
    const next = JSON.parse(JSON.stringify(s));
    const frOffset = (next.reqs.frs || []).filter(V.isFilled).length;
    const shift = function (text) {
      return frOffset ? String(text || '').replace(/FR[\s-]*0*(\d+)/gi, function (_, n) { return F.frId(Number(n) - 1 + frOffset); }) : text;
    };
    const added = [];
    PARTS.forEach(function (p) {
      if (ids.indexOf(p.id) < 0) return;
      const cur = APB.state.getPath(next, p.path);
      if (p.kind === 'text') { if (!str(cur) && d[p.id]) { APB.state.setPath(next, p.path, d[p.id]); added.push(p.label.toLowerCase()); } return; }
      if (p.kind === 'lines') {
        const have = lines(cur);
        const lower = have.map(function (l) { return l.toLowerCase(); });
        const extra = d[p.id].filter(function (l) { return lower.indexOf(l.toLowerCase()) < 0; });
        if (extra.length) { APB.state.setPath(next, p.path, have.concat(extra).join('\n')); added.push(extra.length + ' ' + p.label.toLowerCase()); }
        return;
      }
      const list = (cur || []).filter(V.isFilled);
      const have = list.map(function (r) { return str(r[p.show]).toLowerCase(); });
      const extra = d[p.id].filter(function (r) { return have.indexOf(str(r[p.show]).toLowerCase()) < 0; }).map(function (r) {
        const o = Object.assign({}, r);
        if (p.frRefs) o[p.frRefs] = shift(o[p.frRefs]);
        return o;
      });
      if (extra.length) { APB.state.setPath(next, p.path, list.concat(extra)); added.push(extra.length + ' ' + p.label.toLowerCase()); }
    });
    return { state: F.model.migrate(next), added: added };
  }

  APB.fsDraft = { MARK: MARK, KIND: KIND, PARTS: PARTS, prompt: prompt, parse: parse, preview: preview, merge: merge };
})(window.APB = window.APB || {});
