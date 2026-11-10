/* Reads uploaded business documents (BRD, solution document) as plain text for Copilot: Word (.docx), Excel (.xlsx),
   PDF with a text layer, Markdown and text. Runs in the browser and in the VS Code webview without libraries:
   zip entries are inflated with DecompressionStream, Office XML is read with regular expressions (so the same code
   runs in the Node tests), and PDF text is taken from the page content streams (best effort; scanned PDFs have none).
   The documents are untrusted input: the text is only shown and sent to Copilot inside a marked block. */
(function (APB) {
  'use strict';
  const MAX_CHARS = 120000;
  const KINDS = { docx: 'Word', xlsx: 'Excel', pdf: 'PDF', md: 'Markdown', markdown: 'Markdown', txt: 'Text' };

  /* ------------------------------------------------------------ helpers */
  async function inflate(bytes, format) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)));
    return new Uint8Array(await out.arrayBuffer());
  }
  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }
  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }
  function entities(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); }).replace(/&amp;/g, '&');
  }
  function cellText(t) { return t.replace(/\|/g, '/').replace(/\s+/g, ' ').trim(); }

  /* ------------------------------------------------------------ zip (central directory) */
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = bytes.length - 22;
    while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = utf8(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      files[name] = { method: method, data: bytes.subarray(start, start + csize) };
    }
    return {
      names: Object.keys(files),
      text: async function (name) {
        const f = files[name];
        if (!f) return '';
        return utf8(f.method === 0 ? f.data : await inflate(f.data, 'deflate-raw'));
      }
    };
  }

  /* ------------------------------------------------------------ Word */
  function wordText(p) {
    let t = '';
    p.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g, function (m, x) { t += x !== undefined ? x : ' '; return m; });
    return entities(t);
  }
  function docxToText(xml) {
    const body = (/<w:body>([\s\S]*)<\/w:body>/.exec(xml) || [, xml])[1];
    const out = [];
    const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
    let m;
    while ((m = re.exec(body))) {
      const block = m[0];
      if (block.indexOf('<w:tbl>') === 0) {
        const rows = (block.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map(function (tr) {
          return (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(function (tc) {
            return cellText((tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(wordText).filter(function (x) { return x.trim(); }).join(' / '));
          });
        }).filter(function (r) { return r.some(Boolean); });
        if (!rows.length) continue;
        const n = Math.max.apply(null, rows.map(function (r) { return r.length; }));
        const line = function (r) { const c = r.slice(); while (c.length < n) c.push(''); return '| ' + c.join(' | ') + ' |'; };
        out.push('', line(rows[0]), '|' + new Array(n + 1).join(' --- |'), rows.slice(1).map(line).join('\n'), '');
        continue;
      }
      const text = wordText(block).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const style = (/<w:pStyle w:val="([^"]+)"/.exec(block) || [])[1] || '';
      const h = /^(?:heading|title)\s*(\d)?/i.exec(style);
      if (h) out.push('', '#'.repeat(Math.min(4, Number(h[1] || 1)) + 1) + ' ' + text, '');
      else if (/<w:numPr>/.test(block) || /list/i.test(style)) out.push('- ' + text);
      else out.push(text);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ------------------------------------------------------------ Excel */
  function colIndex(ref) {
    const letters = /^[A-Z]+/.exec(ref || '');
    if (!letters) return -1;
    let n = 0;
    for (const ch of letters[0]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }
  async function xlsxToText(zip) {
    const shared = ((await zip.text('xl/sharedStrings.xml')).match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
      let t = '';
      si.replace(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g, function (m, x) { t += x; return m; });
      return entities(t);
    });
    const wb = await zip.text('xl/workbook.xml');
    const rels = await zip.text('xl/_rels/workbook.xml.rels');
    const target = {};
    rels.replace(/<Relationship\b[^>]*>/g, function (r) {
      const id = (/\bId="([^"]+)"/.exec(r) || [])[1], t = (/\bTarget="([^"]+)"/.exec(r) || [])[1];
      if (id && t) target[id] = t.replace(/^\/?xl\//, '').replace(/^\//, '');
      return r;
    });
    const sheets = [];
    wb.replace(/<sheet\b[^>]*>/g, function (s) {
      const name = entities((/\bname="([^"]*)"/.exec(s) || [])[1] || 'Sheet');
      const rid = (/\br:id="([^"]+)"/.exec(s) || [])[1];
      sheets.push({ name: name, path: 'xl/' + (target[rid] || '') });
      return s;
    });
    const out = [];
    for (const sh of sheets) {
      const xml = await zip.text(sh.path);
      const rows = [];
      (xml.match(/<row\b[\s\S]*?<\/row>/g) || []).slice(0, 500).forEach(function (row) {
        const cells = [];
        (row.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) || []).forEach(function (c) {
          const ref = (/\br="([A-Z]+)\d+"/.exec(c) || [])[1];
          const type = (/\bt="([^"]+)"/.exec(c) || [])[1];
          const v = (/<v>([^<]*)<\/v>/.exec(c) || [])[1];
          let text = '';
          if (type === 's' && v !== undefined) text = shared[Number(v)] || '';
          else if (type === 'inlineStr') { c.replace(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g, function (m, x) { text += entities(x); return m; }); }
          else if (v !== undefined) text = entities(v);
          const i = colIndex(ref);
          cells[i >= 0 ? i : cells.length] = cellText(text);
        });
        if (cells.some(Boolean)) rows.push(Array.from(cells, function (x) { return x || ''; }));
      });
      if (!rows.length) continue;
      const n = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      const line = function (r) { const c = r.slice(); while (c.length < n) c.push(''); return '| ' + c.join(' | ') + ' |'; };
      out.push('## Sheet: ' + sh.name, '', line(rows[0]), '|' + new Array(n + 1).join(' --- |'), rows.slice(1).map(line).join('\n'), '');
    }
    return out.join('\n').trim();
  }

  /* ------------------------------------------------------------ PDF (text layer, best effort) */
  function pdfStringBytes(raw) {
    // literal string body (without the outer parentheses) → byte codes
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      let ch = raw.charCodeAt(i);
      if (ch === 92) { // backslash
        const n = raw[++i];
        if (n === undefined) break;
        if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(raw[i + 1])) o += raw[++i]; out.push(parseInt(o, 8) & 255); continue; }
        if (n === '\r' || n === '\n') { if (n === '\r' && raw[i + 1] === '\n') i++; continue; }
        ch = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n] || n.charCodeAt(0);
      }
      out.push(ch & 255);
    }
    return out;
  }
  function hexBytes(h) {
    h = h.replace(/[^0-9a-f]/gi, '');
    if (h.length % 2) h += '0';
    const out = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return out;
  }
  function parseCMap(text) {
    const map = {};
    let width = 1;
    const cs = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(text);
    if (cs) width = Math.max(1, Math.ceil(cs[1].length / 2));
    const uni = function (hex) {
      let s = '';
      for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
      return s || String.fromCharCode(parseInt(hex, 16));
    };
    text.replace(/beginbfchar([\s\S]*?)endbfchar/g, function (m, body) {
      body.replace(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi, function (x, a, b) { map[parseInt(a, 16)] = uni(b); return x; });
      return m;
    });
    text.replace(/beginbfrange([\s\S]*?)endbfrange/g, function (m, body) {
      body.replace(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi, function (x, a, b, c, start, list) {
        const lo = parseInt(a, 16), hi = parseInt(b, 16);
        if (start !== undefined) { const base = parseInt(start, 16); for (let k = lo; k <= hi && k - lo < 5000; k++) map[k] = String.fromCharCode(base + k - lo); }
        else { const items = list.match(/<([0-9a-f]+)>/gi) || []; items.forEach(function (it, j) { map[lo + j] = uni(it.slice(1, -1)); }); }
        return x;
      });
      return m;
    });
    return { width: width, map: map };
  }
  async function pdfToText(bytes) {
    const src = latin1(bytes);
    const objs = {};
    const streams = {};
    const objRe = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
    let m;
    while ((m = objRe.exec(src))) {
      const num = m[1], body = m[3];
      const si = body.indexOf('stream');
      if (si < 0) { objs[num] = body; continue; }
      const dict = body.slice(0, si);
      let start = si + 6;
      if (body[start] === '\r') start++;
      if (body[start] === '\n') start++;
      const end = body.lastIndexOf('endstream');
      const raw = body.slice(start, end < 0 ? undefined : end);
      objs[num] = dict;
      streams[num] = { dict: dict, raw: raw };
    }
    async function decode(st) {
      if (st.text !== undefined) return st.text;
      let raw = st.raw;
      const len = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(st.dict);
      if (len && Number(len[1]) <= raw.length) raw = raw.slice(0, Number(len[1]));
      else raw = raw.replace(/\r?\n$/, '');
      if (!/\/FlateDecode/.test(st.dict)) return (st.text = /\/Filter/.test(st.dict) ? '' : raw);
      const data = Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
      for (const cut of [0, 1, 2]) {
        try { return (st.text = latin1(await inflate(cut ? data.subarray(0, data.length - cut) : data, 'deflate'))); } catch (e) { /* try a shorter end */ }
      }
      return (st.text = '');
    }
    // objects inside compressed object streams (PDF 1.5+)
    for (const num of Object.keys(streams)) {
      if (!/\/Type\s*\/ObjStm/.test(streams[num].dict)) continue;
      const text = await decode(streams[num]);
      const first = Number((/\/First\s+(\d+)/.exec(streams[num].dict) || [])[1] || 0);
      const head = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < head.length; i += 2) {
        const from = first + head[i + 1], to = i + 3 < head.length ? first + head[i + 3] : text.length;
        if (!objs[head[i]]) objs[head[i]] = text.slice(from, to);
      }
    }
    // fonts: resource name → ToUnicode map
    const cmaps = {};
    async function cmapOf(fontObj) {
      if (cmaps[fontObj] !== undefined) return cmaps[fontObj];
      cmaps[fontObj] = null;
      const ref = (/\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(objs[fontObj] || '') || [])[1];
      if (ref && streams[ref]) cmaps[fontObj] = parseCMap(await decode(streams[ref]));
      return cmaps[fontObj];
    }
    const fontNames = {};
    for (const num of Object.keys(objs)) {
      const d = objs[num];
      const fm = /\/Font\s*<<([\s\S]*?)>>/.exec(d) || (/\/Font\s+(\d+)\s+\d+\s+R/.exec(d) && [null, objs[/\/Font\s+(\d+)\s+\d+\s+R/.exec(d)[1]] || '']);
      if (!fm) continue;
      String(fm[1]).replace(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g, function (x, name, ref) { if (!fontNames[name]) fontNames[name] = ref; return x; });
    }
    // page content streams, in page order where the page tree gives it
    const contents = [];
    Object.keys(objs).forEach(function (num) {
      if (!/\/Type\s*\/Page\b/.test(objs[num])) return;
      const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(objs[num]);
      if (!c) return;
      (c[1].match(/(\d+)\s+\d+\s+R/g) || []).forEach(function (r) { contents.push(r.split(/\s+/)[0]); });
    });
    const order = contents.length ? contents : Object.keys(streams).filter(function (n) { return !/\/Type\s*\/(ObjStm|XRef|XObject|Metadata)/.test(streams[n].dict); });
    const out = [];
    for (const num of order) {
      if (!streams[num]) continue;
      const text = await decode(streams[num]);
      if (!/\bBT\b/.test(text)) continue;
      let font = null;
      let line = '';
      const flush = function () { if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
      const show = function (codes) {
        if (font && font.map) {
          for (let i = 0; i < codes.length; i += font.width) {
            let code = 0;
            for (let k = 0; k < font.width; k++) code = code * 256 + (codes[i + k] || 0);
            line += font.map[code] !== undefined ? font.map[code] : '';
          }
        } else line += String.fromCharCode.apply(null, codes);
      };
      const tokRe = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|\/[^\s/<>\[\]()]+|-?\d*\.?\d+|[A-Za-z'"*]+/g;
      let t, arr = null;
      const stack = [];
      while ((t = tokRe.exec(text))) {
        const tok = t[0];
        if (tok === '[') { arr = []; continue; }
        if (tok === ']') { stack.push(arr); arr = null; continue; }
        if (tok[0] === '(' || (tok[0] === '<' && tok[1] !== '<')) {
          const codes = tok[0] === '(' ? pdfStringBytes(tok.slice(1, -1)) : hexBytes(tok.slice(1, -1));
          if (arr) arr.push(codes); else stack.push(codes);
          continue;
        }
        if (/^-?\d*\.?\d+$/.test(tok)) { if (arr) arr.push(Number(tok)); else stack.push(Number(tok)); continue; }
        if (tok[0] === '/') { stack.push(tok); continue; }
        switch (tok) {
          case 'Tf': { const name = stack[stack.length - 2]; font = typeof name === 'string' && fontNames[name.slice(1)] ? await cmapOf(fontNames[name.slice(1)]) : null; break; }
          case 'Tj': case "'": case '"': { if (tok !== 'Tj') flush(); const s = stack[stack.length - 1]; if (Array.isArray(s)) show(s); break; }
          case 'TJ': {
            const a = stack[stack.length - 1] || [];
            a.forEach(function (x) { if (typeof x === 'number') { if (x < -180) line += ' '; } else show(x); });
            break;
          }
          case 'Td': case 'TD': { const ty = stack[stack.length - 1]; if (typeof ty === 'number' && Math.abs(ty) > 0.5) flush(); else line += ' '; break; }
          case 'T*': case 'ET': flush(); break;
          case 'Tm': flush(); break;
          default: break;
        }
        stack.length = 0;
      }
      flush();
    }
    return out.join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  }

  /* ------------------------------------------------------------ entry points */
  function kindOf(name) { const e = String(name || '').toLowerCase().split('.').pop(); return KINDS[e] ? e : ''; }

  /* name + bytes → { name, kind, label, text, chars, truncated, warnings[] } */
  async function fromBytes(name, bytes) {
    const ext = kindOf(name);
    const warnings = [];
    let text = '';
    if (!ext) throw new Error('Use a Word (.docx), Excel (.xlsx), PDF, Markdown or text file.');
    if (ext === 'docx' || ext === 'xlsx') {
      let zip;
      try { zip = await unzip(bytes); } catch (e) { throw new Error(name + ' could not be opened (not a valid ' + KINDS[ext] + ' file). Older .doc / .xls files: save them as .docx / .xlsx.'); }
      text = ext === 'docx' ? docxToText(await zip.text('word/document.xml')) : await xlsxToText(zip);
    } else if (ext === 'pdf') {
      if (latin1(bytes.subarray(0, 5)) !== '%PDF-') throw new Error(name + ' is not a PDF file.');
      if (/\/Encrypt\b/.test(latin1(bytes.subarray(Math.max(0, bytes.length - 4096))))) warnings.push('The PDF is protected; its text may not be readable.');
      text = await pdfToText(bytes);
      if (text.replace(/\s/g, '').length < 200) warnings.push('Little or no text found – a scanned or image PDF has no text layer. Save the original as Word (.docx) and upload that.');
    } else {
      text = utf8(bytes);
    }
    text = text.replace(/\r\n?/g, '\n').trim();
    const truncated = text.length > MAX_CHARS;
    if (truncated) { text = text.slice(0, MAX_CHARS); warnings.push('Long document: only the first ' + MAX_CHARS.toLocaleString('en') + ' characters are used.'); }
    if (!text) warnings.push('No text found in ' + name + '.');
    return { name: String(name), kind: ext, label: KINDS[ext], text: text, chars: text.length, truncated: truncated, warnings: warnings };
  }

  function read(file) {
    return file.arrayBuffer().then(function (buf) { return fromBytes(file.name, new Uint8Array(buf)); });
  }

  APB.docReader = { read: read, fromBytes: fromBytes, kindOf: kindOf, MAX_CHARS: MAX_CHARS, ACCEPT: '.docx,.pdf,.xlsx,.md,.markdown,.txt' };
})(window.APB = window.APB || {});
