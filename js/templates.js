/* Quick-start templates and the demo example (data lives in config/templates.json). */
(function (APB) {
  'use strict';
  const cfg = APB.config.templates;

  function list() { return cfg.templates; }

  /* Templates give structure only; they never fill in made-up business information. */
  function fromTemplate(id) {
    const t = cfg.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return null;
    return APB.state.migrate({
      types: t.types,
      objects: (t.objects || []).map(function (o) { return Object.assign({ id: APB.state.uid() }, o); }),
      details: t.details || {}
    });
  }

  function example() {
    const e = JSON.parse(JSON.stringify(cfg.example.state));
    e.objects.forEach(function (o) { o.id = APB.state.uid(); });
    e.rules.forEach(function (r) { r.id = APB.state.uid(); });
    e.acceptance.forEach(function (a) { a.id = APB.state.uid(); });
    return APB.state.migrate(e);
  }

  APB.templates = { list: list, fromTemplate: fromTemplate, example: example };
})(window.APB = window.APB || {});
