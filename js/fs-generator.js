/* Functional specification → Markdown, in a standard SAP FS structure. The same Markdown feeds the live
   preview and the Word export (docx.js), so both always say the same thing. Nothing is invented: empty
   sections are left out and unknown table cells read [TO BE CONFIRMED]. */
(function (APB) {
  'use strict';
  const F = APB.fs, FC = APB.fsCompleteness, V = APB.validation, D = APB.defs;
  const H = APB.markdown.helpers;
  const TBC = FC.TBC;
  const table = H.table, clean = H.clean, cell = H.cell, splitLines = H.splitLines;

  let cur = null; // the spec being built: field labels follow its system (SAP or generic)
  function sap() { return F.isSap(cur); }
  function dash(v) { return clean(v) || '–'; }
  function opt(sectionId, fieldId, v, colId) {
    let f = F.view(F.field(sectionId, fieldId), cur);
    if (f && colId) f = (f.columns || f.fields || []).filter(function (c) { return c.id === colId; })[0];
    return v ? (f && f.options ? D.optionLabel(f, v) : v) : '';
  }
  function rows(a) { return (Array.isArray(a) ? a : []).filter(V.isFilled); }
  function bullets(text) { return splitLines(text).map(function (l) { return '- ' + l; }).join('\n'); }
  function sub(title, body) { return body && body.trim() ? '### ' + title + '\n\n' + body.trim() : ''; }
  function join(parts) { return parts.filter(function (p) { return p && p.trim(); }).join('\n\n'); }

  const CHECK_LABEL = { verified: '✓ Verified in system', missing: '✗ Not found in system', unchecked: '– Not checked', clash: '⚠ Name already exists', free: '✓ Name is free' };

  function title(s) { return (s.context.title || '').trim(); }

  function controlTable(s) {
    const c = s.control;
    return table(['Document ID', 'Version', 'Status', sap() ? 'Module' : 'System', 'Author', 'Date'],
      [[cell(c.docId), cell(c.version), cell(opt('control', 'status', c.status)), cell(F.systemLabel(s)), cell(c.author), F.today()]]);
  }

  function businessRequirement(s) {
    const c = s.context;
    return join([
      (c.requirement || '').trim(),
      (c.processArea || '').trim() && '- **Process area:** ' + clean(c.processArea),
      sub('Objectives', bullets(c.objectives)),
      sub('KPIs / success measures', bullets(c.kpis))
    ]);
  }

  function scope(s) {
    const c = s.context;
    const org = (sap() ? [['Company codes', c.companyCodes], ['Plants', c.plants], ['Sales organisations', c.salesOrgs], ['Other org units', c.otherOrg]] : [['Organisational scope', c.otherOrg]])
      .filter(function (o) { return (o[1] || '').trim(); }).map(function (o) { return '- **' + o[0] + ':** ' + clean(o[1]); }).join('\n');
    return join([sub('In scope', bullets(c.inScope)), sub('Out of scope', bullets(c.outOfScope)), sub('Organisational scope', org)]);
  }

  function processTable(list, last, lastLabel, sectionField) {
    list = rows(list);
    if (!list.length) return '';
    return table(['#', 'Step', 'Role', sap() ? 'Transaction / app' : 'System / screen', lastLabel], list.map(function (r, i) {
      const v = last === 'change' ? opt('process', sectionField, r.change, 'change') : r[last];
      return [String(i + 1), cell(r.step), dash(r.role), dash(r.tx), dash(v)];
    }));
  }

  /* TO-BE steps as a simple text flow (Markdown) – Word shows the same block. */
  function flow(list) {
    list = rows(list).filter(function (r) { return (r.step || '').trim(); });
    if (list.length < 2) return '';
    return '```text\n' + list.map(function (r, i) {
      return (i + 1) + '. ' + r.step.trim() + ((r.role || '').trim() ? ' [' + r.role.trim() + ']' : '') + ((r.tx || '').trim() ? ' · ' + r.tx.trim() : '');
    }).join('\n   ↓\n') + '\n```';
  }

  function frSection(s) {
    const list = s.reqs.frs || [];
    const filled = list.map(function (f, i) { return { f: f, id: F.frId(i) }; }).filter(function (x) { return V.isFilled(x.f); });
    if (!filled.length) return '';
    const summary = table(['ID', 'Requirement', 'Priority', 'Fit-gap'], filled.map(function (x) {
      return [x.id, cell(x.f.title), dash(opt('reqs', 'frs', x.f.priority, 'priority')), cell(x.f.fit === 'tbc' ? '' : opt('reqs', 'frs', x.f.fit, 'fit'))];
    }));
    const details = filled.map(function (x) {
      const f = x.f;
      const ac = splitLines(f.acceptance);
      return join([
        '### ' + x.id + ': ' + ((f.title || '').trim() || TBC),
        (f.description || '').trim(),
        '**Acceptance criteria**\n\n' + (ac.length ? ac.map(function (a, j) { return '- AC-' + x.id.slice(3) + '.' + (j + 1) + ' ' + a; }).join('\n') : '- ' + TBC),
        (f.approach || '').trim() && '**Standard / configuration approach:** ' + clean(f.approach)
      ]);
    });
    return join([summary].concat(details));
  }

  function rulesTable(s) {
    const l = rows(s.reqs.rules);
    return l.length ? table(['ID', 'Rule', 'Type', 'Message / outcome', 'FR'], l.map(function (r, i) {
      return ['BR-' + (i < 9 ? '0' : '') + (i + 1), cell(r.rule), dash(opt('reqs', 'rules', r.type, 'type')), dash(r.outcome), dash(F.parseFrRefs(r.fr).join(', ') || r.fr)];
    })) : '';
  }

  function checkMap(s) {
    const m = {};
    if (s.discovery) APB.discovery.crossCheck(s).forEach(function (r) { m[r.name] = r.status; });
    return m;
  }

  function dataTable(s) {
    const l = rows(s.reqs.data);
    if (!l.length) return '';
    const m = checkMap(s);
    const withCheck = !!s.discovery;
    if (!sap()) {
      return table(['Business field', 'Stored in', 'Mandatory', 'Validation / format', 'Source'], l.map(function (r) {
        return [cell(r.field), dash(r.table), r.mandatory ? 'Yes' : 'No', dash(r.validation), dash(opt('reqs', 'data', r.source, 'source'))];
      }));
    }
    return table(['Business field', 'SAP table / CDS', 'SAP field', 'Mandatory', 'Validation / format', 'Source'].concat(withCheck ? ['System check'] : []), l.map(function (r) {
      const row = [cell(r.field), cell(r.table), cell(r.sapField), r.mandatory ? 'Yes' : 'No', dash(r.validation), dash(opt('reqs', 'data', r.source, 'source'))];
      if (withCheck) {
        const n = APB.discovery.names(r.table)[0];
        row.push(n ? (CHECK_LABEL[m[n]] || '–') : '–');
      }
      return row;
    }));
  }

  function systemContext(s) {
    const p = s.discovery;
    if (!p) return '';
    const DS = APB.discovery;
    const age = DS.ageDays(p);
    const sys = p.system;
    const intro = ['Read-only discovery by the `' + DS.cfg.agent + '` agent through the ' + DS.cfg.mcpServers.join(', ') + ' MCP servers' +
      (sys.sid ? ' on system **' + clean(sys.sid) + '**' + (sys.client ? ' client ' + clean(sys.client) : '') : '') +
      (sys.release ? ' (' + clean(sys.release) + ')' : '') + (p.generatedAt ? ', ' + clean(p.generatedAt.slice(0, 10)) : '') + '.'];
    if (p.sample) intro.push('**Sample data for demonstration – not read from the DEWA system.**');
    if (DS.isStale(p)) intro.push('**The discovery is ' + age + ' days old – re-run it before sign-off.**');
    const comps = p.system.components.map(function (c) { return c.name + (c.release ? ' ' + c.release : ''); }).filter(Boolean);
    const T = DS.cfg.objectTypeMap;
    return join([
      intro.join('\n\n'),
      comps.length && '- **Software components:** ' + clean(comps.join(', ')),
      p.objects.length && sub('Relevant objects', table(['Type', 'Name', 'Description', 'Package', 'Origin', 'Released'], p.objects.map(function (o) {
        return [dash(T[o.type] ? T[o.type] + ' (' + o.type + ')' : o.type), dash(o.name), dash(o.description), dash(o.package), o.origin === 'custom' ? 'Custom' : 'SAP standard', o.released ? 'Yes' : '–'];
      }))),
      (p.transactions.length || p.fioriApps.length || p.ui5Apps.length) && sub('Transactions & apps', table(['Kind', 'ID', 'Title / description', 'OData service'],
        p.transactions.map(function (t) { return ['Transaction', dash(t.code), dash(t.description), '–']; })
          .concat(p.fioriApps.map(function (a) { return ['Fiori app', dash(a.appId), dash(a.title + (a.semanticObject ? ' (' + a.semanticObject + (a.action ? '-' + a.action : '') + ')' : '')), dash(a.odataService)]; }))
          .concat(p.ui5Apps.map(function (a) { return ['UI5 app', dash(a.name), dash(a.description), '–']; })))),
      p.enhancements.length && sub('Enhancement options', table(['Type', 'Name', 'Description', 'Implemented'], p.enhancements.map(function (e) { return [dash(e.type), dash(e.name), dash(e.description), e.implemented ? 'Yes' : 'No']; }))),
      p.capServices.length && sub('CAP services', table(['Service', 'Description', 'Entities'], p.capServices.map(function (c) { return [dash(c.name), dash(c.description), dash(c.entities)]; }))),
      p.customizingHints.length && sub('Customizing to check', p.customizingHints.map(function (h) { return '- ' + (h.path ? '**' + clean(h.path) + '**' + (h.note ? ': ' : '') : '') + clean(h.note); }).join('\n')),
      p.notFound.length && sub('Not found in the system', p.notFound.map(function (n) { return '- ' + clean(n.name) + (n.reason ? ' – ' + clean(n.reason) : ''); }).join('\n')),
      sub('Reference check', referenceCheck(s))
    ]);
  }

  function referenceCheck(s) {
    const l = APB.discovery.crossCheck(s);
    return l.length ? table(['Name', 'Used in', 'Result'], l.map(function (r) { return [clean(r.name), clean(r.where), CHECK_LABEL[r.status] + (r.info && r.status !== 'unchecked' ? ' – ' + clean(r.info) : '')]; })) : '';
  }

  function coveredBy(s) {
    const ids = F.ricefwIds(s.solution.ricefw);
    const map = {};
    (s.solution.ricefw || []).forEach(function (r, i) {
      if (!V.isFilled(r)) return;
      F.parseFrRefs(r.frs).forEach(function (fr) { (map[fr] = map[fr] || []).push(ids[i] + ((r.name || '').trim() ? ' ' + r.name.trim() : '')); });
    });
    return map;
  }

  /* FR → fit-gap → solution (→ RICEFW for SAP) → UAT, in one table (fit-gap and traceability together). */
  function fitGap(s) {
    const by = coveredBy(s);
    const tests = {};
    rows(s.quality.uat).forEach(function (r, i) { F.parseFrRefs(r.fr).forEach(function (fr) { (tests[fr] = tests[fr] || []).push('UAT-' + (i < 9 ? '0' : '') + (i + 1)); }); });
    const l = (s.reqs.frs || []).map(function (f, i) { return { f: f, id: F.frId(i) }; }).filter(function (x) { return V.isFilled(x.f); });
    if (!l.length) return '';
    return table(['FR', 'Requirement', 'Fit-gap', 'Solution'].concat(sap() ? ['RICEFW'] : []).concat(['UAT']), l.map(function (x) {
      const std = x.f.fit === 'standard' || x.f.fit === 'config';
      const row = [x.id, cell(x.f.title), !x.f.fit || x.f.fit === 'tbc' ? TBC : clean(opt('reqs', 'frs', x.f.fit, 'fit')), dash((x.f.approach || '').trim())];
      if (sap()) row.push((by[x.id] || []).join(', ') || (std ? 'n/a' : TBC));
      row.push((tests[x.id] || []).join(', ') || TBC);
      return row;
    }));
  }

  /* Current System: what the existing program does (Read an existing program). */
  function programLogic(s) {
    const p = s.process;
    const objs = rows(p.programs);
    const tbl = objs.length ? table(['Object', 'Type', 'Description', 'Role'], objs.map(function (o) { return [cell(o.name), dash(o.type), dash(o.description), dash(opt('process', 'programs', o.role, 'role'))]; })) : '';
    return sub('Current program logic', join([(p.currentLogic || '').trim(), tbl]));
  }

  function solution(s) {
    const list = s.solution.ricefw || [];
    const ids = F.ricefwIds(list);
    const items = list.map(function (r, i) { return { r: r, id: ids[i] }; }).filter(function (x) { return V.isFilled(x.r); });
    const inv = items.length ? table(['ID', 'Type', 'Object', 'Covers', 'Complexity'], items.map(function (x) {
      return [x.id, cell(x.r.type ? F.ricefwType(x.r.type).label : ''), cell(x.r.name), dash(F.parseFrRefs(x.r.frs).join(', ')), dash(opt('solution', 'ricefw', x.r.complexity, 'complexity'))];
    })) : '';
    const details = items.map(function (x) {
      return join([
        '#### ' + x.id + ': ' + ((x.r.name || '').trim() || TBC) + (x.r.type ? ' (' + F.ricefwType(x.r.type).label + ')' : ''),
        (x.r.description || '').trim(),
        (x.r.existing || '').trim() && '- **Existing objects / enhancement spots:** ' + clean(x.r.existing)
      ]);
    });
    return join([sub('RICEFW items', join([inv].concat(details))), sub('Configuration (SPRO)', bullets(s.solution.customizing))]);
  }

  function simpleGrid(sectionId, fieldId, list) {
    const f = F.view(F.field(sectionId, fieldId), cur);
    return f ? H.gridMd(f, list) : '';
  }

  function nfr(s) {
    const q = s.quality;
    return [['Performance', q.performance], ['Data volumes', q.volume], ['Availability / processing window', q.availability], ['Audit & compliance', q.audit], ['Data privacy', q.privacy]]
      .filter(function (x) { return (x[1] || '').trim(); }).map(function (x) { return '- **' + x[0] + ':** ' + clean(x[1]); }).join('\n');
  }

  function uat(s) {
    const l = rows(s.quality.uat);
    return l.length ? table(['ID', 'FR', 'Scenario', 'Type', 'Expected result'], l.map(function (r, i) {
      return ['UAT-' + (i < 9 ? '0' : '') + (i + 1), dash(F.parseFrRefs(r.fr).join(', ') || r.fr), cell(r.scenario), dash(opt('quality', 'uat', r.type, 'type')), cell(r.expected)];
    })) : '';
  }

  function build(s) {
    cur = s;
    const sections = [];
    function add(t, body) { if (body && body.trim()) sections.push({ title: t, body: body.trim() }); }
    add('Business Requirement & Scope', join([businessRequirement(s), scope(s), sub('Stakeholders', simpleGrid('context', 'stakeholders', s.context.stakeholders))]));
    add('Process', join([
      sub('Current process (AS-IS)', processTable(s.process.asIs, 'pain', 'Pain point')),
      sub('Proposed process (TO-BE)', join([processTable(s.process.toBe, 'change', 'Change', 'toBe'), flow(s.process.toBe)])),
      sub('Variants & exceptions', bullets(s.process.variants))]));
    add('Functional Requirements', join([frSection(s), sub('Business rules & validations', rulesTable(s)), sub('Data requirements', dataTable(s))]));
    add('Current System', join([programLogic(s), sap() ? sub('SAP system context', systemContext(s).replace(/^### /gm, '#### ')) : '']));
    add('Solution', join([sub('Fit-gap & traceability', fitGap(s)), sap() ? solution(s) : '',
      sub(sap() ? 'Roles & authorizations' : 'Roles & access', simpleGrid('solution', 'roles', s.solution.roles)),
      sub('Interfaces', simpleGrid('solution', 'interfaces', s.solution.interfaces)),
      sub('Outputs & forms', simpleGrid('solution', 'outputs', s.solution.outputs))]));
    add('Testing & Quality', join([sub('Test scenarios (UAT)', uat(s)), sub('Non-functional requirements', nfr(s))]));
    add('Risks & Open Questions', join([sub('Risks, assumptions & open points', simpleGrid('quality', 'risks', s.quality.risks)),
      sub('Open questions', FC.openQuestions(s).map(function (q, i) { return (i + 1) + '. ' + TBC + ' ' + q; }).join('\n'))]));
    add('Document Control', join([sub('Version history', simpleGrid('control', 'history', s.control.history)), sub('Approvals', simpleGrid('control', 'approvals', s.control.approvals))]));

    const lines = ['# Functional Specification' + (title(s) ? ': ' + title(s) : ''), '', controlTable(s), ''];
    sections.forEach(function (sec, i) { lines.push('## ' + (i + 1) + '. ' + sec.title, '', sec.body, ''); });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  /* Prompt for Copilot Chat (VS Code panel): review the FS, then answer questions about it. */
  function chatPrompt(s) {
    const ask = ['Review this functional specification for a business audience. List briefly, by section:',
      '- gaps and missing information',
      '- contradictions',
      '- requirements that cannot be tested, and missing acceptance criteria',
      '- open questions to ask the business'];
    if (F.isSap(s)) ask.push('- where SAP standard or configuration could replace a custom-development gap');
    ask.push('Then answer my questions about it. Do not change any files.');
    return ask.join('\n') + '\n\n---\n\n' + build(s);
  }

  function mdFilename() { return 'FUNCTIONAL_SPECIFICATION.md'; }
  function docxFilename(s) {
    const parts = ['FS', H.slug(F.isSap(s) ? s.context.module : (s.context.system === 'other' ? s.context.systemName : '')), H.slug(title(s) || s.control.docId || 'Specification')].filter(Boolean);
    return parts.join('_').slice(0, 120) + '.docx';
  }

  /* Metadata for the Word title page, header and footer. */
  function docMeta(s) {
    const c = s.control;
    cur = s;
    return {
      title: title(s) || 'Functional Specification',
      kind: 'Functional Specification',
      docId: (c.docId || '').trim(),
      version: (c.version || '').trim(),
      status: opt('control', 'status', c.status),
      module: F.systemLabel(s),
      moduleLabel: sap() ? 'Module' : 'System',
      author: (c.author || '').trim(),
      date: F.today()
    };
  }

  APB.fsMarkdown = { build: build, chatPrompt: chatPrompt, filename: mdFilename, docxFilename: docxFilename, docMeta: docMeta, crossCheckLabel: CHECK_LABEL };
})(window.APB = window.APB || {});
