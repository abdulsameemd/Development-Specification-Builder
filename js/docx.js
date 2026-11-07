/* Minimal, dependency-free Word (.docx) writer. It renders the Markdown subset the generators produce
   (headings, paragraphs, bullet/numbered lists, tables, code blocks, **bold**, `code`, _italic_) into
   WordprocessingML and packs it into a ZIP (store method), so export works offline and from file://.
   With meta, the document gets a title page, a table of contents, a header and "Page X of Y" footer. */
(function (APB) {
  'use strict';

  const TBC = '[TO BE CONFIRMED]';
  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134, TEXT_W = PAGE_W - 2 * MARGIN; // A4, 2 cm margins (twips)

  /* --------------------------------------------------------------- Markdown */
  function cells(line) {
    return line.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(function (c) { return c.trim(); });
  }

  function parse(md) {
    const lines = md.split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        blocks.push({ t: 'code', lines: buf });
      } else if (/^#{1,6}\s/.test(l)) {
        blocks.push({ t: 'h', level: /^#+/.exec(l)[0].length, text: l.replace(/^#+\s+/, '') });
        i++;
      } else if (/^\|/.test(l) && /^\|\s*:?-{2,}/.test(lines[i + 1] || '')) {
        const head = cells(l);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
        blocks.push({ t: 'table', head: head, rows: rows });
      } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
        const ordered = /^\d+\./.test(l);
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
          const m = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (m[1].length >= 2 && items.length) items[items.length - 1].sub.push(m[2]); else items.push({ text: m[2], sub: [] });
          i++;
        }
        blocks.push({ t: 'list', ordered: ordered, items: items });
      } else if (/^\s*$/.test(l)) {
        i++;
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
        if (!buf.length) buf.push(lines[i++]);
        blocks.push({ t: 'p', lines: buf });
      }
    }
    return blocks;
  }

  /* **bold**, `code`, _italic_ and [TO BE CONFIRMED] → runs */
  function runsOf(text) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`|(^|\s)_([^_]+)_(?=\s|$)|\[TO BE CONFIRMED\]/g;
    let last = 0, m;
    text = String(text).replace(/\\\|/g, '|');
    while ((m = re.exec(text))) {
      const lead = m[3] || '';
      if (m.index + lead.length > last) out.push({ t: text.slice(last, m.index + lead.length) });
      if (m[1] !== undefined) out.push({ t: m[1], b: true });
      else if (m[2] !== undefined) out.push({ t: m[2], code: true });
      else if (m[4] !== undefined) out.push({ t: m[4], i: true });
      else out.push({ t: TBC, hl: true, b: true });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out.filter(function (r) { return r.t !== ''; });
  }

  /* ------------------------------------------------------------------- XML */
  function x(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }

  function run(r, extra) {
    const pr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') +
      (r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:shd w:val="clear" w:color="auto" w:fill="F2F5EF"/>' : '') +
      (r.hl ? '<w:highlight w:val="yellow"/>' : '') + (extra || '');
    return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + x(r.t) + '</w:t></w:r>';
  }

  function para(content, style, ppr) {
    return '<w:p><w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (ppr || '') + '</w:pPr>' + content + '</w:p>';
  }

  function textPara(text, style, ppr, rpr) {
    return para(runsOf(text).map(function (r) { return run(r, rpr); }).join(''), style, ppr);
  }

  let bookmark = 0;
  function heading(text, level, toc) {
    const style = 'Heading' + Math.min(level, 3);
    const id = 'h' + (++bookmark);
    if (toc && level <= 2) toc.push({ text: text, level: level, id: id });
    return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/></w:pPr><w:bookmarkStart w:id="' + bookmark + '" w:name="_' + id + '"/>' +
      runsOf(text).map(function (r) { return run(r); }).join('') + '<w:bookmarkEnd w:id="' + bookmark + '"/></w:p>';
  }

  function table(head, rows, opts) {
    opts = opts || {};
    const n = Math.max(head.length, 1);
    const colW = Math.floor(TEXT_W / n);
    function cell(text, isHead, w) {
      return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="' + (opts.headFill || 'E6F4CF') + '"/>' : '') + '</w:tcPr>' +
        textPara(text, 'TableText', '', isHead ? '<w:b/>' : '') + '</w:tc>';
    }
    const widths = opts.widths || head.map(function () { return colW; });
    return '<w:tbl><w:tblPr><w:tblStyle w:val="SpecTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
      '<w:tblGrid>' + widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' +
      (opts.noHead ? '' : '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' + head.map(function (h, i) { return cell(h, true, widths[i]); }).join('') + '</w:tr>') +
      rows.map(function (r) {
        return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + head.map(function (_, i) { return cell(r[i] == null ? '' : r[i], opts.keyCol && i === 0, widths[i]); }).join('') + '</w:tr>';
      }).join('') + '</w:tbl>' + para('', 'Spacer');
  }

  function render(blocks, meta) {
    const body = [];
    const toc = [];
    const nums = []; // one numbering instance per ordered list so each restarts at 1
    let skipping = !!meta; // the title page replaces the Markdown title and its control table
    blocks.forEach(function (b) {
      if (skipping) { if (b.t === 'h' && b.level === 2) skipping = false; else return; }
      switch (b.t) {
        case 'h':
          if (b.level === 1) body.push(textPara(b.text, 'Title'));
          else body.push(heading(b.text, b.level - 1, toc));
          break;
        case 'p':
          body.push(para(b.lines.map(function (l, i) { return (i ? '<w:r><w:br/></w:r>' : '') + runsOf(l).map(function (r) { return run(r); }).join(''); }).join('')));
          break;
        case 'code':
          b.lines.forEach(function (l) { body.push(para(run({ t: l || ' ' }), 'Code')); });
          body.push(para('', 'Spacer'));
          break;
        case 'table':
          body.push(table(b.head, b.rows));
          break;
        case 'list': {
          let numId = 1;
          if (b.ordered) { nums.push(nums.length + 3); numId = nums[nums.length - 1]; }
          b.items.forEach(function (it) {
            const cb = /^\[( |x)\]\s/.exec(it.text);
            body.push(textPara(cb ? '☐ ' + it.text.slice(4) : it.text, 'ListParagraph', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + numId + '"/></w:numPr>'));
            it.sub.forEach(function (sub) { body.push(textPara(sub, 'ListParagraph', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>')); });
          });
          break;
        }
      }
    });
    return { body: body.join(''), toc: toc, nums: nums };
  }

  function titlePage(meta, toc) {
    const rows = [['Document ID', meta.docId || TBC], ['Version', meta.version || TBC], ['Status', meta.status || TBC], [meta.moduleLabel || 'Module', meta.module || TBC], ['Author', meta.author || TBC], ['Date', meta.date || '']];
    const tocBody = toc.map(function (t) {
      return '<w:p><w:pPr><w:pStyle w:val="TOC' + t.level + '"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + TEXT_W + '"/></w:tabs></w:pPr>' +
        '<w:hyperlink w:anchor="_' + t.id + '" w:history="1">' + run({ t: t.text }) + '</w:hyperlink></w:p>';
    });
    const tocField = tocBody.length
      ? '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
        tocBody.join('') + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
      : '';
    return para('', 'Spacer', '<w:spacing w:before="2400"/>') +
      textPara(meta.kind || 'Specification', 'Subtitle') +
      textPara(meta.title || 'Specification', 'Title') +
      para('', 'Spacer') +
      table(['Field', 'Value'], rows, { noHead: true, keyCol: true, widths: [2600, TEXT_W - 2600] }) +
      para('<w:r><w:br w:type="page"/></w:r>') +
      (tocField ? textPara('Contents', 'TOCHeading') + tocField + para('<w:r><w:br w:type="page"/></w:r>') : '');
  }

  function documentXml(md, meta) {
    bookmark = 0;
    const r = render(parse(md), meta);
    const sect = '<w:sectPr>' + (meta ? '<w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>' : '') +
      '<w:pgSz w:w="' + PAGE_W + '" w:h="' + PAGE_H + '"/><w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN + '" w:header="567" w:footer="567" w:gutter="0"/>' +
      (meta ? '<w:titlePg/>' : '') + '</w:sectPr>';
    return { xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
      (meta ? titlePage(meta, r.toc) : '') + r.body + sect + '</w:body></w:document>', nums: r.nums };
  }

  function stylesXml() {
    function pStyle(id, name, ppr, rpr, extra) {
      return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/>' + (extra || '') + '<w:qFormat/>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '</w:style>';
    }
    const green = '3F6A00';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      pStyle('Title', 'Title', '<w:spacing w:after="240"/>', '<w:b/><w:color w:val="141A1D"/><w:sz w:val="52"/>') +
      pStyle('Subtitle', 'Subtitle', '<w:spacing w:after="120"/>', '<w:caps/><w:color w:val="' + green + '"/><w:spacing w:val="20"/><w:sz w:val="24"/><w:b/>') +
      pStyle('Heading1', 'heading 1', '<w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="84BD00"/></w:pBdr><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="141A1D"/><w:sz w:val="30"/>') +
      pStyle('Heading2', 'heading 2', '<w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/>', '<w:b/><w:color w:val="' + green + '"/><w:sz w:val="25"/>') +
      pStyle('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="22"/>') +
      pStyle('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/>') +
      pStyle('Code', 'Code', '<w:shd w:val="clear" w:color="auto" w:fill="F2F5EF"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="170" w:right="170"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/>') +
      pStyle('TableText', 'Table Text', '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="18"/>') +
      pStyle('Spacer', 'Spacer', '<w:spacing w:after="80"/>', '<w:sz w:val="8"/>') +
      pStyle('TOCHeading', 'TOC Heading', '<w:spacing w:after="200"/>', '<w:b/><w:color w:val="141A1D"/><w:sz w:val="30"/>') +
      pStyle('TOC1', 'toc 1', '<w:spacing w:before="60" w:after="40"/>', '<w:b/>') +
      pStyle('TOC2', 'toc 2', '<w:spacing w:after="20"/><w:ind w:left="360"/>') +
      pStyle('Header', 'header', '<w:jc w:val="right"/><w:spacing w:after="0"/>', '<w:color w:val="56636A"/><w:sz w:val="16"/>') +
      pStyle('Footer', 'footer', '<w:jc w:val="center"/><w:spacing w:after="0"/>', '<w:color w:val="56636A"/><w:sz w:val="16"/>') +
      '<w:style w:type="table" w:styleId="SpecTable"><w:name w:val="Spec Table"/><w:tblPr><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (b) { return '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="C9D3D7"/>'; }).join('') +
      '</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="141A1D"/></w:rPr></w:style>' +
      '</w:styles>';
  }

  function numberingXml(nums) {
    function lvl(i, fmt, text, ind) {
      return '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + ind + '" w:hanging="360"/></w:pPr>' +
        (fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : '') + '</w:lvl>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lvl(0, 'bullet', '', 720) + lvl(1, 'bullet', 'o', 1440).replace('Symbol', 'Courier New').replace('Symbol', 'Courier New') + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lvl(0, 'decimal', '%1.', 720) + lvl(1, 'lowerLetter', '%2.', 1440) + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      nums.map(function (id) { return '<w:num w:numId="' + id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'; }).join('') +
      '</w:numbering>';
  }

  function headerXml(meta) {
    const t = [meta.docId, meta.version && 'Version ' + meta.version, meta.title].filter(Boolean).join('  ·  ');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + para(run({ t: t }), 'Header') + '</w:hdr>';
  }

  function footerXml(meta) {
    function field(code) {
      return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + code + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      para(run({ t: (meta.kind || 'Specification') + '  ·  Page ' }) + field('PAGE') + run({ t: ' of ' }) + field('NUMPAGES'), 'Footer') + '</w:ftr>';
  }

  function package_(md, meta) {
    const doc = documentXml(md, meta);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        (meta ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'],
      ['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + x((meta && meta.title) || 'Specification') + '</dc:title><dc:subject>' + x((meta && meta.kind) || '') + '</dc:subject><dc:creator>' + x((meta && meta.author) || '') + '</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>'],
      ['docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SAP Specification Builder</Application></Properties>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
        (meta ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '') +
        '</Relationships>'],
      ['word/document.xml', doc.xml],
      ['word/styles.xml', stylesXml()],
      ['word/numbering.xml', numberingXml(doc.nums)],
      // updateFields: Word refreshes the table of contents (page numbers) when the file is opened
      ['word/settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + (meta ? '<w:updateFields w:val="true"/>' : '') + '<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>']
    ];
    if (meta) files.push(['word/header1.xml', headerXml(meta)], ['word/footer1.xml', footerXml(meta)]);
    return zip(files);
  }

  /* ------------------------------------------------------------------- ZIP */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* files: [[name, string | Uint8Array]] → Uint8Array (no compression; Word reads stored entries fine). */
  function zip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    files.forEach(function (f) {
      const name = enc.encode(f[0]);
      const data = typeof f[1] === 'string' ? enc.encode(f[1]) : f[1];
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true); cen.setUint16(34, 0, true); cen.setUint16(36, 0, true);
      cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cenSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce(function (n, p) { return n + p.length; }, 0));
    let pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  APB.docx = { fromMarkdown: package_, parse: parse, runsOf: runsOf, zip: zip, crc32: crc32 };
})(window.APB = window.APB || {});
