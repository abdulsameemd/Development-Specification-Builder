'use strict';
// Reading uploaded BRD / solution documents (js/doc-reader.js): Word, Excel, text PDF, Markdown.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const window = {};
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'doc-reader.js'), 'utf8'),
  vm.createContext({ window, Response, Blob, DecompressionStream, TextDecoder, Uint8Array, DataView, console }), { filename: 'doc-reader.js' });
const DR = window.APB.docReader;

/* Minimal zip writer (deflated entries) for building .docx / .xlsx fixtures. */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(data), nb = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, comp); central.push(c, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat(parts.concat([cd, end])));
}
const W = (style, text) => '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
const cell = (t) => '<w:tc><w:p><w:r><w:t>' + t + '</w:t></w:r></w:p></w:tc>';

test('Word: headings, list items and tables (BR / VAL rows) come through as text', async () => {
  const doc = '<w:document><w:body>' + W('Heading1', '2. Business Requirements') + W('Heading2', '2.3 Current State (As-Is)') +
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr/></w:pPr><w:r><w:t>Payroll keys infotype 267 by hand &amp; checks names</w:t></w:r></w:p>' +
    '<w:tbl><w:tr>' + cell('ID') + cell('Requirement') + '</w:tr><w:tr>' + cell('BR-01') + cell('Accept approved memos | PDF') + '</w:tr></w:tbl>' +
    W('', 'Plain paragraph') + '</w:body></w:document>';
  const r = await DR.fromBytes('BRD.docx', zip({ 'word/document.xml': doc }));
  assert.strictEqual(r.kind, 'docx');
  assert.match(r.text, /## 2\. Business Requirements/);
  assert.match(r.text, /### 2\.3 Current State \(As-Is\)/);
  assert.match(r.text, /- Payroll keys infotype 267 by hand & checks names/);
  assert.match(r.text, /\| BR-01 \| Accept approved memos \/ PDF \|/);
  assert.deepStrictEqual(Array.from(r.warnings), []);
});

test('Excel: one table per sheet with shared and inline strings', async () => {
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Process" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Step</t></si><si><t>System</t></si><si><t>Fiori app</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="D2" t="inlineStr"><is><t>note</t></is></c></row></sheetData></worksheet>'
  };
  const r = await DR.fromBytes('Solution.xlsx', zip(files));
  assert.match(r.text, /## Sheet: Process/);
  assert.match(r.text, /\| Step \| System \|  \|  \|/);
  assert.match(r.text, /\| 1 \| Fiori app \|  \| note \|/);
});

test('PDF: text from Flate-encoded content streams, with a ToUnicode map', async () => {
  const cmap = 'begincmap 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <0042> <02> <0052> endbfchar 1 beginbfrange <03> <04> <0030> endbfrange endcmap';
  const content = 'BT /F1 12 Tf 72 700 Td (Off-cycle payroll) Tj 0 -14 Td /F2 12 Tf [<0102> -250 <0304>] TJ ET';
  const objs = [
    '1 0 obj <</Type/Page/Resources 4 0 R/Contents 2 0 R>> endobj',
    '2 0 obj <</Length ' + zlib.deflateSync(content).length + '/Filter/FlateDecode>> stream\n',
    '4 0 obj <</Font <</F1 5 0 R/F2 6 0 R>>>> endobj',
    '5 0 obj <</Type/Font/Subtype/Type1/BaseFont/Helvetica>> endobj',
    '6 0 obj <</Type/Font/Subtype/Type0/ToUnicode 7 0 R>> endobj',
    '7 0 obj <</Length ' + zlib.deflateSync(cmap).length + '/Filter/FlateDecode>> stream\n'
  ];
  const buf = Buffer.concat([Buffer.from('%PDF-1.7\n' + objs[0] + '\n' + objs[1]), zlib.deflateSync(content), Buffer.from('\nendstream endobj\n' + objs[2] + '\n' + objs[3] + '\n' + objs[4] + '\n' + objs[5]),
    zlib.deflateSync(cmap), Buffer.from('\nendstream endobj\n%%EOF')]);
  const r = await DR.fromBytes('BRD.pdf', new Uint8Array(buf));
  assert.match(r.text, /Off-cycle payroll\nBR 01/);
  assert.ok(r.warnings.some((w) => /scanned/.test(w))); // short text → hint about scanned PDFs
});

test('Markdown and text pass through; size is capped; wrong files get a clear message', async () => {
  const r = await DR.fromBytes('notes.md', new TextEncoder().encode('# BRD\n\nBR-01 …'));
  assert.strictEqual(r.text, '# BRD\n\nBR-01 …');
  const big = await DR.fromBytes('big.txt', new TextEncoder().encode('x'.repeat(DR.MAX_CHARS + 10)));
  assert.strictEqual(big.text.length, DR.MAX_CHARS);
  assert.ok(big.truncated && big.warnings.length);
  await assert.rejects(DR.fromBytes('old.doc', new Uint8Array([1, 2])), /Word \(\.docx\)/);
  await assert.rejects(DR.fromBytes('broken.docx', new Uint8Array([1, 2, 3])), /could not be opened/);
});
