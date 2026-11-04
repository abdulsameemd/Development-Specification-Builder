'use strict';
// "Check & read in SAP" for development specs (js/dev-sap.js), run on the builder's own scripts in a VM.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function load() {
  const window = {};
  const ctx = vm.createContext({ window: window, console: console, Date: Date, JSON: JSON, Math: Math });
  ['config-bundle', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  });
  return window.APB;
}
const APB = load();
const DS = APB.devSap;
const plain = (x) => JSON.parse(JSON.stringify(x)); // arrays from the VM have another prototype
const same = (a, b) => assert.deepStrictEqual(plain(a), b);

function spec() {
  const s = APB.state.blank();
  s.types = ['RAP'].filter((t) => APB.defs.types[t]);
  s.requirement.text = 'Billing block rules per sales organization and customer group';
  s.objects = [
    { id: 'a', type: 'Table', name: 'ZSD_BILL_BLOCK', status: 'new', purpose: '', parent: '', detail: { description: 'My own text' } },
    { id: 'b', type: 'Table', name: 'KNVV', status: 'tbc', purpose: '', parent: '', detail: {} },
    { id: 'c', type: 'Table', name: 'ZOLD_RULES', status: 'existing', purpose: '', parent: '', detail: {} },
    { id: 'd', type: 'Class', name: 'ZCL_FREE', status: 'tbc', purpose: '', parent: '', detail: {} }
  ];
  return APB.state.migrate(s);
}

const ANSWER = 'Checked.\n```json\n' + JSON.stringify({
  kind: 'dewa-dev-context', version: 1, system: 'DEMO',
  checked: [
    { name: 'zsd_bill_block', type: 'Table', result: 'missing' },
    { name: 'KNVV', type: 'Table', result: 'verified', description: 'Customer master sales data' },
    { name: 'ZOLD_RULES', type: 'Table', result: 'missing' },
    { name: 'ZCL_FREE', type: 'Class', result: 'missing' },
    { name: 'bad name!', result: 'verified' },
    { name: 'X', result: 'maybe' }
  ],
  objects: [{
    name: 'KNVV', type: 'Table', summary: 'Sales area data of the customer.',
    detail: { description: 'Customer master sales data', deliveryClass: 'A', bogus: 'dropped', fields: [{ name: 'KUNNR', key: true, dataElement: 'KUNNR', evil: '<script>' }, { name: 'KDGRP', key: 'X' }] },
    uses: ['KNA1', 'TVKO'], usedBy: ['SAPMV45A']
  }, { name: 'NOPE', type: 'NoSuchType', detail: { x: 1 } }],
  notFound: ['ZMISSING']
}) + '\n```';

test('prompt lists every name, the objects to read and the designer ids, read-only', () => {
  const p = DS.prompt(spec());
  assert.ok(p.startsWith(DS.MARK));
  ['ZSD_BILL_BLOCK', 'KNVV', 'ZOLD_RULES', 'ZCL_FREE'].forEach((n) => assert.match(p, new RegExp(n)));
  assert.match(p, /Objects to read \(current state\): KNVV, ZOLD_RULES, ZCL_FREE/);
  assert.match(p, /- Table: description; .*fields\[name, key, dataElement/);
  assert.match(p, /READ ONLY/);
});

test('parse keeps only valid entries and the designer ids, with the designer shapes', () => {
  const r = DS.parse(ANSWER);
  assert.ok(r.ctx, r.error);
  same(r.ctx.checked.map((c) => c.name), ['ZSD_BILL_BLOCK', 'KNVV', 'ZOLD_RULES', 'ZCL_FREE']);
  const k = r.ctx.objects[0];
  same(Object.keys(k.detail).sort(), ['deliveryClass', 'description', 'fields']);
  same(k.detail.fields[0], { name: 'KUNNR', key: true, dataElement: 'KUNNR' });
  assert.strictEqual(k.detail.fields[1].key, true);
  same(r.ctx.objects[1].detail, {});
  assert.ok(!DS.parse('{"kind":"fs-draft","checked":[]}').ctx);
  assert.ok(!DS.parse('no json here').ctx);
  assert.match(DS.parse('x'.repeat(500000)).error, /too long/);
});

test('apply: statuses for unconfirmed objects, current state kept apart, the design untouched', () => {
  const s = spec();
  const ctx = DS.parse(ANSWER).ctx;
  const ids = DS.preview(s, ctx).filter((p) => p.checked && !p.info).map((p) => p.id);
  same(ids, ['check', 'status', 'current']);
  const r = DS.apply(s, ctx, ids);
  const by = (n) => r.state.objects.find((o) => o.name === n);
  assert.strictEqual(by('KNVV').status, 'existing');
  assert.strictEqual(by('ZCL_FREE').status, 'new');
  assert.strictEqual(by('ZOLD_RULES').status, 'existing');              // marked existing: never changed silently
  same(by('ZSD_BILL_BLOCK').detail, { description: 'My own text' });
  assert.strictEqual(by('KNVV').sap.summary, 'Sales area data of the customer.');
  same(by('KNVV').detail, {});
  assert.strictEqual(s.objects[1].status, 'tbc');                        // input state not mutated
  // badges and open questions
  assert.strictEqual(DS.badge(r.state, by('ZSD_BILL_BLOCK')).text, '✓ name free');
  assert.strictEqual(DS.badge(r.state, by('KNVV')).text, '✓ in system');
  assert.strictEqual(DS.badge(r.state, by('ZOLD_RULES')).text, '✗ not found');
  assert.ok(APB.completeness.openQuestions(r.state).some((q) => /ZOLD_RULES is marked as existing but was not found/.test(q)));
  // used objects only when picked
  const r2 = DS.apply(s, ctx, ['used']);
  same(r2.state.objects.slice(4).map((o) => o.name + ':' + o.status), ['KNA1:existing', 'TVKO:existing']);
  // survives save / load
  const back = APB.state.migrate(JSON.parse(JSON.stringify(r.state)));
  assert.strictEqual(back.objects.find((o) => o.name === 'KNVV').sap.detail.fields.length, 2);
  assert.strictEqual(back.sapCheck.results.length, 4);
});

test('a new name that already exists is flagged, not renamed', () => {
  const s = spec();
  const ctx = DS.parse(ANSWER.replace('"zsd_bill_block","type":"Table","result":"missing"', '"zsd_bill_block","type":"Table","result":"clash"')).ctx;
  const r = DS.apply(s, ctx, ['check', 'status']);
  const o = r.state.objects.find((x) => x.name === 'ZSD_BILL_BLOCK');
  assert.strictEqual(o.status, 'new');
  assert.strictEqual(DS.badge(r.state, o).text, '⚠ already exists');
  assert.ok(APB.completeness.openQuestions(r.state).some((q) => /ZSD_BILL_BLOCK already exists in SAP/.test(q)));
});

test('the specification carries the reference check and the current state for dewa-abap', () => {
  const s = spec();
  const ctx = DS.parse(ANSWER).ctx;
  const md = APB.markdown.build(DS.apply(s, ctx, ['check', 'status', 'current']).state);
  assert.match(md, /## \d+\. Current State in SAP \(read-only\)/);
  assert.match(md, /Checked in SAP \(system DEMO\)/);
  assert.match(md, /\| Table \| KNVV \| Existing – reuse \| ✓ in system \|/);
  assert.match(md, /### Table KNVV \(existing – reuse, as it is today\)/);
  assert.match(md, /\*\*Uses:\*\* `KNA1`, `TVKO`/);
  assert.match(md, /Current State in SAP was read from the system/);
});
