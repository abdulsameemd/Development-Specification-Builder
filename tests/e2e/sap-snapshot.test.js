/* SAP no-impact guard: every SAP output of the builder – Technical spec examples and templates (Markdown), the
   Functional spec examples (Markdown, Copilot prompts), the FS → TS hand-off of each RICEFW item (state, Markdown,
   prompts) and the SAP type lists – must stay byte-identical to tests/e2e/sap-snapshot.json, recorded before the
   non-SAP (generic) platform was added. Clock and random numbers are fixed so the output is deterministic.
   Update the snapshot only on purpose:  SNAPSHOT_UPDATE=1 node --test tests/e2e/sap-snapshot.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
const FILE = path.join(__dirname, 'sap-snapshot.json');

async function compute() {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.addInitScript(() => {
      const FIXED = Date.UTC(2026, 0, 15, 9, 0, 0);
      const D = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends D { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
      let seed = 42;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    });
    await p.goto(APP);
    await p.waitForFunction(() => window.APB && APB.fsApp && APB.markdown);
    return await p.evaluate(() => {
      // ids, timestamps and audit entries are bookkeeping, not output
      const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['id', 'meta', 'audit', 'at', 'created', 'updated'].indexOf(k) >= 0 ? undefined : x)));
      const out = { ts: {}, tsTemplates: {}, fs: {}, handoff: {}, lists: {} };
      out.lists.devTypes = APB.defs.typeKeys().map((k) => k + ' ' + APB.defs.types[k].label + ' → ' + APB.defs.types[k].mainObject.join(','));
      out.lists.objectTypes = APB.defs.objectTypes.slice();
      out.lists.fsRicefw = APB.config.fsDefinitions.ricefw.map((r) => r.value + ' ' + r.code + ' ' + (r.devType || ''));
      APB.templates.examples().forEach((e) => {
        const s = APB.templates.example(e.id);
        out.ts[e.id] = { md: APB.markdown.build(s), chat: APB.markdown.chatPrompt(s), devSap: APB.devSap.prompt(s), tsDraft: APB.tsDraft.prompt(s) };
      });
      APB.templates.list().forEach((t) => { out.tsTemplates[t.id] = APB.markdown.build(APB.templates.fromTemplate(t.id)); });
      APB.fs.templates.examples().forEach((e) => {
        const s = APB.fs.model.migrate(APB.fs.templates.example(e.id));
        out.fs[e.id] = { md: APB.fsMarkdown.build(s), draft: APB.fsDraft.prompt(s) };
        APB.state.replace(s);
        (s.solution.ricefw || []).forEach((r, i) => {
          if (!r || !r.type) return;
          const dev = APB.fsApp.toDevSpec(s, i);
          out.handoff[e.id + '#' + i] = { state: strip(dev), md: APB.markdown.build(dev), tsDraft: APB.tsDraft.prompt(dev), devSap: APB.devSap.prompt(dev) };
        });
      });
      return out;
    });
  } finally {
    await browser.close();
  }
}

test('SAP outputs are unchanged (byte-identical to the recorded snapshot)', async () => {
  const now = await compute();
  if (process.env.SNAPSHOT_UPDATE || !fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
    return;
  }
  const was = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const group of Object.keys(was)) {
    for (const key of Object.keys(was[group])) {
      assert.deepStrictEqual(now[group][key], was[group][key], 'SAP output changed: ' + group + ' / ' + key);
    }
  }
  assert.ok(Object.keys(was.handoff).length > 0 && Object.keys(was.ts).length > 0, 'snapshot covers examples and hand-offs');
});
