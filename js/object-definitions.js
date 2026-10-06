/* Accessors over the configuration (config/*.json, bundled into config-bundle.js). */
(function (APB) {
  'use strict';
  APB.config = window.APB_CONFIG;

  const defs = APB.config.definitions;
  const EMPTY = { group: 'Other', tcode: '', abapNaming: false, usedHint: '', fields: [] };

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

  function objectDef(type) { return defs.objectTypes[type] || EMPTY; }

  /* New and changed objects get the full builder; reused / unconfirmed ones only "what you need from it". */
  function hasBuilder(o) { return (o.status === 'new' || o.status === 'change') && objectDef(o.type).fields.length > 0; }

  APB.defs = {
    types: defs.devTypes,
    typeKeys: function () { return Object.keys(defs.devTypes); },
    isVisible: isVisible,
    optionLabel: optionLabel,
    performanceRelevant: function (types) { return types.some(function (t) { return defs.devTypes[t] && defs.devTypes[t].performance; }); },
    objectTypes: Object.keys(defs.objectTypes),
    objectGroups: defs.objectGroups,
    objectDef: objectDef,
    hasBuilder: hasBuilder,
    statuses: defs.objectStatuses,
    quality: defs.common.quality,
    advanced: defs.common.advanced,
    suggestions: defs.suggestions,
    datalists: defs.datalists,
    statusLabel: function (v) { const s = defs.objectStatuses.filter(function (x) { return x.value === v; })[0]; return s ? s.label : v; }
  };
})(window.APB = window.APB || {});
