/* Accessors over the configuration (config/*.json, bundled into config-bundle.js). */
(function (APB) {
  'use strict';
  APB.config = window.APB_CONFIG;

  const defs = APB.config.definitions;
  const EMPTY = { group: 'Other', tcode: '', abapNaming: false, usedHint: '', fields: [] };
  // non-SAP (generic) platform: its own dev types and object designers (config/generic-definitions.json). Lookups
  // know both; every LIST is SAP unless 'generic' is asked for, so SAP screens and documents stay as they were.
  const gen = APB.config.generic || { devTypes: {}, objectTypes: {}, objectGroups: [], stacks: [], components: [] };
  const allTypes = Object.assign({}, defs.devTypes, gen.devTypes);
  const allObjects = Object.assign({}, defs.objectTypes, gen.objectTypes);
  function isGeneric(p) { return p === 'generic' || (p && typeof p === 'object' && p.platform === 'generic'); }

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

  function objectDef(type) { return allObjects[type] || EMPTY; }

  /* New and changed objects get the full builder; reused / unconfirmed ones only "what you need from it". */
  function hasBuilder(o) { return (o.status === 'new' || o.status === 'change') && objectDef(o.type).fields.length > 0; }

  // quality questions with the non-SAP labels (config generic.quality); SAP gets the shared list itself
  const genQuality = defs.common.quality.map(function (f) {
    const o = (gen.quality || {})[f.id];
    if (!o) return f;
    const c = Object.assign({}, f, o.label ? { label: o.label } : {});
    if (o.options && f.options) c.options = f.options.map(function (x) { return o.options[x.value] ? Object.assign({}, x, { label: o.options[x.value] }) : x; });
    return c;
  });

  APB.defs = {
    qualityFor: function (platform) { return isGeneric(platform) ? genQuality : defs.common.quality; },
    genericDod: gen.definitionOfDone || [],
    types: allTypes,
    // platform: 'sap' (default) | 'generic', or a spec state
    typeKeys: function (platform) { return Object.keys(isGeneric(platform) ? gen.devTypes : defs.devTypes); },
    isGeneric: isGeneric,
    stacks: gen.stacks || [],
    components: gen.components || [],
    objectTypesFor: function (platform) { return Object.keys(isGeneric(platform) ? gen.objectTypes : defs.objectTypes); },
    objectGroupsFor: function (platform) { return isGeneric(platform) ? gen.objectGroups : defs.objectGroups; },
    allObjectTypes: Object.keys(allObjects),
    isVisible: isVisible,
    optionLabel: optionLabel,
    performanceRelevant: function (types) { return types.some(function (t) { return allTypes[t] && allTypes[t].performance; }); },
    objectTypes: Object.keys(defs.objectTypes),
    objectGroups: defs.objectGroups,
    objectDef: objectDef,
    hasBuilder: hasBuilder,
    statuses: defs.objectStatuses,
    quality: defs.common.quality,
    suggestions: defs.suggestions,
    datalists: defs.datalists,
    statusLabel: function (v) { const s = defs.objectStatuses.filter(function (x) { return x.value === v; })[0]; return s ? s.label : v; }
  };
})(window.APB = window.APB || {});
