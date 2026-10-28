/* Upload a generated specification (.md) back into the builder.
   Downloaded files end with one hidden HTML comment holding the compressed builder state, so the
   upload restores the spec exactly. Files without it (older downloads, hand-written) are read
   best-effort from their sections and tables. */
(function (APB) {
  'use strict';
  const MARK = 'spec-builder-state:v1';
  // \x3c instead of a literal '<' because the single-file build inlines this file into a script tag
  const BLOCK = /\n?\x3c!-- spec-builder-state:v1 ([zr][A-Za-z0-9_-]+)[^>]*-->\s*$/;
  const TBC = '[TO BE CONFIRMED]';

  async function embed(md, state) {
    const token = await APB.exporter.encodeState(state);
    return md.replace(/\s*$/, '\n') + '\n\x3c!-- ' + MARK + ' ' + token + ' – data for the SAP Specification Builder (Upload), not part of the specification -->\n';
  }

  function buildMd(s) { return s.kind === 'fs' ? APB.fsMarkdown.build(s) : APB.markdown.build(s); }
  function norm(t) { return String(t || '').replace(/\r/g, '').replace(/\d{4}-\d{2}-\d{2}/g, 'DATE').replace(/[ \t]+$/gm, '').trim(); }

  /* ------------------------------------------------------------- md helpers */
  function sections(md) {
    const out = {};
    let cur = null;
    md.replace(/\r/g, '').split('\n').forEach(function (l) {
      const m = /^##\s+(?:\d+\.\s+)?(.+?)\s*$/.exec(l);
      if (m && !/^###/.test(l)) { cur = m[1]; out[cur] = []; } else if (cur) out[cur].push(l);
    });
    Object.keys(out).forEach(function (k) { out[k] = out[k].join('\n').trim(); });
    return out;
  }
  function cells(line) { return line.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(function (c) { return c.trim().replace(/\\\|/g, '|'); }); }
  function val(c) { c = String(c || '').replace(/\*\*/g, '').trim(); return c === TBC || c === '–' || c === '-' ? '' : c; }
  /* first Markdown table in a text → [{ header: value }] */
  function table(text) {
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\|/.test(lines[i]) && /^\|\s*:?-{2,}/.test(lines[i + 1])) {
        const head = cells(lines[i]), rows = [];
        for (let j = i + 2; j < lines.length && /^\|/.test(lines[j]); j++) {
          const c = cells(lines[j]), r = {};
          head.forEach(function (h, k) { r[h] = val(c[k]); });
          rows.push(r);
        }
        return rows;
      }
    }
    return [];
  }
  function bullets(text) { return String(text || '').split('\n').filter(function (l) { return /^\s*[-*]\s+/.test(l); }).map(function (l) { return l.replace(/^\s*[-*]\s+/, '').trim(); }); }
  function firstParas(text) {
    const out = [];
    for (const l of String(text || '').split('\n')) { if (/^(\s*[-*]\s|#|\||```)/.test(l)) break; out.push(l); }
    return out.join('\n').trim();
  }
  function sub(text, title) {
    const m = new RegExp('^###\\s+' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm').exec(text || '');
    if (!m) return '';
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/^###\s/m);
    return (end >= 0 ? rest.slice(0, end) : rest).trim();
  }
  function optionValue(field, label) {
    if (!field || !label) return '';
    const o = (field.options || []).filter(function (x) { return x.label.toLowerCase() === label.toLowerCase() || x.value.toLowerCase() === label.toLowerCase(); })[0];
    return o ? o.value : '';
  }
  function col(field, id) { return field ? (field.columns || field.fields || []).filter(function (c) { return c.id === id; })[0] : null; }

  /* ------------------------------------------------------- partial: FS */
  function partialFs(md) {
    const F = APB.fs;
    const s = F.model.blank();
    const sec = sections(md);
    const h1 = /^#\s+Functional Specification(?::\s*(.+))?$/m.exec(md);
    if (h1 && h1[1]) s.context.title = h1[1].trim();
    const ctl = table(md.split(/^##\s/m)[0])[0] || {};
    if (ctl.Module) s.context.module = ctl.Module;
    if (ctl['Document ID']) s.control.docId = ctl['Document ID'];
    if (ctl.Version) s.control.version = ctl.Version;
    const br = sec['Business Requirement'] || '';
    s.context.requirement = firstParas(br);
    const pa = /\*\*Process area:\*\*\s*(.+)/.exec(br);
    if (pa) s.context.processArea = pa[1].trim();
    s.context.objectives = bullets(sub(br, 'Objectives')).join('\n');
    s.context.kpis = bullets(sub(br, 'KPIs / success measures')).join('\n');
    const sc = sec.Scope || '';
    s.context.inScope = bullets(sub(sc, 'In scope')).join('\n');
    s.context.outOfScope = bullets(sub(sc, 'Out of scope')).join('\n');
    const procRows = function (text, last) {
      return table(text).map(function (r) {
        const row = { step: r.Step || '', role: r.Role || '', tx: r['Transaction / app'] || '' };
        if (last === 'pain') row.pain = r['Pain point'] || '';
        else row.change = optionValue(col(F.field('process', 'toBe'), 'change'), r.Change);
        return row;
      }).filter(function (r) { return r.step; });
    };
    s.process.asIs = procRows(sec['Current Process (AS-IS)'], 'pain');
    s.process.toBe = procRows(sec['Proposed Process (TO-BE)'], 'change');
    const frSec = sec['Functional Requirements'] || '';
    const frField = F.field('reqs', 'frs');
    s.reqs.frs = table(frSec).map(function (r) {
      const id = r.ID || '';
      const block = sub(frSec, id + ': ' + (r.Requirement || '')) || '';
      return {
        title: r.Requirement || '',
        priority: optionValue(col(frField, 'priority'), r.Priority),
        fit: optionValue(col(frField, 'fit'), r['Fit-gap']),
        description: firstParas(block),
        acceptance: bullets(block).filter(function (b) { return /^AC-/.test(b); }).map(function (b) { return b.replace(/^AC-[\d.]+\s*/, ''); }).filter(function (b) { return b && b !== TBC; }).join('\n')
      };
    }).filter(function (f) { return f.title; });
    s.reqs.rules = table(sec['Business Rules & Validations']).map(function (r) {
      return { rule: r.Rule || '', type: optionValue(col(F.field('reqs', 'rules'), 'type'), r.Type), outcome: r['Message / outcome'] || '', fr: r.FR || '' };
    }).filter(function (r) { return r.rule; });
    return s;
  }

  /* ------------------------------------------------- partial: Technical */
  function partialDev(md) {
    const D = APB.defs, S = APB.state;
    const s = S.blank('dev');
    const sec = sections(md);
    const pj = /\*\*Project:\*\*\s*(.+)/.exec(md);
    if (pj) s.project.name = pj[1].trim();
    s.requirement.text = (sec.Requirement || '').trim();
    bullets(sec['Development Object']).forEach(function (b) {
      const k = D.typeKeys().filter(function (t) { return D.types[t].label === b; })[0];
      if (k && s.types.indexOf(k) < 0) s.types.push(k);
    });
    const bo = sec['Business Objective'] || '';
    s.requirement.objective = firstParas(bo);
    const us = /\*\*Users \/ Role\*\*:\s*(.+)/.exec(bo);
    if (us) s.requirement.users = us[1].trim();
    const eo = /\*\*Expected output\*\*:\s*(.+)/.exec(sec.Output || '');
    if (eo) s.requirement.expectedOutput = eo[1].trim();
    [['Existing Objects (reuse)', 'existing'], ['Existing Objects to Change', 'change'], ['New Objects', 'new']].forEach(function (x) {
      table(sec[x[0]]).forEach(function (r) {
        const type = D.objectTypes.indexOf(r.Type) >= 0 ? r.Type : 'Other';
        s.objects.push({ id: S.uid(), type: type, name: r.Name || r['Proposed name'] || '', status: x[1], purpose: r.Purpose || '', parent: '', detail: r['What is used'] ? { used: r['What is used'] } : {} });
      });
    });
    s.rules = table(sec['Business Rules']).map(function (r) { return { id: S.uid(), condition: r.Condition || '', behavior: r['Expected behavior'] || '' }; }).filter(function (r) { return r.condition || r.behavior; });
    s.acceptance = String(sec['Acceptance Criteria'] || '').split(/\*\*AC-\d+\*\*/).map(function (b) {
      return bullets(b).map(function (l) { return l.replace(/\*\*(Given|When|Then)\*\*\s*/, '$1 '); }).join(', ').trim();
    }).filter(Boolean).map(function (t) { return { id: S.uid(), text: t }; });
    s.assumptions = bullets(sec.Assumptions).join('\n');
    return s;
  }

  /* → { state, mode: 'exact' | 'partial', edited } or throws with a user-readable message */
  async function read(text) {
    text = String(text || '').replace(/^﻿/, '');
    const m = BLOCK.exec(text);
    if (m) {
      const state = await APB.exporter.decodeState(m[1]);
      if (!state) throw new Error('The builder data in this file could not be read.');
      const edited = norm(buildMd(state)) !== norm(text.replace(BLOCK, ''));
      return { state: state, mode: 'exact', edited: edited };
    }
    if (/^#\s+Functional Specification/m.test(text)) return { state: APB.state.migrate(partialFs(text)), mode: 'partial', edited: false };
    if (/^#\s+SAP Development Specification/m.test(text)) return { state: APB.state.migrate(partialDev(text)), mode: 'partial', edited: false };
    throw new Error('This is not a specification generated by the builder (expected FUNCTIONAL_SPECIFICATION.md or BUSINESS_REQUIREMENTS.md).');
  }

  APB.mdImport = { embed: embed, read: read, MARK: MARK };
})(window.APB = window.APB || {});
