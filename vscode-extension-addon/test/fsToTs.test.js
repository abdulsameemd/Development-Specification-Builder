'use strict';
// FS → TS: fixed mapping (js/fs-to-ts.js), "Complete the TS with Copilot" (js/ts-draft.js) and the grounding checks.
// Run: node --test vscode-extension-addon/test/*.test.js
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
const plain = (x) => JSON.parse(JSON.stringify(x));

function alvFs() {
  const s = APB.fs.model.blank();
  s.context.system = 'sap'; s.context.module = 'SD'; s.context.title = 'Open sales orders report';
  s.context.requirement = 'Simple ALV list of open sales orders per sales organization.';
  s.reqs.frs = [{ title: 'Show open orders', priority: 'must', description: 'List open orders', acceptance: 'When I run it, then open orders are listed' }];
  s.reqs.data = [
    { field: 'Sales organization', table: 'VBAK', sapField: 'VKORG', mandatory: true, validation: '', usage: 'selection' },
    { field: 'Key date', table: 'VBAK', sapField: 'ERDAT', validation: 'single date', usage: 'selection' },
    { field: 'Sales order', table: 'VBAK', sapField: 'VBELN', usage: 'output' },
    { field: 'Customer', table: 'VBAK', sapField: 'KUNNR', usage: 'both' },
    { field: 'Net value', table: 'VBAK', sapField: 'NETWR', validation: 'currency VBAK-WAERK', usage: 'output' }];
  s.solution.ricefw = [{ type: 'report', name: '', description: 'Open sales orders ALV report', frs: 'FR-01' }];
  return APB.fs.model.migrate(s);
}
// toDevSpec lives in fs-app.js (UI module); the parts it uses are tested here directly
function designer(fsState, type) { return plain(APB.fsToTs.designer(fsState, type, fsState.solution.ricefw[0])); }

test('FS data "Used for" → Report selection screen, ALV columns, output type; names, CDS, RFC, Fiori, Table', () => {
  const f = alvFs();
  const d = designer(f, 'Report');
  assert.strictEqual(d.programType, 'Executable program (type 1)');
  assert.deepStrictEqual(d.selection.map((r) => [r.name, r.kind, r.type, r.label, r.obligatory]),
    [['S_VKORG', 'SELECT-OPTIONS', 'VBAK-VKORG', 'Sales organization', true], ['P_ERDAT', 'PARAMETERS', 'VBAK-ERDAT', 'Key date', false], ['S_KUNNR', 'SELECT-OPTIONS', 'VBAK-KUNNR', 'Customer', false]]);
  assert.deepStrictEqual(d.columns.map((c) => [c.field, c.header, c.source]), [['VBELN', 'Sales order', 'VBAK-VBELN'], ['KUNNR', 'Customer', 'VBAK-KUNNR'], ['NETWR', 'Net value', 'VBAK-NETWR']]);
  assert.deepStrictEqual(d.outputType, ['ALV (CL_SALV_TABLE)']);
  assert.ok(d.selection.every((r) => r.name.length <= 8), 'ABAP selection names ≤ 8');
  assert.deepStrictEqual(designer(f, 'Fiori/UI5').filters.map((x) => x.field), ['VKORG', 'ERDAT', 'KUNNR']);
  assert.deepStrictEqual(designer(f, 'CDS').elements.map((x) => x.expression), ['vbak.vbeln', 'vbak.kunnr', 'vbak.netwr', 'vbak.vkorg', 'vbak.erdat']);
  const rfc = designer(f, 'RFC');
  assert.deepStrictEqual([rfc.importing.map((x) => x.name), rfc.exporting.map((x) => x.name)], [['IV_VKORG', 'IV_ERDAT', 'IV_KUNNR'], ['EV_VBELN', 'EV_KUNNR', 'EV_NETWR']]);
  assert.deepStrictEqual(designer(f, 'Table'), {}, 'nothing stored → nothing invented');
  assert.deepStrictEqual(designer(f, 'Class'), {}, 'no mapping for other types');
  // without "Used for" nothing is guessed (left to Copilot)
  const old = alvFs(); old.reqs.data.forEach((r) => { r.usage = ''; });
  assert.strictEqual(designer(old, 'Report').selection, undefined);
  // e-mail and file outputs
  const mail = alvFs(); mail.solution.outputs = [{ name: 'Daily mail', type: 'email' }];
  assert.deepStrictEqual(designer(mail, 'Report').outputType, ['ALV (CL_SALV_TABLE)', 'E-mail']);
  assert.strictEqual(APB.fsToTs.proposeName(f, f.solution.ricefw[0], 'Report'), 'ZSD_OPEN_SALES_ORDERS_ALV');
  assert.ok(APB.fsToTs.proposeName(f, f.solution.ricefw[0], 'Fiori/UI5').length <= 15);
  const txt = APB.fsToTs.fsText(f, ['FR-01']);
  assert.match(txt, /Sales organization \| VBAK-VKORG \| selection \| mandatory/);
  assert.match(txt, /FR-01 Show open orders: List open orders \| acceptance: When I run it/);
  assert.ok(APB.fsToTs.fsNames(f).includes('VBAK-NETWR'));
});

test('FS draft: the "usage" column is in the prompt and normalised to the allowed values', () => {
  const p = APB.fsDraft.prompt(alvFs());
  assert.match(p, /data usage selection\|output\|both\|input\|stored\|display/);
  assert.match(p, /"usage": "output"/);
  const r = APB.fsDraft.parse('```json\n' + JSON.stringify({ kind: 'fs-draft', version: 1, data: [{ field: 'Plant', usage: 'selection' }, { field: 'X', usage: 'nonsense' }] }) + '\n```');
  assert.deepStrictEqual(plain(r.draft.data).map((d) => d.usage), ['selection', '']);
});

function ts() {
  const s = APB.state.migrate({
    requirement: { text: 'Open sales orders per sales org', objective: '', users: '', expectedOutput: '' }, types: ['REPORT'],
    objects: [{ type: 'Report', name: 'ZSD_OPEN_ORDERS', status: 'new', detail: designer(alvFs(), 'Report') }, { type: 'Table', name: 'VBAK', status: 'existing' }],
    quality: { authorization: 'no' },
    origin: { fsText: APB.fsToTs.fsText(alvFs()), names: APB.fsToTs.fsNames(alvFs()) }
  });
  return s;
}

test('Complete the TS: prompt has the sources, the schema with option values, empty-only and no-invention rules', () => {
  const p = APB.tsDraft.prompt(ts());
  assert.ok(p.startsWith('TS-DRAFT v1\n'));
  assert.match(p, /Fill ONLY the parts that are still EMPTY/);
  assert.match(p, /Never invent table or field names/);
  assert.match(p, /Authorization: do not change it \(it stays "no"\)/);
  assert.match(p, /- outputType \(Output\): list of ALV \(CL_SALV_TABLE\) \| ALV Grid/);
  assert.match(p, /- selection \(Selection screen\): array of \{ name, kind \(SELECT-OPTIONS \| PARAMETERS/);
  assert.match(p, /FS EXTRACT/);
  assert.match(p, /Sales organization \| VBAK-VKORG/);
  assert.match(p, /"kind": "dewa-ts-draft"/);
});

test('Complete the TS: only schema ids, invented SAP names become [TO BE CONFIRMED], filled values are never overwritten, authorization untouched', () => {
  const s = ts();
  const answer = { kind: 'dewa-ts-draft', version: 1,
    objects: [{ name: 'ZSD_OPEN_ORDERS', type: 'Report', detail: {
      logic: '1. Select open orders from VBAK where VBAK-VKORG in S_VKORG\n2. Read item status VBUP-GBSTA\n3. Call ZSD_GET_OPEN_ITEMS\n4. Display with CL_SALV_TABLE',
      columns: [{ field: 'ABC', header: 'invented' }], // already filled → not offered
      background: 'yes', inventedField: 'x', outputType: ['ALV (CL_SALV_TABLE)', 'Fax'] } },
    { name: 'VBAK', type: 'Table', detail: { description: 'not a new object' } }],
    quality: { dataVolume: 'large', testScenarios: ['Sales org 1000 => open orders listed'], authorization: 'yes', cleanCore: 'maybe' },
    expectedOutput: 'ALV list of open orders', openQuestions: ['Which order types count as open?'] };
  const r = APB.tsDraft.parse('Done.\n```json\n' + JSON.stringify(answer) + '\n```', s);
  const d = plain(r.draft);
  assert.strictEqual(d.objects.length, 1, 'only new / changed objects');
  assert.deepStrictEqual(Object.keys(d.objects[0].detail).sort(), ['background', 'columns', 'logic', 'outputType'].sort(), 'unknown ids dropped');
  assert.deepStrictEqual(d.objects[0].detail.outputType, ['ALV (CL_SALV_TABLE)'], 'unknown option dropped');
  assert.match(d.objects[0].detail.logic, /VBAK-VKORG in S_VKORG/, 'known field kept');
  assert.match(d.objects[0].detail.logic, /\[TO BE CONFIRMED\] VBUP-GBSTA/);
  assert.match(d.objects[0].detail.logic, /\[TO BE CONFIRMED\] ZSD_GET_OPEN_ITEMS/);
  assert.match(d.objects[0].detail.logic, /Display with CL_SALV_TABLE/, 'SAP standard class names are fine');
  assert.strictEqual(d.unconfirmed, 2);
  assert.ok(!('authorization' in d.quality), 'authorization is never part of the completion');
  assert.ok(!('cleanCore' in d.quality), 'invalid option dropped');
  const parts = plain(APB.tsDraft.preview(s, r.draft));
  const ids = parts.map((p) => p.id);
  assert.ok(!ids.some((i) => /:columns$/.test(i)), 'filled field not offered');
  assert.ok(ids.some((i) => /:logic$/.test(i)) && ids.includes('q:dataVolume') && ids.includes('output') && ids.includes('questions') && ids.includes('grounding'));
  assert.match(parts.find((p) => /:logic$/.test(p.id)).label, /contains \[TO BE CONFIRMED\]/);
  const out = APB.tsDraft.apply(s, r.draft, ids.filter((i) => i !== 'q:dataVolume'));
  const main = out.state.objects[0];
  assert.deepStrictEqual(plain(main.detail.columns), plain(s.objects[0].detail.columns), 'columns unchanged');
  assert.match(main.detail.logic, /^1\. Select open orders/);
  assert.strictEqual(out.state.quality.dataVolume, '', 'unticked → not applied');
  assert.strictEqual(out.state.quality.authorization, 'no');
  assert.strictEqual(out.state.requirement.expectedOutput, 'ALV list of open orders');
  assert.match(out.state.assumptions, /Open questions \(Copilot\):\n- \[TO BE CONFIRMED\] Which order types count as open\?/);
  assert.ok(out.state.origin.copilot.includes('ZSD_OPEN_ORDERS.logic'));
  const kept = APB.state.migrate(JSON.parse(JSON.stringify(out.state)));
  assert.ok(kept.origin.copilot.includes('ZSD_OPEN_ORDERS.logic'), 'kept by migrate');
  const md = APB.markdown.build(kept);
  assert.match(md, /## \d+\. Design Sources/);
  assert.match(md, /Functional specification \| [^\n]*authorization No \(no roles or authorization objects in the FS\)/);
  assert.match(md, /Copilot proposal \(reviewed by the developer\) \| ZSD_OPEN_ORDERS\.logic/);
  assert.match(md, /Values marked \[TO BE CONFIRMED\] are NOT confirmed/);
  assert.match(APB.tsDraft.parse('no json', s).error, /No TS completion found/);
});

test('Check & read in SAP verifies the TABLE-FIELD names of the design and marks missing ones [TO BE CONFIRMED]', () => {
  const s = ts();
  assert.deepStrictEqual(plain(APB.devSap.fieldRefs(s)), ['VBAK-VKORG', 'VBAK-ERDAT', 'VBAK-KUNNR', 'VBAK-VBELN', 'VBAK-NETWR', 'VBAK-WAERK']);
  assert.match(APB.devSap.prompt(s), /Fields used in the design \(TABLE-FIELD\)[^\n]*VBAK-VKORG/);
  const ans = { kind: 'dewa-dev-context', version: 1, checked: [{ name: 'ZSD_OPEN_ORDERS', result: 'missing' }, { name: 'VBAK', result: 'verified', type: 'Table' }], objects: [], notFound: ['VBAK-ERDAT'] };
  const r = APB.devSap.parse('```json\n' + JSON.stringify(ans) + '\n```');
  assert.deepStrictEqual(plain(r.ctx.notFound), ['VBAK-ERDAT']);
  const parts = plain(APB.devSap.preview(s, r.ctx));
  assert.ok(parts.some((p) => p.id === 'tbcfields' && p.items[0] === 'VBAK-ERDAT'));
  const out = APB.devSap.apply(s, r.ctx, ['check', 'tbcfields']);
  const sel = out.state.objects[0].detail.selection;
  assert.strictEqual(sel[1].type, '[TO BE CONFIRMED] VBAK-ERDAT');
  assert.strictEqual(sel[0].type, 'VBAK-VKORG', 'verified ones unchanged');
  assert.ok(out.applied.includes('1 field marked [TO BE CONFIRMED]'));
  assert.ok(!APB.devSap.fieldRefs(out.state).includes('VBAK-ERDAT'), 'not asked again once marked');
});
