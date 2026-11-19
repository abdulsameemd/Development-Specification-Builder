'use strict';
// Hand-off of a Technical spec: new objects → dewa-abap, existing objects to change → dewa-abap-change.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const window = {};
const ctx = vm.createContext({ window, console, Date, JSON, Math });
['config-bundle', 'host', 'governance', 'flow-diagram', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator']
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
const APB = window.APB;
const plain = (x) => JSON.parse(JSON.stringify(x));
const spec = (objects) => APB.state.migrate({ requirement: { text: 'Bonus duplicate check' }, types: ['REPORT'], objects });

const NEW = { type: 'Table', name: 'ZHR_BONUS_AI_LOG', status: 'new' };
const CHANGE = { type: 'Report', name: 'ZHR_BONUS_UPDATE', status: 'change', purpose: 'Add duplicate check before posting' };
const EXISTING = { type: 'Table', name: 'PA0015', status: 'existing' };

test('routing from the object statuses: new only, change only, both', () => {
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([NEW, EXISTING])).agents), ['dewa-abap']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([CHANGE, EXISTING])).agents), ['dewa-abap-change']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([NEW, CHANGE, EXISTING])).agents), ['dewa-abap', 'dewa-abap-change']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([EXISTING])).agents), ['dewa-abap'], 'nothing to change → as before');
});

test('prompts: change mode starts with the marker and limits the scope; new mode leaves changed objects alone', () => {
  const s = spec([NEW, CHANGE, EXISTING]);
  const ch = APB.markdown.chatPrompt(s, 'change');
  assert.match(ch, /^DEWA-ABAP-CHANGE v1\nChange the existing SAP objects .* only those listed under "Existing Objects to Change"/);
  assert.match(ch, /wait for CONFIRM CHANGE before every write/);
  assert.match(ch, /## \d+\. Existing Objects to Change/);
  const nw = APB.markdown.chatPrompt(s, 'new');
  assert.match(nw, /^Implement the SAP development specification below\..* Build only the NEW objects; .*dewa-abap-change – do not modify them\./);
  assert.doesNotMatch(APB.markdown.chatPrompt(spec([NEW])), /dewa-abap-change/, 'unchanged prompt without changed objects');
});

test('Copilot Development Instructions name the change agent and the order', () => {
  const md = APB.markdown.build(spec([NEW, CHANGE]));
  assert.match(md, /Objects under "Existing Objects to Change" are changed with the dewa-abap-change agent, one at a time: .*CONFIRM CHANGE.* never modify SAP standard\. Build the new objects first \(dewa-abap\)\./);
  assert.doesNotMatch(APB.markdown.build(spec([NEW])), /dewa-abap-change/);
});
