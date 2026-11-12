'use strict';
// AS-IS / TO-BE swimlane diagrams (js/flow-diagram.js) in the FS, the TS, the preview and Word.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const window = {};
const ctx = vm.createContext({ window, console, Date, JSON, Math, TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer });
['config-bundle', 'host', 'governance', 'flow-diagram', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator', 'fs-state', 'discovery', 'fs-completeness', 'fs-generator', 'docx']
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
const APB = window.APB;
const plain = (x) => JSON.parse(JSON.stringify(x));

const TOBE = [
  { step: 'Run ageing report per company code', role: 'AP accountant', tx: 'ZFI_AGEING', change: 'new' },
  { step: 'Buckets calculated by the system', role: 'System', tx: 'ZCL_FI_AP_AGEING', change: 'automated' },
  { step: 'Review and approve "overdue" list', role: 'AP lead', tx: '', change: 'changed' },
  { step: '', role: 'nobody' }
];

test('swimlanes: one lane per role, one box per step, arrows in order, change colours and pain markers', () => {
  const steps = APB.flow.steps(TOBE, 'toBe');
  assert.strictEqual(steps.length, 3, 'empty rows dropped');
  const svg = APB.flow.svg(steps, 'toBe');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  for (const lane of ['AP accountant', 'System', 'AP lead']) assert.ok(svg.includes('>' + lane + '<'), lane);
  assert.strictEqual((svg.match(/marker-end="url\(#apbArrow\)"/g) || []).length, 2, 'n-1 arrows');
  assert.ok(svg.includes('fill="#e2efff"') && svg.includes('fill="#e3f6e3"') && svg.includes('fill="#fff3d6"'), 'new / automated / changed colours');
  assert.ok(svg.includes('&quot;overdue&quot;'), 'text escaped');
  const asis = APB.flow.svg(APB.flow.steps([{ step: 'Download to Excel', role: 'AP accountant', pain: 'slow' }, { step: 'Calculate buckets', role: 'AP accountant' }], 'asIs'), 'asIs');
  assert.strictEqual((asis.match(/⚠<\/text>/g) || []).length, 1, 'pain marked once');
  // long flows: 8 steps per diagram
  const many = APB.flow.steps(Array.from({ length: 19 }, (_, i) => ({ step: 'Step ' + (i + 1), role: i % 2 ? 'B' : 'A' })), 'asIs');
  assert.strictEqual(APB.flow.diagrams(many, 'asIs').length, 3);
});

test('Markdown: a Mermaid flowchart with subgraphs per role, carrying the steps so preview and Word redraw them', () => {
  const steps = APB.flow.steps(TOBE, 'toBe');
  const md = APB.flow.markdown(steps, 'toBe');
  assert.match(md, /^```mermaid\n%% apb-flow \{/);
  assert.match(md, /flowchart LR\n  subgraph L1\["AP accountant"\]/);
  assert.match(md, /s1 --> s2 --> s3/);
  assert.match(md, /classDef new fill:#e2efff/);
  assert.ok(!/"overdue"/.test(md.split('\n').slice(2).join('\n')), 'quotes removed from Mermaid labels');
  const back = APB.flow.fromBlock(md.split('\n').slice(1, -1));
  assert.deepStrictEqual(plain(back), { kind: 'toBe', steps: plain(steps) });
  assert.strictEqual(APB.flow.fromBlock(['graph TD', 'a-->b']), null, 'other Mermaid blocks are left alone');
  assert.strictEqual(APB.flow.markdown(steps.slice(0, 1), 'toBe'), '', 'one step is no flow');
  const html = APB.markdown.toHtml('## X\n\n' + md + '\n');
  assert.match(html, /<figure class="flow-diagram"><svg /);
});

test('FS document: diagram above the step table for AS-IS and TO-BE; TS created from the FS shows the TO-BE', () => {
  const s = APB.fs.model.blank();
  s.context.system = 'sap'; s.context.requirement = 'Ageing'; s.context.module = 'FI/CO';
  s.process.asIs = [{ step: 'Download', role: 'AP', tx: 'FBL1N', pain: 'slow' }, { step: 'Calculate', role: 'AP' }];
  s.process.toBe = TOBE;
  const md = APB.fsMarkdown.build(s);
  assert.match(md, /### Current process \(AS-IS\)\n\n```mermaid\n%% apb-flow \{"kind":"asIs"[\s\S]*?```\n\n\| # \| Step \| Role/);
  assert.match(md, /### Proposed process \(TO-BE\)\n\n```mermaid\n%% apb-flow \{"kind":"toBe"/);
  const ts = APB.state.migrate({ requirement: { text: 'Build it' }, processToBe: TOBE });
  assert.strictEqual(ts.processToBe.length, 3);
  const tmd = APB.markdown.build(ts);
  assert.match(tmd, /## \d+\. Business Process \(TO-BE\)\n\n```mermaid\n%% apb-flow \{"kind":"toBe"/);
  assert.match(tmd, /\| 2 \| Buckets calculated by the system \| System \| ZCL_FI_AP_AGEING \| Automated \|/);
  assert.ok(!/Business Process \(TO-BE\)/.test(APB.markdown.build(APB.state.migrate({ requirement: { text: 'x' } }))), 'no section without steps');
});

test('Word: each diagram part is an inline picture (PNG part, relationship, content type); without images the steps as text', () => {
  const s = APB.fs.model.blank();
  s.context.system = 'sap'; s.context.requirement = 'Ageing'; s.context.module = 'FI/CO'; s.process.toBe = TOBE;
  const md = APB.fsMarkdown.build(s);
  const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const unzip = (bytes) => Buffer.from(bytes).toString('utf8'); // stored (uncompressed) ZIP: the XML parts are readable
  const withImg = unzip(APB.docx.fromMarkdown(md, null, { images: [{ png: fakePng, w: 900, h: 340 }] }));
  assert.ok(withImg.includes('word/media/flow1.png'));
  assert.ok(withImg.includes('<Default Extension="png" ContentType="image/png"/>'));
  assert.ok(withImg.includes('Target="media/flow1.png"'));
  assert.match(withImg, /<wp:inline [^>]*><wp:extent cx="\d+" cy="\d+"\/>/);
  const cx = Number(/<wp:extent cx="(\d+)"/.exec(withImg)[1]);
  assert.ok(cx <= (11906 - 2 * 1134) * 635, 'scaled to the text width');
  const noImg = unzip(APB.docx.fromMarkdown(md, null));
  assert.ok(!noImg.includes('media/flow'));
  assert.ok(noImg.includes('2. Buckets calculated by the system [System] · ZCL_FI_AP_AGEING · Automated'));
});
