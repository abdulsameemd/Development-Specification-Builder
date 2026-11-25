/* Functional spec → Technical spec: the fixed part of the hand-off (no AI). The FS data rows ("Used for": selection,
   output, both, input, stored, display), outputs and requirement become the designer of the main object – selection
   screen and ALV columns of a report, filters / columns of a Fiori app, elements of a CDS view, parameters of an RFC,
   fields of a table. What the FS does not say stays empty for "Complete the TS with Copilot" (ts-draft.js).
   Also: a proposed name for a RICEFW item without one (module prefix), and a compact FS extract that the TS keeps
   (origin.fsText) so Copilot can complete it later without the FS open. */
(function (APB) {
  'use strict';

  function str(v) { return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); }
  function up(v) { return str(v).toUpperCase(); }
  function filled(r) { return r && (str(r.field) || str(r.sapField)); }
  const IN = { selection: 1, both: 1 };
  const OUT = { output: 1, both: 1, display: 1 };

  /* TABLE-FIELD when both are known, else whatever is known */
  function ref(r) { const t = up(r.table), f = up(r.sapField); return t && f ? t + '-' + f : f || t; }
  function ident(r, max) {
    const f = up(r.sapField) || up(r.field).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return f.slice(0, max || 30);
  }
  function single(r) { return /\b(single|one value|exact(ly)? one|key date|date as of|as of date|checkbox|flag|yes\/no)\b/i.test(str(r.validation)); }

  function rows(fs, set) { return ((fs.reqs && fs.reqs.data) || []).filter(function (r) { return filled(r) && set[r.usage]; }); }

  /* the output channel of a report from the FS outputs, the RICEFW description and the requirement */
  function reportOutput(fs, item) {
    const text = [str(item && item.description), str(fs.context && fs.context.requirement), str(fs.context && fs.context.title)].join(' ');
    const outs = ((fs.solution && fs.solution.outputs) || []).filter(function (o) { return o && (str(o.name) || o.type); });
    const set = [];
    const add = function (v) { if (set.indexOf(v) < 0) set.push(v); };
    if (/\bALV\b/i.test(text) || outs.some(function (o) { return o.type === 'report'; }) || /\b(report|list)\b/i.test(text)) add('ALV (CL_SALV_TABLE)');
    if (outs.some(function (o) { return o.type === 'email'; }) || /\be-?mail\b/i.test(text)) add('E-mail');
    if (outs.some(function (o) { return o.type === 'file'; }) || /\b(download|excel|csv|file)\b/i.test(text)) add('File – presentation server');
    if (outs.some(function (o) { return o.type === 'form'; })) add('Form / spool');
    return set;
  }

  /* designer detail of the main object, per object type; only what the FS says */
  function designer(fs, objType, item) {
    const sel = rows(fs, IN), out = rows(fs, OUT);
    const d = {};
    if (objType === 'Report') {
      d.programType = 'Executable program (type 1)';
      d.selection = sel.map(function (r) {
        const p = single(r);
        return { name: ((p ? 'P_' : 'S_') + ident(r, 6)).slice(0, 8), kind: p ? 'PARAMETERS' : 'SELECT-OPTIONS', type: ref(r), label: str(r.field), obligatory: !!r.mandatory, noIntervals: false, default: '', notes: str(r.validation) };
      });
      d.columns = out.map(function (r) { return { field: ident(r), header: str(r.field), source: ref(r), props: str(r.validation) }; });
      const o = reportOutput(fs, item);
      if (o.length) d.outputType = o;
    } else if (objType === 'Fiori/UI5') {
      d.filters = sel.map(function (r) { return { field: str(r.sapField) || str(r.field), label: str(r.field), mandatory: !!r.mandatory, default: '', valueHelp: '' }; });
      d.columns = out.map(function (r, i) { return { field: str(r.sapField) || str(r.field), label: str(r.field), importance: i < 3 ? 'High' : '', position: String(i + 1), note: str(r.validation) }; });
    } else if (objType === 'CDS') {
      d.elements = out.concat(sel.filter(function (r) { return out.indexOf(r) < 0; })).map(function (r) {
        return { expression: str(r.sapField) ? (str(r.table) ? str(r.table).toLowerCase() + '.' : '') + str(r.sapField).toLowerCase() : str(r.field), alias: str(r.field).replace(/[^A-Za-z0-9]+/g, ''), key: false, annotations: '', notes: str(r.validation) };
      });
    } else if (objType === 'RFC' || objType === 'Function Module') {
      const imp = rows(fs, { selection: 1, both: 1, input: 1 });
      d.importing = imp.map(function (r) { return { name: ('IV_' + ident(r, 27)), typing: 'TYPE', type: ref(r), optional: !r.mandatory, default: '', byValue: true, description: str(r.field) }; });
      d.exporting = out.map(function (r) { return { name: ('EV_' + ident(r, 27)), typing: 'TYPE', type: ref(r), byValue: true, description: str(r.field) }; });
    } else if (objType === 'Table') {
      d.fields = rows(fs, { stored: 1 }).map(function (r) { return { name: ident(r, 16), key: false, dataElement: '', dtype: '', length: '', decimals: '', domain: '', description: str(r.field) + (str(r.validation) ? ' – ' + str(r.validation) : ''), refField: '', checkTable: '' }; });
    }
    Object.keys(d).forEach(function (k) { if (Array.isArray(d[k]) && !d[k].length) delete d[k]; });
    return d;
  }

  /* Z<module prefix>_<KEYWORDS>; RICEFW id kept out of the name (it changes when items are re-ordered) */
  const STOP = /^(A|AN|THE|OF|FOR|TO|AND|OR|IN|ON|BY|WITH|PER|FROM|NEW|SIMPLE|REPORT|PROGRAM|LIST|ALL|SHOW|DISPLAY|CREATE|BUILD)$/;
  function proposeName(fs, item, objType) {
    const ns = APB.fsDraft && APB.fsDraft.namespaces ? APB.fsDraft.namespaces() : {};
    const mod = (fs.context && fs.context.module) || '';
    const prefix = ((ns[mod] || ns[''] || ['Z'])[0] || 'Z').toUpperCase();
    const words = up([str(item && item.description), str(fs.context && fs.context.title)].join(' ')).split(/[^A-Z0-9]+/).filter(function (w) { return w.length > 2 && !STOP.test(w); });
    const max = { Report: 30, Class: 30, CDS: 30, 'Fiori/UI5': 15, Table: 16 }[objType] || 30;
    let name = prefix + (prefix.length > 1 ? '_' : '');
    words.slice(0, 4).forEach(function (w) { if ((name + w).length <= max) name += (name.slice(-1) === '_' ? '' : '_') + w; });
    if (name.length <= prefix.length + 1) return '';
    if (objType === 'CDS') name = name.replace(/^Z/, 'ZI');
    return name.slice(0, max);
  }

  /* compact FS extract for "Complete the TS with Copilot" (plain text; the guard masks it on the way out) */
  const FS_TEXT_MAX = 12000;
  function fsText(fs, frIds) {
    const F = APB.fs;
    const out = [];
    const c = fs.context || {};
    const add = function (h, v) { if (str(v)) out.push(h + ':\n' + str(v)); };
    add('Title', c.title);
    add('Module', c.module);
    add('Business requirement', c.requirement);
    add('Type of change', c.changeType);
    const frs = ((fs.reqs && fs.reqs.frs) || []).map(function (f, i) { return { f: f, id: F.frId(i) }; })
      .filter(function (x) { return x.f && str(x.f.title) && (!frIds || !frIds.length || frIds.indexOf(x.id) >= 0); });
    if (frs.length) out.push('Functional requirements:\n' + frs.map(function (x) { return '- ' + x.id + ' ' + str(x.f.title) + (str(x.f.description) ? ': ' + str(x.f.description) : '') + (str(x.f.acceptance) ? ' | acceptance: ' + str(x.f.acceptance).replace(/\s*\n\s*/g, '; ') : ''); }).join('\n'));
    const list = function (h, l, f) { l = (l || []).filter(function (r) { return r && typeof r === 'object'; }).map(f).filter(Boolean); if (l.length) out.push(h + ':\n' + l.map(function (x) { return '- ' + x; }).join('\n')); };
    list('Business rules', fs.reqs && fs.reqs.rules, function (r) { return str(r.rule) && str(r.rule) + (str(r.outcome) ? ' → ' + str(r.outcome) : '') + (r.type ? ' (' + r.type + ')' : ''); });
    list('Data (business field | table-field | used for | mandatory | validation)', fs.reqs && fs.reqs.data, function (r) { return filled(r) && [str(r.field), ref(r) || '–', r.usage || '–', r.mandatory ? 'mandatory' : 'optional', str(r.validation)].join(' | '); });
    list('TO-BE process', fs.process && fs.process.toBe, function (r) { return str(r.step) && str(r.step) + (str(r.role) ? ' (' + str(r.role) + ')' : '') + (str(r.tx) ? ' [' + str(r.tx) + ']' : ''); });
    list('Outputs', fs.solution && fs.solution.outputs, function (r) { return str(r.name) && str(r.name) + (r.type ? ' (' + r.type + ')' : '') + (str(r.trigger) ? ' – ' + str(r.trigger) : ''); });
    list('Interfaces', fs.solution && fs.solution.interfaces, function (r) { return str(r.name) && str(r.name) + (r.direction ? ' (' + r.direction + ')' : '') + (str(r.partner) ? ' with ' + str(r.partner) : ''); });
    list('Roles and authorizations', fs.solution && fs.solution.roles, function (r) { return str(r.role) && str(r.role) + (str(r.authObj) ? ' – ' + str(r.authObj) : '') + (str(r.scope) ? ' (' + str(r.scope) + ')' : ''); });
    const q = fs.quality || {};
    add('Performance', q.performance); add('Data volumes', q.volume); add('Data privacy', q.privacy);
    add('Current logic (existing objects)', fs.process && fs.process.currentLogic);
    const text = out.join('\n\n');
    return text.length > FS_TEXT_MAX ? text.slice(0, FS_TEXT_MAX) + '\n…' : text;
  }

  /* SAP names the FS itself uses (tables, fields as TABLE-FIELD, objects) – the grounding list for ts-draft */
  function fsNames(fs) {
    const names = {};
    ((fs.reqs && fs.reqs.data) || []).forEach(function (r) {
      if (!r) return;
      if (up(r.table)) names[up(r.table)] = 1;
      if (up(r.sapField)) names[up(r.sapField)] = 1;
      if (ref(r)) names[ref(r)] = 1;
    });
    ((fs.context && fs.context.objects) || []).forEach(function (o) { if (o && up(o.name)) names[up(o.name)] = 1; });
    ((fs.solution && fs.solution.roles) || []).forEach(function (o) { if (o && up(o.authObj)) names[up(o.authObj)] = 1; });
    return Object.keys(names);
  }

  APB.fsToTs = { designer: designer, proposeName: proposeName, fsText: fsText, fsNames: fsNames, reportOutput: reportOutput, FS_TEXT_MAX: FS_TEXT_MAX };
})(window.APB = window.APB || {});
