/* "Ready for Copilot" status, dependency tree and open questions.
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
    const placed = {};
    function attach(node, parent) { parent.children.push(node); placed[node.obj.id] = true; }
    // parents first so that cycles never hide nodes
    state.objects.forEach(function (o) {
      const p = o.parent && o.parent !== o.id && byId[o.parent] ? byId[o.parent] : null;
      if (p && !createsCycle(o, byId)) attach(byId[o.id], p); else attach(byId[o.id], root);
    });
    return root;
  }

  function createsCycle(o, byId) {
    const seen = {};
    let cur = o;
    while (cur && cur.parent && byId[cur.parent]) {
      if (seen[cur.id]) return true;
      seen[cur.id] = true;
      if (cur.parent === o.id) return true;
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

  function counts(state) {
    const c = { existing: 0, new: 0, tbc: 0, dependencies: state.objects.length };
    state.objects.forEach(function (o) { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }

  function ruleApplies(rule, state) {
    return rule.types === '*' || state.types.some(function (t) { return rule.types.indexOf(t) >= 0; });
  }

  function missingRecommended(state) {
    return V.rules.recommended.filter(function (r) {
      if (!ruleApplies(r, state)) return false;
      return !r.anyOf.some(function (p) { return V.isFilled(APB.state.getPath(state, p)); });
    });
  }

  /* Questions derived from missing info and from explicit "To Be Confirmed" choices. Nothing is invented. */
  function openQuestions(state) {
    const q = [];
    missingRecommended(state).forEach(function (r) { if (r.question) q.push(r.question); });

    state.objects.forEach(function (o) {
      const name = o.name && o.name.trim();
      if (o.status === 'tbc') q.push('Confirm whether ' + o.type + (name ? ' ' + name : ' (unnamed)') + ' already exists in the system.');
      else if (!name) q.push(o.status === 'new' ? 'Proposed name for the new ' + o.type + '.' : 'Name of the existing ' + o.type + (o.purpose ? ' (' + o.purpose + ')' : '') + '.');
    });

    const qa = state.quality;
    if (qa.authorization === 'tbc') q.push('Whether authorization checks are required.');
    if ((qa.authorization === 'yes' || qa.authorization === 'tbc') && !(qa.authObject || '').trim()) q.push('Exact authorization object / role.');
    if (qa.cleanCore === 'tbc') q.push('Whether standard SAP functionality / released APIs can be reused.');

    state.types.forEach(function (t) {
      const values = state.details[t] || {};
      D.typeFields(t).essential.concat(D.typeFields(t).advanced).forEach(function (f) {
        if ((f.kind === 'radio' || f.kind === 'select') && values[f.id] === 'tbc' && D.isVisible(f, values)) {
          q.push(f.label + ' (' + D.types[t].label + ').');
        }
      });
    });
    return q.filter(function (x, i) { return q.indexOf(x) === i; });
  }

  function evaluate(state) {
    const mandatory = V.checkMandatory(state);
    const missing = missingRecommended(state);
    const important = missing.filter(function (r) { return r.important; });
    const optional = missing.filter(function (r) { return !r.important; });
    let level = 'ready';
    if (mandatory.length) level = 'blocked'; else if (important.length) level = 'almost';
    return {
      level: level,
      mandatory: mandatory,
      important: important,
      optional: optional,
      counts: counts(state),
      questions: openQuestions(state)
    };
  }

  /* Object types worth suggesting from the requirement text (suggestions only; the developer decides). */
  function suggest(state) {
    const text = (state.requirement.text + ' ' + state.requirement.objective + ' ' + state.requirement.expectedOutput).toLowerCase();
    const have = {};
    state.objects.forEach(function (o) { have[o.type] = true; });
    const out = [];
    D.suggestions.forEach(function (s) {
      if (have[s.type] || out.some(function (x) { return x.type === s.type; })) return;
      if (new RegExp(s.match, 'i').test(text)) out.push({ type: s.type, label: s.label, status: 'tbc' });
    });
    return out;
  }

  /* The main object of every selected development type, if the developer has not listed one yet. */
  function mainObjectChips(state) {
    const have = {};
    state.objects.forEach(function (o) { have[o.type] = true; });
    const chips = [];
    state.types.forEach(function (t) {
      const kinds = D.types[t].mainObject;
      if (kinds.some(function (k) { return have[k]; })) return;
      chips.push({ type: kinds[0], label: 'New ' + D.types[t].label, status: 'new' });
    });
    return chips;
  }

  APB.completeness = {
    TBC: TBC,
    evaluate: evaluate,
    openQuestions: openQuestions,
    buildTree: buildTree,
    treeToText: treeToText,
    objectLabel: objectLabel,
    suggest: suggest,
    mainObjectChips: mainObjectChips
  };
})(window.APB = window.APB || {});
