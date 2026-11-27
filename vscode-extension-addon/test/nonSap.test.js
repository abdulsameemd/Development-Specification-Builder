'use strict';
// Non-SAP ("Other platform") Technical specs: platform filter, solution components, mapping, completion, profile.
// SAP must not change – see tests/e2e/sap-snapshot.test.js for the byte-identical SAP outputs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const window = {};
const ctx = vm.createContext({ window, console, Date, JSON, Math, TextEncoder, TextDecoder, Uint8Array });
['config-bundle', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator', 'fs-state', 'discovery',
  'fs-completeness', 'fs-generator', 'fs-draft', 'fs-to-ts', 'ts-draft'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
const APB = window.APB;
const D = APB.defs;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('platform filter: lists are SAP unless "generic" is asked for; lookups know both', () => {
  const sap = plain(D.typeKeys());
  assert.ok(sap.includes('REPORT') && !sap.some((k) => /^G_/.test(k)));
  assert.deepStrictEqual(plain(D.typeKeys('generic')), ['G_WEB', 'G_API', 'G_DATA', 'G_POWERAPP', 'G_FLOW', 'G_INTEG', 'G_JOB']);
  assert.deepStrictEqual(plain(D.typeKeys({ platform: 'generic' })), plain(D.typeKeys('generic')));
  assert.ok(!D.objectTypes.includes('API Endpoint'), 'the SAP object list is unchanged');
  assert.ok(D.objectTypesFor('generic').includes('API Endpoint') && !D.objectTypesFor('generic').includes('Report'));
  assert.strictEqual(D.types.G_API.mainObject[0], 'API Endpoint');
  assert.ok(D.objectDef('API Endpoint').fields.some((f) => f.id === 'request'));
  assert.ok(D.stacks.length >= 6);
  // state: SAP specs keep their shape, generic specs keep platform + stack
  assert.ok(!('platform' in APB.state.migrate({ types: ['REPORT'] })));
  const g = APB.state.migrate({ platform: 'generic', stack: 'Java (Spring Boot)', types: ['G_API', 'REPORT_X'], objects: [{ type: 'API Endpoint', name: 'X', status: 'new' }] });
  assert.deepStrictEqual([g.platform, g.stack, plain(g.types), g.objects[0].type], ['generic', 'Java (Spring Boot)', ['G_API'], 'API Endpoint']);
});

function portalFs() {
  const s = APB.fs.model.blank();
  s.context.system = 'other'; s.context.systemName = 'Portal'; s.context.title = 'Open orders portal';
  s.context.requirement = 'Customers see their open orders.';
  s.reqs.data = [
    { field: 'Order status', table: 'Order', sapField: 'Status', usage: 'selection', mandatory: true },
    { field: 'Order number', table: 'Order', sapField: 'OrderNo', usage: 'output' },
    { field: 'Delivery note', table: 'Order', sapField: 'DeliveryNote', usage: 'stored', validation: 'max 200 characters' }];
  s.solution.interfaces = [{ name: 'Orders from ERP', direction: 'inbound', partner: 'ERP' }];
  s.solution.ricefw = [{ type: 'api', description: 'Open orders service', frs: 'FR-01' }, { type: 'screen', description: 'Open orders page' }];
  return APB.fs.model.migrate(s);
}

test('FS "Other system": solution components (C-01 …), view and document; hidden while the system is open', () => {
  const s = portalFs();
  assert.deepStrictEqual(plain(APB.fs.ricefwIds(s.solution.ricefw)), ['C-01', 'C-02']);
  assert.strictEqual(APB.fs.ricefwType('api').devType, 'G_API');
  assert.strictEqual(APB.fs.ricefwType('report').devType, 'REPORT', 'SAP values keep their meaning');
  const v = APB.fs.view(APB.fs.field('solution', 'ricefw'), s);
  assert.strictEqual(v.label, 'Solution components');
  assert.deepStrictEqual(plain(v.fields.find((f) => f.id === 'type').options.map((o) => o.value).slice(1, 4)), ['screen', 'api', 'data']);
  const tbd = APB.fs.model.blank(); tbd.context.system = 'tbd';
  assert.strictEqual(APB.fs.view(APB.fs.field('solution', 'ricefw'), tbd), null);
  const sap = APB.fs.model.blank(); sap.context.system = 'sap';
  assert.strictEqual(APB.fs.view(APB.fs.field('solution', 'ricefw'), sap).label, 'RICEFW items', 'SAP view unchanged');
  const md = APB.fsMarkdown.build(s);
  assert.match(md, /Solution components/);
  assert.match(md, /\| C-02 \| Web screen \/ page \|/);
  assert.match(APB.fsDraft.prompt(s), /"ricefw": \[\n    \{\n      "type": "api"/);
  assert.match(APB.fsDraft.prompt(s), /- ricefw: the solution components to build/);
  assert.doesNotMatch(APB.fsDraft.prompt(sap), /"ricefw"/, 'SAP draft shape unchanged');
});

test('generic mapping: API request / response, screen fields, entity columns, integration source and mapping; PascalCase names', () => {
  const s = portalFs();
  const api = plain(APB.fsToTs.designer(s, 'API Endpoint', s.solution.ricefw[0]));
  assert.deepStrictEqual(api.request.map((r) => [r.name, r.in, r.required]), [['orderStatus', 'query', true]]);
  assert.deepStrictEqual(api.response.map((r) => [r.name, r.source]), [['orderNumber', 'Order.OrderNo']]);
  const scr = plain(APB.fsToTs.designer(s, 'Web Screen', s.solution.ricefw[1]));
  assert.deepStrictEqual(scr.fields.map((f) => [f.field, f.mandatory, f.source]), [['orderStatus', true, 'Order.Status'], ['orderNumber', false, 'Order.OrderNo']]);
  const ent = plain(APB.fsToTs.designer(s, 'Data Entity', s.solution.ricefw[0]));
  assert.deepStrictEqual(ent.columns.map((c) => [c.name, c.nullable, c.description]), [['DeliveryNote', true, 'Delivery note – max 200 characters']]);
  const itf = plain(APB.fsToTs.designer(s, 'Integration Flow', s.solution.ricefw[0]));
  assert.strictEqual(itf.source, 'ERP');
  assert.strictEqual(APB.fsToTs.proposeName(s, s.solution.ricefw[0], 'API Endpoint'), 'OpenOrdersApi');
  assert.strictEqual(APB.fsToTs.proposeName(s, s.solution.ricefw[1], 'Web Screen'), 'OpenOrdersPage');
});

function genericTs() {
  const s = portalFs();
  return APB.state.migrate({ platform: 'generic', stack: '.NET (C# / ASP.NET Core)', types: ['G_API'], requirement: { text: 'Open orders' },
    objects: [{ type: 'API Endpoint', name: 'OpenOrdersApi', status: 'new', detail: plain(APB.fsToTs.designer(s, 'API Endpoint', s.solution.ricefw[0])) }],
    quality: { authorization: 'no' }, origin: { fsText: APB.fsToTs.fsText(s), names: APB.fsToTs.fsNames(s) } });
}

test('generic completion: no SAP wording, Entity.Field grounding, framework members allowed, authorization untouched', () => {
  const s = genericTs();
  const p = APB.tsDraft.prompt(s);
  assert.match(p, /^TS-DRAFT v1\nComplete the technical specification below for GitHub Copilot \(agent mode\)[^\n]*\(\.NET \(C# \/ ASP\.NET Core\)\)/);
  assert.doesNotMatch(p, /SAP|ABAP|S_ \/ P_/);
  assert.match(p, /Never invent table, column or endpoint names/);
  assert.match(p, /- request \(Request parameters \/ body\): array of \{ name, in \(path \| query \| header \| body\)/);
  const ans = { kind: 'dewa-ts-draft', version: 1, objects: [{ name: 'OpenOrdersApi', type: 'API Endpoint', detail: {
    logic: 'Filter Order.Status, read Customer.Email, stamp DateTime.UtcNow', method: 'GET', auth: 'Magic' } }],
    quality: { authorization: 'yes', cleanCore: 'yes', dataVolume: 'small' } };
  const d = plain(APB.tsDraft.parse('```json\n' + JSON.stringify(ans) + '\n```', s).draft);
  assert.strictEqual(d.objects[0].detail.logic, 'Filter Order.Status, read [TO BE CONFIRMED] Customer.Email, stamp DateTime.UtcNow');
  assert.strictEqual(d.unconfirmed, 1);
  assert.ok(!('auth' in d.objects[0].detail), 'option value not in the list → dropped');
  assert.deepStrictEqual(Object.keys(d.quality), ['dataVolume'], 'no authorization, no clean core for generic');
});

test('generic TS document and hand-off: agent mode, repository instructions, no SAP instructions', () => {
  const s = genericTs();
  const md = APB.markdown.build(s);
  assert.match(md, /Inspect the existing repository first and follow its architecture/);
  assert.match(md, /APIs: return the specified status codes/);
  assert.match(md, /No authorization requirement is specified – do not add roles/);
  assert.doesNotMatch(md, /Clean ABAP|SAP Clean Core|ABAP Unit|dewa-abap/);
  assert.deepStrictEqual(plain(APB.markdown.handoff(s).agents), ['agent']);
  assert.match(APB.markdown.chatPrompt(s), /^DEWA-GENERIC v1\nImplement the technical specification below in this repository \(\.NET/);
  // SAP spec: unchanged hand-off
  assert.deepStrictEqual(plain(APB.markdown.handoff(APB.state.migrate({ types: ['REPORT'], objects: [{ type: 'Report', name: 'ZX', status: 'new' }] })).agents), ['dewa-abap']);
});
