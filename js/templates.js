/* Quick-start templates and worked examples (data lives in config/templates.json). */
(function (APB) {
  'use strict';
  const cfg = APB.config.templates;

  function withIds(state) {
    (state.objects || []).forEach(function (o) { o.id = APB.state.uid(); });
    (state.rules || []).forEach(function (r) { r.id = APB.state.uid(); });
    (state.acceptance || []).forEach(function (a) { a.id = APB.state.uid(); });
    return APB.state.migrate(state);
  }

  /* Templates give structure only; they never fill in made-up business information. */
  function fromTemplate(id) {
    const t = cfg.templates.filter(function (x) { return x.id === id; })[0];
    return t ? withIds(JSON.parse(JSON.stringify({ types: t.types, objects: t.objects || [] }))) : null;
  }

  function example(id) {
    const e = cfg.examples.filter(function (x) { return x.id === id; })[0] || cfg.examples[0];
    return withIds(JSON.parse(JSON.stringify(e.state)));
  }

  APB.templates = {
    list: function () { return cfg.templates; },
    examples: function () { return cfg.examples; },
    fromTemplate: fromTemplate,
    example: example
  };
})(window.APB = window.APB || {});
