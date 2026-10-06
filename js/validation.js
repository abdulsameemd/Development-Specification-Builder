/* Mandatory-field checks (only two by design) and shared value helpers. */
(function (APB) {
  'use strict';
  const rules = APB.config.validation;

  /* true when a value carries real content (strings, arrays of strings/objects, objects). */
  function isFilled(v) {
    if (v == null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return true;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.some(isFilled);
    if (typeof v === 'object') return Object.keys(v).some(function (k) { return k !== 'id' && isFilled(v[k]); });
    return true;
  }

  function checkMandatory(state) {
    return rules.mandatory.filter(function (r) {
      const v = APB.state.getPath(state, r.path);
      if (r.minLength) return !(typeof v === 'string' && v.trim().length >= r.minLength);
      if (r.minItems) return !(Array.isArray(v) && v.length >= r.minItems);
      return !isFilled(v);
    });
  }

  APB.validation = { rules: rules, isFilled: isFilled, checkMandatory: checkMandatory };
})(window.APB = window.APB || {});
