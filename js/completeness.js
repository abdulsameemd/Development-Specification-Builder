/* "Ready for Copilot" status, dependency tree, open questions and object suggestions.
   Friendly by design: it never blocks beyond the two mandatory fields. */
(function (APB) {
  'use strict';
  const V = APB.validation;
  const D = APB.defs;
  const TBC = '[TO BE CONFIRMED]';

  function objectLabel(o) {
    return o.type + ' ' + (o.name && o.name.trim() ? o.name.trim() : TBC);
  }

  function rootLabel(state) {
    const labels = state.types.map(function (t) { return D.types[t].label; });
    return labels.length ? labels.join(' + ') : 'Development object';
  }

  /* Objects form a tree under the development object. obj.parent = id of the object that uses it. */
  function buildTree(state) {
    const byId = {};
    state.objects.forEach(function (o) { byId[o.id] = { obj: o, children: [] }; });
    const root = { label: rootLabel(state), children: [] };
    state.objects.forEach(function (o) {
      const p = o.parent && o.parent !== o.id && byId[o.parent] ? byId[o.parent] : null;
      (p && !createsCycle(o, byId) ? p : root).children.push(byId[o.id]);
    });
    return root;
  }

  function createsCycle(o, byId) {
    const seen = {};
    let cur = o;
    while (cur && cur.parent && byId[cur.parent]) {
      if (seen[cur.id] || cur.parent === o.id) return true;
      seen[cur.id] = true;
      cur = byId[cur.parent].obj;
    }
    return false;
  }

  /* ASCII tree used in the generated Markdown. */
  function treeToText(root, describe) {
    const lines = [root.label];
    (function walk(nodes, prefix) {
      nodes.forEach(function (n, i) {
        const last = i === nodes.length - 1;
        lines.push(prefix + (last ? '└── ' : '├── ') + describe(n.obj));
        walk(n.children, prefix + (last ? '    ' : '│   '));
      });
    })(root.children, '');
    return lines.join('\n');
  }

  /* RAP draft tables are generated from the behavior definition – nothing to specify. */
  function isGenerated(state, o) { return !!(APB.rap && APB.rap.isDraftTable(state, o)); }

  function detailFilled(o) {
    return Object.keys(o.detail || {}).some(function (k) { return k !== 'used' && V.isFilled(o.detail[k]); });
  }

  function counts(state) {
    const c = { existing: 0, new: 0, change: 0, tbc: 0, dependencies: state.objects.length, specified: 0, toSpecify: 0 };
    state.objects.forEach(function (o) {
      c[o.status] = (c[o.status] || 0) + 1;
      if (D.hasBuilder(o) && !isGenerated(state, o)) { c.toSpecify++; if (detailFilled(o)) c.specified++; }
    });
    return c;
  }

  function ruleApplies(rule, state) {
    return rule.types === '*' || state.types.some(function (t) { return rule.types.indexOf(t) >= 0; });
  }

  /* anyOf tokens: a state path, "object:<Type>.<field>" (any object of that type) or "specs:all". */
  function tokenFilled(state, token) {
    if (token === 'specs:all') {
      return state.objects.filter(function (o) { return D.hasBuilder(o) && !isGenerated(state, o); }).every(detailFilled);
    }
    const m = /^object:(.+)\.([^.]+)$/.exec(token);
    if (m) return state.objects.some(function (o) { return o.type === m[1] && V.isFilled((o.detail || {})[m[2]]); });
    return V.isFilled(APB.state.getPath(state, token));
  }

  function missingRecommended(state) {
    return V.rules.recommended.filter(function (r) {
      return ruleApplies(r, state) && !r.anyOf.some(function (t) { return tokenFilled(state, t); });
    });
  }

  /* Walk every visible builder field of an object (records recurse). cb(field, value, values). */
  function walkFields(fields, values, cb) {
    fields.forEach(function (f) {
      if (!D.isVisible(f, values)) return;
      cb(f, values[f.id], values);
      if (f.kind === 'records' && Array.isArray(values[f.id])) values[f.id].forEach(function (rec) { walkFields(f.fields, rec || {}, cb); });
    });
  }

  /* Questions derived from missing info and from explicit "To Be Confirmed" choices. Nothing is invented. */
  function openQuestions(state) {
    const q = [];
    missingRecommended(state).forEach(function (r) { if (r.question) q.push(r.question); });

    state.objects.forEach(function (o) {
      const name = o.name && o.name.trim();
      const label = objectLabel(o);
      if (o.status === 'tbc') q.push('Confirm whether ' + o.type + (name ? ' ' + name : ' (unnamed)') + ' already exists in the system.');
      else if (!name) q.push(o.status === 'new' ? 'Proposed name for the new ' + o.type + (o.purpose ? ' (' + o.purpose + ')' : '') + '.' : 'Name of the ' + o.type + (o.purpose ? ' (' + o.purpose + ')' : '') + '.');
      if (!D.hasBuilder(o) || (APB.rap && APB.rap.isDraftTable(state, o))) return;
      D.objectDef(o.type).fields.forEach(function (f) {
        if (f.ask && D.isVisible(f, o.detail) && !V.isFilled(o.detail[f.id])) q.push(label + ': ' + f.ask + '.');
      });
      walkFields(D.objectDef(o.type).fields, o.detail || {}, function (f, v) {
        if ((f.kind === 'radio' || f.kind === 'select') && v === 'tbc') q.push(label + ': ' + f.label + '.');
      });
    });

    if (APB.rap) APB.rap.checks(state).forEach(function (c) { q.push(c.text); });

    const qa = state.quality;
    if (qa.authorization === 'tbc') q.push('Whether authority checks are required.');
    if ((qa.authorization === 'yes' || qa.authorization === 'tbc') && !V.isFilled(qa.authChecks)) q.push('Exact authorization object(s) and field values.');
    if (qa.cleanCore === 'tbc') q.push('Whether standard SAP functionality / released APIs can be reused.');
    return q.filter(function (x, i) { return q.indexOf(x) === i; });
  }

  function evaluate(state) {
    const mandatory = V.checkMandatory(state);
    const missing = missingRecommended(state);
    const important = missing.filter(function (r) { return r.important; });
    let level = 'ready';
    if (mandatory.length) level = 'blocked'; else if (important.length) level = 'almost';
    const applicable = V.rules.recommended.filter(function (r) { return ruleApplies(r, state); }).length;
    const total = V.rules.mandatory.length * 2 + applicable;
    const done = (V.rules.mandatory.length - mandatory.length) * 2 + (applicable - missing.length);
    return {
      level: level,
      progress: total ? done / total : 0,
      mandatory: mandatory,
      important: important,
      optional: missing.filter(function (r) { return !r.important; }),
      counts: counts(state),
      questions: openQuestions(state)
    };
  }

  function haveTypes(state) {
    const have = {};
    state.objects.forEach(function (o) { have[o.type] = true; });
    return have;
  }

  /* Object types worth suggesting from the requirement text (suggestions only; the developer decides). */
  function suggest(state) {
    const text = (state.requirement.text + ' ' + state.requirement.objective + ' ' + state.requirement.expectedOutput).toLowerCase();
    const have = haveTypes(state);
    const out = [];
    D.suggestions.forEach(function (s) {
      if (have[s.type] || out.some(function (x) { return x.type === s.type; })) return;
      if (new RegExp(s.match, 'i').test(text)) out.push({ type: s.type, label: s.label, status: 'tbc' });
    });
    return out;
  }

  /* The main object of every selected development type, if the developer has not listed one yet. */
  function mainObjectChips(state) {
    const have = haveTypes(state);
    const chips = [];
    state.types.forEach(function (t) {
      const kinds = D.types[t].mainObject;
      if (kinds.some(function (k) { return have[k]; })) return;
      chips.push({ type: kinds[0], label: 'New ' + kinds[0], status: 'new' });
    });
    return chips;
  }

  /* Customer (Z/Y or /namespace/) DDIC objects referenced in builder grids but not listed as objects. */
  function unlistedReferences(state) {
    const listed = {};
    state.objects.forEach(function (o) { if (o.name) listed[o.name.trim().toUpperCase()] = true; });
    const out = [];
    function note(type, name, row) {
      const n = String(name || '').trim().toUpperCase().split(/[\s(]/)[0].replace(/-.*$/, '');
      if (type === 'Data Element') {
        // a "type" cell may hold any DDIC type: guess from typing and SAP naming habits
        if (row && row.typing === 'TYPE REF TO') type = /^(Z|Y)IF_/.test(n) ? 'Interface' : 'Class';
        else if (/(^|_)TT_|^[ZY]TT/.test(n)) type = 'Table Type';
        else if (/(^|_)S_|^[ZY]S_/.test(n) || (row && row.typing === 'TYPE TABLE OF')) type = 'Structure';
      }
      if (!/^(Z|Y|\/\w+\/)\w+/.test(n) || listed[n]) return;
      if (!out.some(function (x) { return x.name === n; })) out.push({ type: type, name: n });
    }
    state.objects.forEach(function (o) {
      if (!D.hasBuilder(o)) return;
      walkFields(D.objectDef(o.type).fields, o.detail || {}, function (f, v) {
        if (f.kind !== 'grid' || !Array.isArray(v)) return;
        f.columns.forEach(function (c) {
          if (c.ref) v.forEach(function (row) { if (row) note(c.ref, row[c.id], row); });
        });
      });
      if (o.type === 'Data Element' && o.detail.category === 'domain') note('Domain', o.detail.domain);
      if (o.type === 'Table Type') note('Structure', o.detail.lineType);
    });
    return out;
  }

  APB.completeness = {
    TBC: TBC,
    evaluate: evaluate,
    openQuestions: openQuestions,
    buildTree: buildTree,
    treeToText: treeToText,
    objectLabel: objectLabel,
    detailFilled: detailFilled,
    suggest: suggest,
    mainObjectChips: mainObjectChips,
    unlistedReferences: unlistedReferences
  };
})(window.APB = window.APB || {});
