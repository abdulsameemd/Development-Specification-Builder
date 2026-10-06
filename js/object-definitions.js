/* Accessors over the configuration (config/*.json, bundled into config-bundle.js). */
(function (APB) {
  'use strict';
  APB.config = window.APB_CONFIG;

  const defs = APB.config.definitions;

  function typeKeys() { return Object.keys(defs.types); }

  /* Visible fields for an object type. Advanced fields are returned separately. */
  function typeFields(type) {
    const all = (defs.types[type] && defs.types[type].fields) || [];
    return { essential: all.filter(function (f) { return !f.advanced; }), advanced: all.filter(function (f) { return f.advanced; }) };
  }

  /* showIf: { field, in:[...] } | { field, includes:value } evaluated against a values bag. */
  function isVisible(field, values) {
    if (!field.showIf) return true;
    const v = values ? values[field.showIf.field] : undefined;
    if (field.showIf.in) return field.showIf.in.indexOf(v) >= 0;
    if (field.showIf.includes !== undefined) return Array.isArray(v) && v.indexOf(field.showIf.includes) >= 0;
    return true;
  }

  function optionLabel(field, value) {
    const o = (field.options || []).filter(function (x) { return x.value === value; })[0];
    return o ? o.label : value;
  }

  function performanceRelevant(types) {
    return types.some(function (t) { return defs.types[t] && defs.types[t].performance; });
  }

  APB.defs = {
    types: defs.types,
    typeKeys: typeKeys,
    typeFields: typeFields,
    isVisible: isVisible,
    optionLabel: optionLabel,
    performanceRelevant: performanceRelevant,
    objectTypes: defs.sapObjectTypes,
    statuses: defs.objectStatuses,
    quality: defs.common.quality,
    advanced: defs.common.advanced,
    suggestions: defs.suggestions,
    statusLabel: function (v) { const s = defs.objectStatuses.filter(function (x) { return x.value === v; })[0]; return s ? s.label : v; }
  };
})(window.APB = window.APB || {});
