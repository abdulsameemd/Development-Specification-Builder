/* Turns the specification model into Markdown. Output "profiles" decide the
   filename and the closing instruction block; only GitHub Copilot exists today. */
(function (APB) {
  'use strict';
  const D = APB.defs;
  const C = APB.completeness;
  const V = APB.validation;
  const TBC = C.TBC;

  const DDIC = ['Domain', 'Data Element', 'Structure', 'Table Type', 'Table', 'Search Help', 'Lock Object'];
  const ABAP = ['Report', 'Class', 'Interface', 'Function Module', 'RFC', 'BAdI / Enhancement', 'RAP', 'CDS'];

  /* ---------- output profiles ---------- */
  const profiles = {
    copilot: {
      id: 'copilot',
      label: 'GitHub Copilot',
      instructionsTitle: 'Copilot Development Instructions',
      instructions: function (s) {
        const qa = s.quality;
        const built = s.objects.filter(D.hasBuilder);
        const has = function (list) { return built.some(function (o) { return list.indexOf(o.type) >= 0; }); };
        const any = function (list) { return s.objects.some(function (o) { return list.indexOf(o.type) >= 0 && o.status !== 'existing'; }); };
        const hasAc = s.acceptance.some(function (a) { return a.text.trim(); });
        const bapi = built.some(function (o) { return o.detail && o.detail.bapiReturn; });
        return [
          'Read this entire specification.',
          'Inspect the existing project/repository before writing code.',
          'Reuse existing SAP objects (listed here or found in the repository/system). Do not create duplicate functionality.',
          'Do not invent SAP objects, tables, fields, APIs, CDS views, classes, function modules, workflows, authorization objects, or business rules.',
          'Anything unknown is marked ' + TBC + ': inspect the repository/system where possible, otherwise ask for clarification instead of inventing an implementation.',
          built.length && 'Implement names, signatures, typing, keys and exceptions exactly as given in Technical Design; report any deviation.',
          has(DDIC) && 'Create dictionary objects in dependency order (domain → data element → structure / table type → table) and activate them before use.',
          any(ABAP) && 'Use the customer namespace (Z/Y or registered /NAMESPACE/) and the specified naming conventions; follow the Clean ABAP style guide.',
          qa.cleanCore !== 'no' && 'Follow SAP Clean Core principles: prefer released APIs, CDS views, BAPIs and extension points over modifications.',
          any(ABAP) && 'Use modern ABAP syntax (inline declarations, constructor expressions, ABAP SQL with host variables) where the release allows.',
          has(['RAP']) && 'Follow the RAP model: behavior definition and behavior pool as specified; change BO data only through EML.',
          has(['CDS']) && 'Use CDS view entities and provide access control (DCL) where authorization checks are specified.',
          has(['CAPM']) && 'Follow CAP project conventions (db/, srv/, app/); put custom logic in event handlers.',
          bapi && 'Return all messages in RETURN (BAPIRET2); do not send dialog messages (MESSAGE … TYPE E/A) from RFC-enabled modules.',
          qa.authorization !== 'no' && 'Implement authorization checks where required and never bypass SAP security.',
          'Implement proper exception handling and avoid inefficient data access (no SELECT in loops, select only needed fields).',
          'Keep business logic testable and create appropriate tests (ABAP Unit where applicable).',
          'Identify assumptions instead of silently guessing.',
          hasAc ? 'Validate the implementation against the acceptance criteria.' : 'Validate the implementation against the requirement.'
        ].filter(Boolean);
      },
      closing: 'Implement incrementally and explain significant assumptions or deviations.'
    }
  };

  /* ---------- helpers ---------- */
  function clean(v) { return String(v == null ? '' : v).replace(/\s*\n\s*/g, '; ').replace(/\|/g, '\\|').trim(); }
  function cell(v) { return clean(v) || TBC; }
  function purposeCell(v) { return clean(v) || '–'; }

  function table(headers, rows) {
    const out = ['| ' + headers.join(' | ') + ' |', '|' + headers.map(function () { return '---'; }).join('|') + '|'];
    rows.forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
    return out.join('\n');
  }

  function splitLines(v) {
    return String(v || '').split(/\r?\n/).map(function (l) { return l.trim().replace(/^[-*•]\s+/, ''); }).filter(Boolean);
  }

  /* Simple (non-grid) value → { text } | { lines } | null */
  function simpleValue(field, v) {
    switch (field.kind) {
      case 'lines':
      case 'textarea': {
        const lines = splitLines(v);
        if (!lines.length) return null;
        return lines.length === 1 ? { text: lines[0] } : { lines: lines };
      }
      case 'multicheck':
        return Array.isArray(v) && v.length ? { text: v.map(function (x) { return D.optionLabel(field, x); }).join(', ') } : null;
      case 'radio':
      case 'select':
        return v ? { text: v === 'tbc' ? TBC : D.optionLabel(field, v) } : null;
      case 'check':
        return v === true ? { text: 'Yes' } : null;
      default: {
        const t = String(v == null ? '' : v).trim();
        return t ? { text: t } : null;
      }
    }
  }

  function bullet(label, val) {
    const sep = /[?:)]$/.test(label) ? '' : ':';
    if (val.lines) return '- **' + label + '**' + sep + '\n' + val.lines.map(function (l) { return /^\d+[.)]\s/.test(l) ? '  ' + l.replace(/^(\d+)\)/, '$1.') : '  - ' + l; }).join('\n');
    return '- **' + label + '**' + sep + ' ' + val.text;
  }

  function gridMd(field, rows) {
    rows = (rows || []).filter(V.isFilled);
    if (!rows.length) return '';
    const cols = field.columns.filter(function (c) { return rows.some(function (r) { return V.isFilled(r[c.id]); }); });
    return table(cols.map(function (c) { return c.label; }), rows.map(function (r) {
      return cols.map(function (c) {
        const v = r[c.id];
        if (c.kind === 'check') return v ? 'X' : '';
        if (c.kind === 'select') return clean(v ? D.optionLabel(c, v) : '');
        return clean(v);
      });
    }));
  }

  /* Render a list of fields into Markdown blocks (bullets, tables, sub-headings). */
  function renderFields(fields, values, level, suffix) {
    values = values || {};
    const blocks = [];
    let bullets = [];
    function flush() { if (bullets.length) { blocks.push(bullets.join('\n')); bullets = []; } }
    fields.forEach(function (f) {
      if (!D.isVisible(f, values)) return;
      const v = values[f.id];
      const label = f.label + (suffix || '');
      if (f.kind === 'grid') {
        const t = gridMd(f, v);
        if (t) { flush(); blocks.push('**' + label + '**\n\n' + t); }
      } else if (f.kind === 'records') {
        const recs = (Array.isArray(v) ? v : []).filter(V.isFilled);
        if (!recs.length) return;
        flush();
        recs.forEach(function (r, i) {
          const title = (r[f.titleField] || '').trim() || TBC;
          const body = renderFields(f.fields.filter(function (x) { return x.id !== f.titleField; }), r, level + 1);
          blocks.push('#'.repeat(level) + ' ' + f.itemLabel + ' ' + (i + 1) + ': ' + title + (body ? '\n\n' + body : ''));
        });
      } else {
        const val = simpleValue(f, v);
        if (val) bullets.push(bullet(label, val));
      }
    });
    flush();
    return blocks.join('\n\n');
  }

  function commonSection(s, section) {
    return renderFields(D.quality.filter(function (f) { return f.section === section && f.id !== 'testScenarios'; }), s.quality, 4);
  }

  function objectRows(list, withUsed) {
    return list.map(function (o) {
      const r = [cell(o.type), cell(o.name), purposeCell(o.purpose)];
      if (withUsed) r.push(purposeCell(o.detail && o.detail.used));
      return r;
    });
  }

  function objectTable(list, nameLabel) {
    const withUsed = list.some(function (o) { return o.detail && V.isFilled(o.detail.used); });
    return table(['Type', nameLabel, 'Purpose'].concat(withUsed ? ['What is used'] : []), objectRows(list, withUsed));
  }

  /* Technical design: one sub-section per new / changed object with a builder. */
  function technicalDesign(s) {
    return s.objects.filter(D.hasBuilder).map(function (o) {
      const def = D.objectDef(o.type);
      const head = '### ' + o.type + ' ' + (o.name.trim() || TBC) + ' (' + (o.status === 'change' ? 'change' : 'new') + (def.tcode ? ' · ' + def.tcode : '') + ')';
      const intro = [];
      if (o.purpose.trim()) intro.push('_' + o.purpose.trim() + '_');
      if (o.status === 'change') intro.push('Only the changes are described below; keep everything else as is.');
      const body = renderFields(def.fields, o.detail, 4);
      return [head].concat(intro).concat([body || '- ' + TBC + ' Technical details not provided.']).join('\n\n');
    }).join('\n\n');
  }

  /* "When X, Then Y" → structured Given/When/Then. Nothing is invented: missing parts are omitted. */
  function acceptanceBlock(a, i) {
    const text = a.text.trim().replace(/\s+/g, ' ');
    const m = /^(?:given\s+(.*?),\s*)?(?:when\s+(.*?),\s*)(?:then\s+)?(.+)$/i.exec(text);
    const lines = ['**AC-' + (i + 1) + '**'];
    if (m) {
      if (m[1]) lines.push('- **Given** ' + m[1]);
      lines.push('- **When** ' + m[2]);
      lines.push('- **Then** ' + m[3].replace(/\.$/, ''));
    } else {
      lines.push('- **Then** ' + text.replace(/\.$/, '').replace(/^then\s+/i, ''));
    }
    return lines.join('\n');
  }

  function testCases(s) {
    const rows = splitLines(s.quality.testScenarios).map(function (l) {
      const p = l.split(/\s*(?:=>|->)\s*/);
      return { scenario: p[0], expected: p.slice(1).join(' → ') };
    });
    if (!rows.length) return '';
    const withExpected = rows.some(function (r) { return r.expected; });
    return withExpected
      ? table(['ID', 'Scenario', 'Expected result'], rows.map(function (r, i) { return ['TC-' + (i + 1), cell(r.scenario), r.expected ? cell(r.expected) : '–']; }))
      : table(['ID', 'Scenario'], rows.map(function (r, i) { return ['TC-' + (i + 1), cell(r.scenario)]; }));
  }

  /* ---------- document ---------- */
  function build(s, profileId) {
    const profile = profiles[profileId || 'copilot'];
    const sections = [];
    function add(title, body) { if (body && body.trim()) sections.push({ title: title, body: body.trim() }); }

    add('Requirement', s.requirement.text);
    add('Development Object', s.types.map(function (t) { return '- ' + D.types[t].label; }).join('\n'));

    const obj = [];
    if (s.requirement.objective.trim()) obj.push(s.requirement.objective.trim());
    if (s.requirement.users.trim()) obj.push('- **Users / Role**: ' + s.requirement.users.trim());
    add('Business Objective', obj.join('\n\n'));

    const by = function (st) { return s.objects.filter(function (o) { return o.status === st; }); };
    let ex = by('existing').length ? objectTable(by('existing'), 'Name') : '';
    if (by('tbc').length) ex += (ex ? '\n\n' : '') + '**Existence to be confirmed** (check the system before reusing or creating):\n\n' + objectTable(by('tbc'), 'Name');
    add('Existing Objects (reuse)', ex);
    add('Existing Objects to Change', by('change').length ? objectTable(by('change'), 'Name') : '');
    add('New Objects', by('new').length ? objectTable(by('new'), 'Proposed name') : '');

    if (s.objects.length) {
      const tree = C.treeToText(C.buildTree(s), function (o) { return C.objectLabel(o) + ' [' + D.statusLabel(o.status).toLowerCase() + ']'; });
      add('Dependencies', '```text\n' + tree + '\n```');
    }

    add('Technical Design', technicalDesign(s));

    const rules = s.rules.filter(function (r) { return r.condition.trim() || r.behavior.trim(); });
    add('Business Rules', rules.length ? table(['ID', 'Condition', 'Expected behavior'], rules.map(function (r, i) { return ['BR-' + (i + 1), cell(r.condition), cell(r.behavior)]; })) : '');

    add('Output', s.requirement.expectedOutput.trim() ? '- **Expected output**: ' + clean(s.requirement.expectedOutput).replace(/\\\|/g, '|') : '');
    add('Authorization', commonSection(s, 'security'));
    add('Performance', commonSection(s, 'performance'));

    const tests = commonSection(s, 'testing');
    const cases = testCases(s);
    add('Testing', [tests, cases].filter(Boolean).join('\n\n'));

    const acc = s.acceptance.filter(function (a) { return a.text.trim(); });
    add('Acceptance Criteria', acc.map(acceptanceBlock).join('\n\n'));

    let cc = commonSection(s, 'cleancore');
    if (cc && s.quality.cleanCore !== 'no') cc += '\n- Prefer released SAP APIs, CDS views and extension points.';
    add('Clean Core', cc);

    add('Assumptions', splitLines(s.assumptions).map(function (a) { return '- ' + a; }).join('\n'));
    add('Open Questions', C.openQuestions(s).map(function (x, i) { return (i + 1) + '. ' + TBC + ' ' + x; }).join('\n'));

    const dod = s.dod.filter(function (d) { return d.on && d.text.trim(); });
    add('Definition of Done', dod.map(function (d) { return '- [ ] ' + d.text.trim(); }).join('\n'));

    add(profile.instructionsTitle, 'Before implementing:\n\n' + profile.instructions(s).map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') + '\n\n' + profile.closing);

    const lines = ['# SAP Development Specification', ''];
    if (s.project.name.trim()) lines.push('**Project:** ' + s.project.name.trim(), '');
    sections.forEach(function (sec, i) { lines.push('## ' + (i + 1) + '. ' + sec.title, '', sec.body, ''); });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  function slug(v) { return String(v || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

  /* The downloaded specification always has the same, predictable name. */
  function filename() { return 'BUSINESS_REQUIREMENTS.md'; } // the name dewa-abap reads as its requirement source

  /* What gets pasted into Copilot Chat: a one-line instruction followed by the full specification. */
  function chatPrompt(s) {
    return 'Implement the SAP development specification below. Follow its "Copilot Development Instructions" section, ' +
      'reuse the listed existing objects, and ask me before guessing anything marked ' + TBC + '.\n\n' + build(s);
  }

  /* ---------- lightweight Markdown → HTML for the preview ---------- */
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>')
      .replace(/\\\|/g, '|')
      .replace(/\[TO BE CONFIRMED\]/g, '<mark>[TO BE CONFIRMED]</mark>');
  }

  function tableCells(line) {
    return line.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(function (c) { return c.trim(); });
  }

  function toHtml(md) {
    const lines = md.split('\n');
    const html = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        html.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      } else if (/^#{1,6}\s/.test(l)) {
        const lvl = Math.min(/^#+/.exec(l)[0].length, 6);
        html.push('<h' + lvl + '>' + inline(l.replace(/^#+\s+/, '')) + '</h' + lvl + '>');
        i++;
      } else if (/^\|/.test(l) && /^\|\s*:?-{2,}/.test(lines[i + 1] || '')) {
        const head = tableCells(l);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(tableCells(lines[i++]));
        html.push('<div class="table-wrap"><table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
      } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
        const ordered = /^\d+\./.test(l);
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
          const m = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (m[1].length >= 2 && items.length) items[items.length - 1].sub.push(m[2]); else items.push({ text: m[2], sub: [] });
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        html.push('<' + tag + '>' + items.map(function (it) {
          const cb = /^\[( |x)\]\s/.exec(it.text);
          const label = cb ? '<span class="cb" aria-hidden="true">☐</span> ' + inline(it.text.slice(4)) : inline(it.text);
          return '<li>' + label + (it.sub.length ? '<ul>' + it.sub.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>' : '') + '</li>';
        }).join('') + '</' + tag + '>');
      } else if (/^\s*$/.test(l)) {
        i++;
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
        if (!buf.length) buf.push(lines[i++]);
        html.push('<p>' + buf.map(inline).join('<br>') + '</p>');
      }
    }
    return html.join('\n');
  }

  APB.markdown = {
    build: build, filename: filename, chatPrompt: chatPrompt, toHtml: toHtml, profiles: profiles,
    // shared with the functional-spec generator (fs-generator.js)
    helpers: { table: table, gridMd: gridMd, renderFields: renderFields, clean: clean, cell: cell, splitLines: splitLines, slug: slug }
  };
})(window.APB = window.APB || {});
