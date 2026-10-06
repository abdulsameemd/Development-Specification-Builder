/* Turns the specification model into Markdown. Output "profiles" decide the
   filename and the closing instruction block; only GitHub Copilot exists today. */
(function (APB) {
  'use strict';
  const D = APB.defs;
  const C = APB.completeness;
  const TBC = C.TBC;

  /* ---------- output profiles ---------- */
  const profiles = {
    copilot: {
      id: 'copilot',
      label: 'GitHub Copilot',
      filenameSuffix: 'COPILOT_REQUIREMENT',
      instructionsTitle: 'Copilot Development Instructions',
      instructions: function (s) {
        const qa = s.quality;
        const hasAbap = s.types.some(function (t) { return t !== 'CAPM'; });
        const hasAc = s.acceptance.some(function (a) { return a.text.trim(); });
        const named = s.objects.some(function (o) { return o.status === 'new'; }) || (s.advanced.namingConvention || '').trim();
        return [
          'Read this entire specification.',
          'Inspect the existing project/repository before writing code.',
          'Reuse existing SAP objects (listed here or found in the repository/system). Do not create duplicate functionality.',
          'Do not invent SAP objects, tables, fields, APIs, CDS views, classes, function modules, workflows, authorization objects, or business rules.',
          'Anything unknown is marked ' + TBC + ': inspect the repository/system where possible, otherwise ask for clarification instead of inventing an implementation.',
          named && 'Use the proposed names for new objects and follow the specified naming conventions.',
          qa.cleanCore !== 'no' && 'Follow SAP Clean Core principles: prefer released APIs, standard SAP functionality and extension mechanisms.',
          hasAbap && 'Use modern ABAP syntax where applicable.',
          qa.authorization !== 'no' && 'Implement authorization checks where required and never bypass SAP security.',
          'Implement proper exception handling and avoid inefficient data access.',
          'Keep business logic testable and create appropriate tests.',
          'Identify assumptions instead of silently guessing.',
          hasAc ? 'Validate the implementation against the acceptance criteria.' : 'Validate the implementation against the requirement.'
        ].filter(Boolean);
      },
      closing: 'Implement incrementally and explain significant assumptions or deviations.'
    }
  };

  /* ---------- helpers ---------- */
  function cell(v) {
    const t = String(v == null ? '' : v).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
    return t || TBC;
  }

  function purposeCell(v) { return String(v || '').trim() ? cell(v) : '–'; }

  function table(headers, rows) {
    const out = ['| ' + headers.join(' | ') + ' |', '|' + headers.map(function () { return '---'; }).join('|') + '|'];
    rows.forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
    return out.join('\n');
  }

  function splitLines(v) {
    return String(v || '').split(/\r?\n/).map(function (l) { return l.trim().replace(/^[-*•]\s+/, ''); }).filter(Boolean);
  }

  /* One rendered value per field, or null when the field is empty / hidden. */
  function fieldValue(field, v) {
    switch (field.kind) {
      case 'lines':
      case 'textarea': {
        const lines = splitLines(v);
        if (!lines.length) return null;
        return lines.length === 1 && field.kind === 'textarea' ? { text: lines[0] } : { lines: lines };
      }
      case 'multicheck': {
        if (!Array.isArray(v) || !v.length) return null;
        return { text: v.map(function (x) { return D.optionLabel(field, x); }).join(', ') };
      }
      case 'radio':
      case 'select': {
        if (!v) return null;
        return { text: v === 'tbc' ? TBC : D.optionLabel(field, v) };
      }
      default: {
        const t = String(v == null ? '' : v).trim();
        return t ? { text: t } : null;
      }
    }
  }

  function renderItem(label, val) {
    const sep = /[?:]$/.test(label) ? '' : ':';
    if (val.lines) return '- **' + label + '**' + sep + '\n' + val.lines.map(function (l) { return '  - ' + l; }).join('\n');
    return '- **' + label + '**' + sep + ' ' + val.text;
  }

  /* All filled fields that belong to a Markdown section, across types and cross-cutting groups. */
  function sectionItems(s, section, skipIds) {
    const items = [];
    const multi = s.types.length > 1;
    s.types.forEach(function (t) {
      const values = s.details[t] || {};
      const f = D.typeFields(t);
      f.essential.concat(f.advanced).forEach(function (field) {
        if (field.section !== section || !D.isVisible(field, values)) return;
        const val = fieldValue(field, values[field.id]);
        if (val) items.push(renderItem(field.label + (multi ? ' (' + D.types[t].label + ')' : ''), val));
      });
    });
    [[D.quality, s.quality], [D.advanced, s.advanced]].forEach(function (g) {
      g[0].forEach(function (field) {
        if (field.section !== section || (skipIds && skipIds.indexOf(field.id) >= 0) || !D.isVisible(field, g[1])) return;
        const val = fieldValue(field, g[1][field.id]);
        if (val) items.push(renderItem(field.label, val));
      });
    });
    return items;
  }

  function objectRows(list) {
    return list.map(function (o) { return [cell(o.type), cell(o.name), purposeCell(o.purpose)]; });
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

    const existing = s.objects.filter(function (o) { return o.status === 'existing'; });
    const tbc = s.objects.filter(function (o) { return o.status === 'tbc'; });
    const fresh = s.objects.filter(function (o) { return o.status === 'new'; });
    let ex = existing.length ? table(['Type', 'Name', 'Purpose'], objectRows(existing)) : '';
    if (tbc.length) ex += (ex ? '\n\n' : '') + '**Existence to be confirmed** (check the system before reusing or creating):\n\n' + table(['Type', 'Name', 'Purpose'], objectRows(tbc));
    add('Existing Objects', ex);
    add('New Objects', fresh.length ? table(['Type', 'Proposed name', 'Purpose'], objectRows(fresh)) : '');

    if (s.objects.length) {
      const tree = C.treeToText(C.buildTree(s), function (o) { return C.objectLabel(o) + ' [' + D.statusLabel(o.status).toLowerCase() + ']'; });
      add('Dependencies', '```text\n' + tree + '\n```');
    }

    add('Functional Requirements', sectionItems(s, 'functional').join('\n'));
    add('Technical Details', sectionItems(s, 'technical').join('\n'));

    const rules = s.rules.filter(function (r) { return r.condition.trim() || r.behavior.trim(); });
    add('Business Rules', rules.length ? table(['ID', 'Condition', 'Expected behavior'], rules.map(function (r, i) { return ['BR-' + (i + 1), cell(r.condition), cell(r.behavior)]; })) : '');

    add('Input', sectionItems(s, 'input').join('\n'));
    const out = [];
    if (s.requirement.expectedOutput.trim()) out.push('- **Expected output**: ' + s.requirement.expectedOutput.trim().replace(/\s*\n\s*/g, ' '));
    add('Output', out.concat(sectionItems(s, 'output')).join('\n'));

    add('Authorization', sectionItems(s, 'security').join('\n'));
    add('Error Handling', sectionItems(s, 'errors').join('\n'));
    add('Performance', sectionItems(s, 'performance').join('\n'));

    const tests = sectionItems(s, 'testing', ['testScenarios']);
    const cases = testCases(s);
    add('Testing', tests.join('\n') + (cases ? (tests.length ? '\n\n' : '') + cases : ''));

    const acc = s.acceptance.filter(function (a) { return a.text.trim(); });
    add('Acceptance Criteria', acc.map(acceptanceBlock).join('\n\n'));

    const cc = sectionItems(s, 'cleancore');
    if (cc.length && s.quality.cleanCore !== 'no') cc.push('- Prefer released SAP APIs and standard extension mechanisms.');
    add('Clean Core', cc.join('\n'));

    const assumptions = splitLines(s.assumptions);
    add('Assumptions', assumptions.map(function (a) { return '- ' + a; }).join('\n'));

    const q = C.openQuestions(s);
    add('Open Questions', q.map(function (x, i) { return (i + 1) + '. ' + TBC + ' ' + x; }).join('\n'));

    const dod = s.dod.filter(function (d) { return d.on && d.text.trim(); });
    add('Definition of Done', dod.map(function (d) { return '- [ ] ' + d.text.trim(); }).join('\n'));

    add(profile.instructionsTitle, 'Before implementing:\n\n' + profile.instructions(s).map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') + '\n\n' + profile.closing);

    const lines = ['# SAP Development Specification', ''];
    if (s.project.name.trim()) lines.push('**Project:** ' + s.project.name.trim(), '');
    sections.forEach(function (sec, i) { lines.push('## ' + (i + 1) + '. ' + sec.title, '', sec.body, ''); });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  function slug(v) { return String(v || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

  function filename(s, profileId) {
    const profile = profiles[profileId || 'copilot'];
    const firstNew = s.objects.filter(function (o) { return o.status === 'new' && o.name.trim(); })[0];
    const base = slug(s.project.name) || (firstNew && slug(firstNew.name)) || slug(s.types.join('_')) || 'SAP';
    return base + '_' + profile.filenameSuffix + '.md';
  }

  /* ---------- lightweight Markdown → HTML for the preview ---------- */
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\\\|/g, '|')
      .replace(/\[TO BE CONFIRMED\]/g, '<mark>[TO BE CONFIRMED]</mark>')
      .replace(/&lt;br&gt;/g, '<br>');
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
      } else if (/^#{1,3}\s/.test(l)) {
        const lvl = /^#+/.exec(l)[0].length;
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
        // list block (supports one level of nesting by 2-space indent)
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
        while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
        if (!buf.length) { buf.push(lines[i++]); }
        html.push('<p>' + buf.map(inline).join('<br>') + '</p>');
      }
    }
    return html.join('\n');
  }

  APB.markdown = { build: build, filename: filename, toHtml: toHtml, profiles: profiles };
})(window.APB = window.APB || {});
