'use strict';
// AS-IS process from the existing SAP objects (js/fs-draft.js), run on the builder's own scripts in a VM.
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
  ['config-bundle', 'object-definitions', 'state', 'validation', 'fs-state', 'fs-draft'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  });
  return window.APB;
}
const APB = load();
const plain = (x) => JSON.parse(JSON.stringify(x));

function spec() {
  const s = APB.fs.model.blank();
  s.context.system = 'sap'; s.context.module = 'FI'; s.context.requirement = 'Month-end vendor ageing without Excel';
  s.context.objects = [{ type: 'PROG', name: 'ZFI_AP_OPEN_ITEMS_OLD' }, { type: 'TRAN', name: 'ZFI_AGE' }];
  s.process.asIs = [{ step: 'Run the open items report', role: 'AP accountant', tx: 'ZFI_AGE' }];
  return APB.fs.model.migrate(s);
}

test('the AS-IS prompt is a read-only program read focused on the process', () => {
  const p = APB.fsDraft.asIsPrompt(spec(), ['ZFI_AP_OPEN_ITEMS_OLD (Report / program)', 'ZFI_AGE (Transaction code)']);
  assert.ok(p.startsWith(APB.fsDraft.PROGRAM_MARK)); // the VS Code extension accepts only this marker for program reads
  assert.match(p, /CURRENT BUSINESS PROCESS \(AS-IS\)/);
  assert.match(p, /Existing objects: ZFI_AP_OPEN_ITEMS_OLD \(Report \/ program\), ZFI_AGE \(Transaction code\)/);
  assert.match(p, /1\. Run the open items report/);
  assert.match(p, /READ ONLY/);
  assert.match(p, /"tx": ""/);
});

test('the answer adds the missing steps with transaction and pain point, without duplicates', () => {
  const answer = '```json\n' + JSON.stringify({ kind: 'fs-draft', version: 1, currentLogic: 'Lists open items.',
    asIs: [{ step: 'Run the open items report', role: 'AP accountant', tx: 'ZFI_AGE' },
      { step: 'Download the list to Excel', role: 'AP accountant', tx: 'ZFI_AGE (ALV export)', pain: 'Manual export' }] }) + '\n```';
  const r = APB.fsDraft.parse(answer);
  assert.ok(r.draft, r.error);
  assert.strictEqual(r.draft.asIs[1].tx, 'ZFI_AGE (ALV export)');
  const s = spec();
  const parts = plain(APB.fsDraft.preview(s, r.draft)).map((x) => x.id);
  assert.ok(parts.indexOf('asIs') >= 0);
  const m = APB.fsDraft.merge(s, r.draft, ['asIs', 'currentLogic']);
  assert.deepStrictEqual(plain(m.state.process.asIs).map((x) => x.step + ' | ' + (x.tx || '') + ' | ' + (x.pain || '')),
    ['Run the open items report | ZFI_AGE | ', 'Download the list to Excel | ZFI_AGE (ALV export) | Manual export']);
  assert.strictEqual(m.state.process.currentLogic, 'Lists open items.');
});
