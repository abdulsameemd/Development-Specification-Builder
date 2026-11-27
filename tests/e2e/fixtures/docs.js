/* Real document fixtures for the end-to-end journeys: Word (.docx), Excel (.xlsx), text PDF and Markdown, built in
   memory with a minimal zip writer (deflated entries), the same way docReader.test.js builds its fixtures. */
'use strict';
const zlib = require('zlib');

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
  return Buffer.concat(parts.concat([cd, end]));
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (style, text) => '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
const tc = (t) => '<w:tc><w:p><w:r><w:t>' + esc(t) + '</w:t></w:r></w:p></w:tc>';

/* Word: blocks = [['h1', text] | ['p', text] | ['table', [[cells], …]]] */
function docx(blocks) {
  const body = blocks.map(([k, v]) => k === 'table'
    ? '<w:tbl>' + v.map((r) => '<w:tr>' + r.map(tc).join('') + '</w:tr>').join('') + '</w:tbl>'
    : para({ h1: 'Heading1', h2: 'Heading2', p: '' }[k], v)).join('');
  return zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body>' + body + '</w:body></w:document>' });
}

/* Excel: one sheet, rows of strings (inline strings) */
function xlsx(sheetName, rows) {
  const col = (i) => String.fromCharCode(65 + i);
  const data = rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.map((v, j) => '<c r="' + col(j) + (i + 1) + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>').join('') + '</row>').join('');
  return zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' + data + '</sheetData></worksheet>'
  });
}

/* Text PDF (Helvetica, one Flate content stream, one line per entry) */
function pdf(lines) {
  const content = 'BT /F1 11 Tf 72 760 Td ' + lines.map((l, i) => (i ? '0 -14 Td ' : '') + '(' + String(l).replace(/[()\\]/g, '\\$&') + ') Tj').join(' ') + ' ET';
  const body = zlib.deflateSync(content);
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj <</Type/Page/Resources 4 0 R/Contents 2 0 R>> endobj\n2 0 obj <</Length ' + body.length + '/Filter/FlateDecode>> stream\n'),
    body,
    Buffer.from('\nendstream endobj\n4 0 obj <</Font <</F1 5 0 R>>>> endobj\n5 0 obj <</Type/Font/Subtype/Type1/BaseFont/Helvetica>> endobj\n%%EOF')
  ]);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
module.exports = { zip, docx, xlsx, pdf, DOCX_MIME, XLSX_MIME };
