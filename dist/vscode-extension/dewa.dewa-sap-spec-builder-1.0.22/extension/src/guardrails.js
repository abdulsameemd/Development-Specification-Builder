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

/* ------------------------------------------------------------- usage: tokens, model calls */
/* Wraps model.sendRequest: counts the tokens of everything sent and received with the model's own tokenizer
   (model.countTokens); falls back to characters / 4, marked as estimated. Totals land in ev.usage. */
function partText(p) {
  if (p == null) return '';
  if (typeof p === 'string') return p;
  if (typeof p.value === 'string') return p.value;
  if (p.name && p.input !== undefined) return p.name + ' ' + JSON.stringify(p.input); // tool call
  if (Array.isArray(p.content)) return p.content.map(partText).join('\n');         // tool result
  return '';
}
function messageText(m) { return Array.isArray(m && m.content) ? m.content.map(partText).join('\n') : partText(m && m.content); }
function meter(model, ev, onUsage) {
  const u = ev.usage = ev.usage || { requests: 0, inputTokens: 0, outputTokens: 0, estimated: false };
  const cache = new WeakMap();
  async function count(text, token) {
    if (!text) return 0;
    if (typeof model.countTokens === 'function') {
      try { const n = await model.countTokens(text, token); if (typeof n === 'number' && n >= 0) return n; } catch (e) { /* fall back */ }
    }
    u.estimated = true;
    return Math.ceil(text.length / 4);
  }
  async function inputTokens(messages, token) {
    let n = 0;
    for (const m of messages) {
      if (m && typeof m === 'object' && cache.has(m)) { n += cache.get(m); continue; }
      const c = await count(messageText(m), token);
      if (m && typeof m === 'object') cache.set(m, c);
      n += c;
    }
    return n;
  }
  return {
    /* → { stream } like sendRequest; the answer's text is counted when collect() is called with it */
    send: async function (messages, options, token) {
      u.requests++;
      u.inputTokens += await inputTokens(messages, token);
      return model.sendRequest(messages, options, token);
    },
    answered: async function (text, calls, token) {
      u.outputTokens += await count(String(text || '') + (calls || []).map(partText).join('\n'), token);
      if (onUsage) onUsage(u);
    },
    usage: u
  };
}
function fmtTokens(n) { return n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function usageLine(ev) {
  const u = ev.usage || { inputTokens: 0, outputTokens: 0 };
  const art = (ev.artifacts || []).length;
  return (u.estimated ? '≈ ' : '') + fmtTokens(u.inputTokens + u.outputTokens) + ' tokens' +
    (ev.searches !== undefined ? ' · ' + ev.searches + ' SAP search' + (ev.searches === 1 ? '' : 'es') + ' · ' + art + ' ABAP artifact' + (art === 1 ? '' : 's') + ' read' : '');
}

const SEARCH_WORDS = ['search', 'find', 'list', 'query', 'where', 'lookup', 'browse', 'quick'];
/* A tool that looks objects up (search) rather than reading one object (source, metadata, outline …). */
function isSearchTool(name) {
  const w = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/);
  return w.some(function (x) { return SEARCH_WORDS.indexOf(x) >= 0; });
}

module.exports = { meter: meter, usageLine: usageLine, isSearchTool: isSearchTool, messageText: messageText, injection: injection, mask: mask, names: names, allowedModels: allowedModels, notAllowedError: notAllowedError, modelLabel: modelLabel };
