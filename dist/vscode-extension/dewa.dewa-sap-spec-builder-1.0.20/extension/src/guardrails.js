'use strict';
/* Guardrails on the extension side of the read-only tool loop (the builder side is js/guard.js; keep the patterns in
   step):
   - model allow-list (dewaSpecBuilder.models.allowed);
   - every SAP tool result is marked as data and screened for prompt injection;
   - personal data in tool results is masked (irreversibly) before the model sees it (dewaSpecBuilder.masking);
   - evidence for grounding: which tools were called and which SAP names their results contain. */

const INJECTION = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
  /\byou are now\b|\bfrom now on,? you\b|\bact as (an?|the) /i,
  /\b(system|developer) (prompt|message|instructions?)\b/i,
  /\bnew instructions?\s*:/i,
  /\b(do not|don't) (tell|inform|show) (the )?(user|reviewer)\b/i,
  /\b(create|activate|delete|transport|release|modify|change)\b[^.\n]{0,40}\b(in (the )?sap|transport request|without (asking|review|approval))\b/i,
  /<\/?(system|assistant|instructions?)>/i
];
function injection(text) {
  return String(text || '').split(/\n+/).filter(function (l) { return INJECTION.some(function (re) { return re.test(l); }); }).slice(0, 10).map(function (l) { return l.trim().slice(0, 160); });
}

function luhn(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
function ibanOk(v) {
  const x = v.replace(/ /g, '');
  if (x.length < 15 || x.length > 34) return false;
  const r = (x.slice(4) + x.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
  let m = 0;
  for (let i = 0; i < r.length; i++) m = (m * 10 + +r[i]) % 97;
  return m === 1;
}
const BUILTIN = [
  { name: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'EMIRATES_ID', re: /\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g },
  { name: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g, test: ibanOk },
  { name: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g, test: function (v) { const d = v.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); } },
  { name: 'PHONE', re: /\+\d{1,3}[ -]?\(?\d{1,4}\)?(?:[ -]?\d{2,4}){2,4}\b|\b05\d[ -]?\d{3}[ -]?\d{4}\b|\b0[2-9][ -]\d{3}[ -]?\d{4}\b/g }
];
function customPatterns(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map(function (x) {
    const src = typeof x === 'string' ? x : x && x.regex;
    const name = (x && typeof x === 'object' && x.name ? String(x.name) : 'CUSTOM').toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20) || 'CUSTOM';
    try { return { name: name, re: new RegExp(String(src).slice(0, 300), 'g') }; } catch (e) { return null; }
  }).filter(Boolean);
}
/* Irreversible masking (the model never needs the real value of a person's data read from SAP). → { text, count } */
function mask(text, patterns) {
  let count = 0;
  let out = String(text || '');
  BUILTIN.concat(customPatterns(patterns)).forEach(function (p) {
    out = out.replace(p.re, function (v) {
      if (/^\[[A-Z_]+\]$/.test(v) || (p.test && !p.test(v))) return v;
      count++;
      return '[' + p.name + ']';
    });
  });
  return { text: out, count: count };
}

/* SAP-style names in a text (upper case, digits, _ and /), for grounding. */
function names(text, into, max) {
  const set = into || {};
  const limit = max || 5000;
  String(text || '').replace(/(?:^|[^A-Za-z0-9_/])([A-Z][A-Z0-9_/]{1,39})(?![A-Za-z0-9_/])/g, function (_, n) {
    if (Object.keys(set).length < limit) set[n] = true;
    return _;
  });
  return set;
}

function globToRegExp(g) { return new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); }
function modelLabel(m) { return [m.family, m.name, m.id].filter(Boolean).join(' '); }
/* Allowed patterns match the family, name or id: "gpt-5*", "*sonnet*", or a plain word ("sonnet" = contains). */
function allowedModels(models, allowed) {
  const pats = (Array.isArray(allowed) ? allowed : []).map(String).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!pats.length) return models;
  const res = pats.map(function (p) { return /[*?]/.test(p) ? globToRegExp(p) : new RegExp(p.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i'); });
  return (models || []).filter(function (m) {
    return [m.family, m.name, m.id].filter(Boolean).some(function (v) { return res.some(function (re) { return re.test(String(v)); }); });
  });
}
function notAllowedError(models, allowed) {
  const e = new Error('None of the available Copilot models is allowed by the setting dewaSpecBuilder.models.allowed (' + allowed.join(', ') + '). Available: ' +
    ((models || []).map(modelLabel).join('; ') || 'none') + '.');
  e.code = 'MODEL_NOT_ALLOWED';
  return e;
}

module.exports = { injection: injection, mask: mask, names: names, allowedModels: allowedModels, notAllowedError: notAllowedError, modelLabel: modelLabel };
