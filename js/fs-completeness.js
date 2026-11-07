/* "Ready for sign-off" evaluation and open questions for functional specifications.
   Same idea as completeness.js: two mandatory fields, the rest are recommendations — never blockers. */
(function (APB) {
  'use strict';
  const F = APB.fs, V = APB.validation, S = APB.state;
  const TBC = APB.completeness.TBC;

  function frs(s) { return (s.reqs.frs || []).filter(V.isFilled); }
  function ricefw(s) { return (s.solution.ricefw || []).filter(V.isFilled); }

  function checkMandatory(s) {
    return F.rulesFor(F.cfg.mandatory, s).filter(function (r) {
      const v = S.getPath(s, r.path);
      if (r.minLength) return !(typeof v === 'string' && v.trim().length >= r.minLength);
      return !V.isFilled(v);
    });
  }

  function token(s, t) {
    switch (t) {
      case 'fr:acceptance': { const l = frs(s); return l.length > 0 && l.every(function (f) { return V.isFilled(f.acceptance); }); }
      case 'fr:fit': { const l = frs(s); return l.length > 0 && l.every(function (f) { return f.fit && f.fit !== 'tbc'; }); }
      case 'fr:hasGap': return frs(s).some(function (f) { return f.fit === 'custom'; });
      case 'discovery': return !!s.discovery;
      default: return V.isFilled(S.getPath(s, t));
    }
  }

  function missingRecommended(s) {
    return F.rulesFor(F.cfg.recommended, s).filter(function (r) {
      if (r.when && !token(s, r.when)) return false;
      return !r.anyOf.some(function (t) { return token(s, t); });
    });
  }

  /* FRs whose fit is "custom" but which no RICEFW item lists under "Covers FRs". */
  function uncoveredGaps(s) {
    const covered = {};
    ricefw(s).forEach(function (r) { F.parseFrRefs(r.frs).forEach(function (id) { covered[id] = true; }); });
    const out = [];
    (s.reqs.frs || []).forEach(function (f, i) { if (f && f.fit === 'custom' && !covered[F.frId(i)]) out.push(F.frId(i)); });
    return out;
  }

  function openQuestions(s) {
    const q = [];
    const sap = F.isSap(s);
    (s.reqs.frs || []).forEach(function (f, i) {
      if (!V.isFilled(f)) return;
      const id = F.frId(i) + (f.title ? ' (' + f.title.trim() + ')' : '');
      if (!V.isFilled(f.acceptance)) q.push(id + ': acceptance criteria.');
      if (!f.fit || f.fit === 'tbc') q.push(id + (sap ? ': fit-gap – SAP standard, configuration or custom development?' : ': fit-gap – standard feature, configuration or new development?'));
    });
    if (!sap) { missingRecommended(s).forEach(function (r) { if (r.question) q.push(r.question); }); return q; }
    uncoveredGaps(s).forEach(function (id) { q.push(id + ' is a gap, but no RICEFW item covers it yet.'); });
    const ids = F.ricefwIds(s.solution.ricefw);
    (s.solution.ricefw || []).forEach(function (r, i) {
      if (!V.isFilled(r)) return;
      if (!r.type) q.push('RICEFW item ' + (i + 1) + ': RICEFW type.');
      if (!(r.name || '').trim()) q.push(ids[i] + ': proposed object name.');
    });
    (s.reqs.data || []).forEach(function (d) {
      if (V.isFilled(d) && d.field && !(d.table || '').trim()) q.push('Data field “' + d.field.trim() + '”: SAP table / CDS view and field.');
    });
    if (APB.discovery && s.discovery) {
      APB.discovery.crossCheck(s).filter(function (r) { return r.status === 'missing'; }).forEach(function (r) {
        q.push(r.name + ' (' + r.where + ') was not found in the system by discovery – confirm the name or mark it as new.');
      });
    }
    missingRecommended(s).forEach(function (r) { if (r.question) q.push(r.question); });
    return q;
  }

  function counts(s) {
    const l = frs(s);
    return {
      frs: l.length,
      must: l.filter(function (f) { return f.priority === 'must'; }).length,
      standard: l.filter(function (f) { return f.fit === 'standard' || f.fit === 'config'; }).length,
      gaps: l.filter(function (f) { return f.fit === 'custom'; }).length,
      ricefw: ricefw(s).length,
      uat: (s.quality.uat || []).filter(V.isFilled).length,
      toBe: (s.process.toBe || []).filter(V.isFilled).length
    };
  }

  function evaluate(s) {
    const mandatory = checkMandatory(s);
    const missing = missingRecommended(s);
    const important = missing.filter(function (r) { return r.important; });
    const applicable = F.rulesFor(F.cfg.recommended, s).filter(function (r) { return !r.when || token(s, r.when); }).length;
    const nMandatory = F.rulesFor(F.cfg.mandatory, s).length;
    const total = nMandatory * 2 + applicable;
    const done = (nMandatory - mandatory.length) * 2 + (applicable - missing.length);
    return {
      level: mandatory.length ? 'blocked' : important.length ? 'almost' : 'ready',
      progress: total ? done / total : 0,
      mandatory: mandatory,
      important: important,
      optional: missing.filter(function (r) { return !r.important; }),
      counts: counts(s),
      questions: openQuestions(s)
    };
  }

  APB.fsCompleteness = { TBC: TBC, evaluate: evaluate, checkMandatory: checkMandatory, openQuestions: openQuestions, uncoveredGaps: uncoveredGaps, frs: frs, ricefw: ricefw };
})(window.APB = window.APB || {});
