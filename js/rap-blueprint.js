/* RAP readiness checks and implementation blueprint for the development spec.
   Most RAP rework comes from structure the agent has to guess: behavior pool syntax, ETag / admin fields,
   draft table, draft actions, artifact names and activation order. This module derives all of that from
   the RAP designer (and the Table / CDS objects it references), so the agent only writes method bodies.
   Proposed names are marked as proposals; nothing here invents business logic. */
(function (APB) {
  'use strict';
  const D = APB.defs, V = APB.validation;
  const TBC = '[TO BE CONFIRMED]';

  /* Standard RAP admin fields: table field, data element, CDS element, annotation. */
  const ADMIN = [
    { field: 'CREATED_BY', de: 'ABP_CREATION_USER', el: 'CreatedBy', ann: '@Semantics.user.createdBy: true' },
    { field: 'CREATED_AT', de: 'ABP_CREATION_TSTMPL', el: 'CreatedAt', ann: '@Semantics.systemDateTime.createdAt: true' },
    { field: 'LAST_CHANGED_BY', de: 'ABP_LASTCHANGE_USER', el: 'LastChangedBy', ann: '@Semantics.user.lastChangedBy: true' },
    { field: 'LAST_CHANGED_AT', de: 'ABP_LASTCHANGE_TSTMPL', el: 'LastChangedAt', ann: '@Semantics.systemDateTime.lastChangedAt: true' },
    { field: 'LOCAL_LAST_CHANGED_AT', de: 'ABP_LOCINST_LASTCHANGE_TSTMPL', el: 'LocalLastChangedAt', ann: '@Semantics.systemDateTime.localInstanceLastChangedAt: true' }
  ];
  const TOTAL_ETAG_DE = 'ABP_LASTCHANGE_TSTMPL', ETAG_DE = 'ABP_LOCINST_LASTCHANGE_TSTMPL';

  function up(v) { return String(v || '').trim().toUpperCase(); }
  function rows(a) { return (Array.isArray(a) ? a : []).filter(V.isFilled); }
  function rapObjects(s) { return s.objects.filter(function (o) { return o.type === 'RAP' && D.hasBuilder(o); }); }
  function find(s, type, name) { const n = up(name); return n ? s.objects.filter(function (o) { return o.type === type && up(o.name) === n; })[0] || null : null; }
  function draft(o) { return (o.detail.options || []).indexOf('with draft') >= 0; }
  function strict(o) { return (o.detail.options || []).indexOf('strict ( 2 )') >= 0; }
  function entities(o) { return rows(o.detail.entities); }
  function root(o) { return entities(o).filter(function (e) { return e.role === 'root'; })[0] || entities(o)[0] || null; }
  function has(e, m) { return (e.masters || []).indexOf(m) >= 0; }

  /* Everything known about one entity: its CDS and table objects, elements, key, admin fields. */
  function entityInfo(s, e) {
    const cds = find(s, 'CDS', e.name), table = find(s, 'Table', e.table);
    const fields = table ? rows(table.detail.fields) : [];
    const els = cds ? rows(cds.detail.elements) : [];
    const deOf = function (el) { const f = fields.filter(function (x) { return up(x.name) === up(el.expression); })[0]; return f ? up(f.dataElement) : ''; };
    const elByDe = function (de) { const el = els.filter(function (x) { return deOf(x) === de; })[0]; return el ? el.alias || el.expression : ''; };
    const keyEl = els.filter(function (x) { return x.key; })[0] || null;
    return {
      cds: cds, table: table, fields: fields, els: els,
      alias: (e.alias || '').trim() || (e.name || 'Entity').replace(/^Z[A-Z]?_/i, '').replace(/_/g, ''),
      key: keyEl ? keyEl.alias || keyEl.expression : '',
      managedKey: !!(keyEl && deOf(keyEl) === 'SYSUUID_X16'),
      totalEtag: elByDe(TOTAL_ETAG_DE),
      admin: ADMIN.map(function (a) { return { a: a, inTable: fields.some(function (f) { return up(f.dataElement) === a.de; }), el: elByDe(a.de) }; }),
      hasEl: function (name) { return els.some(function (x) { return up(x.alias || x.expression) === up(name); }); }
    };
  }

  /* Proposed names (SAP RAP naming): ZR_ → ZC_ projection, ZBP_ behavior pool, ZUI_ service, _O4 binding. */
  function names(o) {
    const r = root(o) || {};
    const rn = (r.name || o.name || '').trim();
    const base = rn.replace(/^Z[RI]_/i, '');
    const proj = (o.detail.projection || '').trim() || (/^Z[RI]_/i.test(rn) ? 'ZC_' + base : '');
    const sd = (o.detail.serviceDefinition || '').trim() || (base ? 'ZUI_' + up(base) : '');
    const bindKind = o.detail.binding || '';
    const suffix = /V2/.test(bindKind) ? '_O2' : '_O4';
    return {
      root: rn, projection: proj, projected: !(o.detail.projection || '').trim() && !!proj,
      pool: (o.detail.implClass || '').trim() || (rn ? 'ZBP_' + up(rn.replace(/^Z/i, '')) : ''), poolProposed: !(o.detail.implClass || '').trim(),
      service: sd, serviceProposed: !(o.detail.serviceDefinition || '').trim(),
      binding: sd ? sd + suffix + (/Web API/.test(bindKind) ? '_API' : '') : '',
      draftTable: function (e) { return (e.draftTable || '').trim() || (e.table ? up(e.table) + '_D' : ''); }
    };
  }

  /* ------------------------------------------------------------------ checks */
  /* → [{ level: 'error' | 'warn', text, fix?, i? }] (i = index of the RAP object in s.objects) */
  function checks(s) {
    const out = [];
    rapObjects(s).forEach(function (o) {
      const i = s.objects.indexOf(o), label = 'RAP ' + (o.name || TBC);
      const push = function (level, text, fix) { out.push({ level: level, text: label + ': ' + text, fix: fix, i: i }); };
      const list = entities(o);
      if (!list.length) { push('error', 'no BO entities defined – add the root entity.'); return; }
      const roots = list.filter(function (e) { return e.role === 'root'; });
      if (roots.length !== 1) push('error', 'exactly one entity must have the role root (found ' + roots.length + ').');
      const managed = /^managed/.test(o.detail.implementation || '');
      const n = names(o);
      if (n.poolProposed) push('warn', 'behavior pool not named – the blueprint proposes ' + (n.pool || TBC) + '.');
      list.forEach(function (e) {
        const info = entityInfo(s, e), en = (e.name || TBC) + (e.alias ? ' (' + e.alias + ')' : '');
        const isRoot = e.role === 'root';
        if (!(e.name || '').trim()) push('error', 'an entity has no CDS name.');
        if (!isRoot && !(e.parent || '').trim()) push('error', en + ' has no parent entity.');
        if (managed && !(e.table || '').trim()) push('error', en + ': persistent table missing (required for managed).');
        if (e.name && !info.cds) push('warn', en + ': CDS view entity ' + e.name + ' is not in the object list – add it so its elements can be checked.');
        if (e.table && !info.table) push('warn', en + ': table ' + e.table + ' is not in the object list.');
        if (isRoot && managed && !has(e, 'lock master')) push('error', en + ': managed root entities need “lock master”.');
        if (!isRoot && !has(e, 'lock dependent')) push('warn', en + ': child entities normally use “lock dependent”.');
        if (isRoot && strict(o) && !has(e, 'authorization master (instance)') && !has(e, 'authorization master (global)')) push('error', en + ': strict ( 2 ) needs an authorization master (instance or global).');
        if (has(e, 'etag master') && !(e.etag || '').trim()) push('error', en + ': “etag master” is set but the ETag field is empty (normally LocalLastChangedAt).');
        if ((e.etag || '').trim() && info.cds && !info.hasEl(e.etag)) push('error', en + ': ETag field ' + e.etag.trim() + ' is not an element of ' + info.cds.name + ' – activation of the behavior definition fails.', 'admin-fields');
        if (isRoot && draft(o) && !info.totalEtag) push('error', en + ': with draft, the root needs a total ETag (LastChangedAt, data element ' + TOTAL_ETAG_DE + ') in the table and the CDS view.', 'admin-fields');
        if (draft(o) && !(e.draftTable || '').trim()) push('warn', en + ': draft table not named – the blueprint proposes ' + (n.draftTable(e) || TBC) + '.', 'draft-table');
        if (draft(o) && e.draftTable && !find(s, 'Table', e.draftTable)) push('warn', en + ': draft table ' + e.draftTable + ' is not in the object list.', 'draft-table');
        if (info.table) {
          const missing = info.admin.filter(function (x) { return !x.inTable; }).map(function (x) { return x.a.field; });
          if (missing.length) push('warn', en + ': table ' + info.table.name + ' lacks the RAP admin fields ' + missing.join(', ') + '.', 'admin-fields');
          const notInCds = info.admin.filter(function (x) { return x.inTable && !x.el; }).map(function (x) { return x.a.el; });
          if (info.cds && notInCds.length) push('warn', en + ': CDS ' + info.cds.name + ' does not expose ' + notInCds.join(', ') + '.', 'admin-fields');
        }
        if (info.cds && !info.key) push('error', en + ': no key element marked in CDS ' + info.cds.name + '.');
        rows(e.validations).concat(rows(e.determinations)).concat(rows(e.actions)).forEach(function (r) { if (!(r.name || '').trim()) push('error', en + ': a validation, determination or action has no name.'); });
        rows(e.validations).forEach(function (v) { if (!(v.trigger || '').trim()) push('warn', en + ': validation ' + v.name + ' has no trigger (e.g. { create; field X; }).'); });
      });
      if (!n.projection) push('warn', 'projection layer (ZC_) not named.');
      if (!(o.detail.serviceDefinition || '').trim()) push('warn', 'service definition not named – the blueprint proposes ' + (n.service || TBC) + '.');
      if (!o.detail.binding) push('warn', 'service binding type (e.g. OData V4 – UI) not chosen.');
    });
    return out;
  }

  /* -------------------------------------------------------------- quick fixes */
  function fix(s, i, kind) {
    const o = s.objects[i];
    if (!o || o.type !== 'RAP') return 0;
    let added = 0;
    entities(o).forEach(function (e) {
      if (kind === 'admin-fields') {
        const t = find(s, 'Table', e.table), c = find(s, 'CDS', e.name);
        if (t) {
          t.detail.fields = rows(t.detail.fields);
          ADMIN.forEach(function (a) { if (!t.detail.fields.some(function (f) { return up(f.dataElement) === a.de || up(f.name) === a.field; })) { t.detail.fields.push({ name: a.field, dataElement: a.de }); added++; } });
        }
        if (c) {
          c.detail.elements = rows(c.detail.elements);
          ADMIN.forEach(function (a) { if (!c.detail.elements.some(function (x) { return up(x.alias) === up(a.el) || up(x.expression) === a.field; })) { c.detail.elements.push({ expression: a.field.toLowerCase(), alias: a.el, annotations: a.ann }); added++; } });
        }
        if (has(e, 'etag master') && !(e.etag || '').trim()) { e.etag = 'LocalLastChangedAt'; added++; }
      } else if (kind === 'draft-table' && draft(o)) {
        const name = names(o).draftTable(e);
        if (!name) return;
        if (!(e.draftTable || '').trim()) { e.draftTable = name; added++; }
        if (!find(s, 'Table', name)) {
          s.objects.push({ id: APB.state.uid(), type: 'Table', name: name, status: 'new', purpose: 'Draft table of ' + (e.name || 'the BO') + ' (generate from the BDEF)', parent: '', detail: { description: 'Draft table ' + (e.alias || e.name || '') } });
          added++;
        }
      }
    });
    return added;
  }

  /* Draft tables are generated from the behavior definition: never ask for their field list. */
  function isDraftTable(s, t) {
    if (t.type !== 'Table') return false;
    const drafts = rapObjects(s).filter(draft);
    return drafts.some(function (o) { return entities(o).some(function (e) { return up(t.name) && up(e.draftTable) === up(t.name); }); }) ||
      (drafts.length > 0 && /^draft table/i.test(t.purpose || '')); // e.g. from the RAP template, before it is named
  }

  /* ---------------------------------------------------------------- blueprint */
  function code(lines) { return '```abap\n' + lines.filter(function (l) { return l !== null; }).join('\n') + '\n```'; }
  function trig(t) { t = (t || '').trim(); return t ? (/^\{/.test(t) ? t : '{ ' + t.replace(/;?$/, ';') + ' }') : '{ create; }'; }
  function lc(v) { return String(v || '').trim().toLowerCase(); }

  function childAssoc(s, parentE, childE) {
    const c = find(s, 'CDS', parentE.name);
    const r = c && rows(c.detail.associations).filter(function (a) { return a.kind === 'composition' && up(a.target) === up(childE.name); })[0];
    return r && r.name ? r.name : '_' + (childE.alias || 'Child') + ' /* composition name in the CDS view */';
  }
  function parentAssoc(s, childE) {
    const c = find(s, 'CDS', childE.name);
    const r = c && rows(c.detail.associations).filter(function (a) { return a.kind === 'association to parent'; })[0];
    return r && r.name ? r.name : '_Parent /* association to parent in the CDS view */';
  }

  function bdef(s, o) {
    const n = names(o), d = draft(o), list = entities(o);
    const impl = o.detail.implementation || 'managed';
    const L = [impl + (n.pool ? ' implementation in class ' + lc(n.pool) + ' unique' : '') + ';'];
    if (strict(o)) L.push('strict ( 2 );');
    if (d) L.push('with draft;');
    if ((o.detail.options || []).indexOf('extensible') >= 0) L.push('extensible;');
    list.forEach(function (e) {
      const info = entityInfo(s, e), isRoot = e.role === 'root';
      L.push('', 'define behavior for ' + (e.name || TBC) + ' alias ' + info.alias);
      if (e.table) L.push('persistent table ' + lc(e.table));
      if (d) L.push('draft table ' + lc(n.draftTable(e)));
      if (has(e, 'early numbering')) L.push('early numbering');
      if (has(e, 'late numbering')) L.push('late numbering');
      if (isRoot) L.push('lock master' + (d ? ' total etag ' + (info.totalEtag || 'LastChangedAt') : ''));
      else L.push('lock dependent by ' + parentAssoc(s, e));
      if (has(e, 'authorization master (instance)') && has(e, 'authorization master (global)')) L.push('authorization master ( global, instance )');
      else if (has(e, 'authorization master (instance)')) L.push('authorization master ( instance )');
      else if (has(e, 'authorization master (global)')) L.push('authorization master ( global )');
      else if (!isRoot) L.push('authorization dependent by ' + parentAssoc(s, e));
      if ((e.etag || '').trim()) L.push('etag master ' + e.etag.trim());
      L.push('{');
      const ops = e.operations || [];
      if (isRoot && ops.indexOf('create') >= 0) L.push('  create;');
      if (ops.indexOf('update') >= 0) L.push('  update;');
      if (ops.indexOf('delete') >= 0) L.push('  delete;');
      const ro = [];
      if (info.key) L.push('  field ( ' + (info.managedKey ? 'numbering : managed, ' : '') + 'readonly ) ' + info.key + ';');
      info.admin.forEach(function (x) { if (x.el) ro.push(x.el); });
      if (ro.length) L.push('  field ( readonly ) ' + ro.join(', ') + ';');
      APB.markdown.helpers.splitLines(e.fieldControl).forEach(function (l) { L.push('  ' + l.replace(/;?$/, ';')); });
      list.filter(function (c) { return (c.parent || '').trim() && up(c.parent) === up(e.name); }).forEach(function (c) {
        L.push('  association ' + childAssoc(s, e, c) + ' { create;' + (d ? ' with draft;' : '') + ' }');
      });
      if (!isRoot) L.push('  association ' + parentAssoc(s, e) + (d ? ' { with draft; }' : ';'));
      rows(e.actions).forEach(function (a) {
        const kind = a.kind || 'action';
        L.push('  ' + kind + (a.featureControl ? ' ( features : instance )' : '') + ' ' + a.name + (a.parameter ? ' parameter ' + a.parameter : '') + (a.result ? ' result ' + a.result : '') + ';');
      });
      rows(e.determinations).forEach(function (x) { L.push('  determination ' + x.name + ' ' + (x.timing || 'on modify') + ' ' + trig(x.trigger)); });
      rows(e.validations).forEach(function (v) { L.push('  validation ' + v.name + ' on save ' + trig(v.trigger)); });
      if (d && isRoot) {
        const prep = rows(e.validations).map(function (v) { return 'validation ' + v.name + ';'; })
          .concat(rows(e.determinations).filter(function (x) { return x.timing === 'on save'; }).map(function (x) { return 'determination ' + x.name + ';'; }));
        L.push('', '  draft action Edit;', '  draft action Activate optimized;', '  draft action Discard;', '  draft action Resume;',
          '  draft determine action Prepare' + (prep.length ? ' { ' + prep.join(' ') + ' }' : ';'));
      }
      if (e.table && info.els.length) {
        const map = info.els.filter(function (x) { return x.alias && x.expression && /^[a-z_0-9]+$/i.test(x.expression) && lc(x.alias) !== lc(x.expression); });
        if (map.length) {
          L.push('', '  mapping for ' + lc(e.table) + ' corresponding', '  {');
          map.forEach(function (x) { L.push('    ' + x.alias + ' = ' + lc(x.expression) + ';'); });
          L.push('  }');
        }
      }
      L.push('}');
    });
    return L;
  }

  function projectionBdef(s, o) {
    const n = names(o), d = draft(o), list = entities(o);
    const L = ['projection;'];
    if (strict(o)) L.push('strict ( 2 );');
    if (d) L.push('use draft;');
    list.forEach(function (e) {
      const info = entityInfo(s, e), isRoot = e.role === 'root';
      const pname = isRoot ? n.projection : (/^Z[RI]_/i.test(e.name || '') ? 'ZC_' + e.name.replace(/^Z[RI]_/i, '') : TBC);
      L.push('', 'define behavior for ' + (pname || TBC) + ' alias ' + info.alias, '{');
      const ops = e.operations || [];
      if (isRoot && ops.indexOf('create') >= 0) L.push('  use create;');
      if (ops.indexOf('update') >= 0) L.push('  use update;');
      if (ops.indexOf('delete') >= 0) L.push('  use delete;');
      rows(e.actions).filter(function (a) { return a.kind !== 'internal action'; }).forEach(function (a) { L.push('  use ' + (/function/.test(a.kind || '') ? 'function' : 'action') + ' ' + a.name + ';'); });
      if (d && isRoot) ['Edit', 'Activate', 'Discard', 'Resume', 'Prepare'].forEach(function (a) { L.push('  use action ' + a + ';'); });
      list.filter(function (c) { return (c.parent || '').trim() && up(c.parent) === up(e.name); }).forEach(function (c) {
        L.push('  use association ' + childAssoc(s, e, c).replace(/ \/\*.*\*\//, '') + ' { create;' + (d ? ' with draft;' : '') + ' }');
      });
      if (!isRoot) L.push('  use association ' + parentAssoc(s, e).replace(/ \/\*.*\*\//, '') + (d ? ' { with draft; }' : ';'));
      L.push('}');
    });
    return L;
  }

  function behaviorPool(s, o) {
    const n = names(o), r = root(o) || {};
    const L = ['" Global class – created as a behavior pool, NOT as a normal class', 'CLASS ' + lc(n.pool || TBC) + ' DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ' + lc(r.name || TBC) + '.', 'ENDCLASS.', '', 'CLASS ' + lc(n.pool || TBC) + ' IMPLEMENTATION.', 'ENDCLASS.', '', '" Local types (CCIMP) – one handler class per entity'];
    entities(o).forEach(function (e) {
      const info = entityInfo(s, e), A = info.alias, h = 'lhc_' + A.toLowerCase(), M = [];
      if (has(e, 'authorization master (instance)')) M.push('    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION', '      IMPORTING keys REQUEST requested_authorizations FOR ' + A + ' RESULT result.');
      if (has(e, 'authorization master (global)')) M.push('    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION', '      IMPORTING REQUEST requested_authorizations FOR ' + A + ' RESULT result.');
      if (rows(e.actions).some(function (a) { return a.featureControl; })) M.push('    METHODS get_instance_features FOR INSTANCE FEATURES', '      IMPORTING keys REQUEST requested_features FOR ' + A + ' RESULT result.');
      if (has(e, 'early numbering')) M.push('    METHODS earlynumbering_create FOR NUMBERING', '      IMPORTING entities FOR CREATE ' + A + '.');
      rows(e.determinations).forEach(function (x) { M.push('    METHODS ' + x.name + ' FOR DETERMINE ' + up(x.timing || 'on modify') + '', '      IMPORTING keys FOR ' + A + '~' + x.name + '.'); });
      rows(e.validations).forEach(function (v) { M.push('    METHODS ' + v.name + ' FOR VALIDATE ON SAVE', '      IMPORTING keys FOR ' + A + '~' + v.name + '.'); });
      rows(e.actions).forEach(function (a) {
        const fn = /function/.test(a.kind || '');
        M.push('    METHODS ' + a.name + ' FOR ' + (fn ? 'READ' : 'MODIFY'), '      IMPORTING keys FOR ' + (fn ? 'FUNCTION ' : 'ACTION ') + A + '~' + a.name + (a.result ? ' RESULT result' : '') + '.');
      });
      if (!M.length) return;
      const methods = M.filter(function (l) { return /^ {4}METHODS /.test(l); }).map(function (l) { return l.trim().split(/\s+/)[1]; });
      L.push('', 'CLASS ' + h + ' DEFINITION INHERITING FROM cl_abap_behavior_handler.', '  PRIVATE SECTION.');
      M.forEach(function (l) { L.push(l); });
      L.push('ENDCLASS.', '', 'CLASS ' + h + ' IMPLEMENTATION.');
      methods.forEach(function (m) { L.push('  METHOD ' + m + '.', '    " TODO: implement – read with READ ENTITIES OF ' + lc(r.name) + ' IN LOCAL MODE, change with MODIFY ENTITIES', '  ENDMETHOD.'); });
      L.push('ENDCLASS.');
    });
    const impl = o.detail.implementation || '';
    if (/additional save|unmanaged/.test(impl)) {
      const sv = 'lsc_' + lc(r.name || 'bo');
      L.push('', 'CLASS ' + sv + ' DEFINITION INHERITING FROM cl_abap_behavior_saver.', '  PROTECTED SECTION.', '    METHODS save_modified REDEFINITION.', 'ENDCLASS.', '', 'CLASS ' + sv + ' IMPLEMENTATION.', '  METHOD save_modified.', '  ENDMETHOD.', 'ENDCLASS.');
    }
    return L;
  }

  function plan(s, o) {
    const n = names(o), d = draft(o), list = entities(o), T = APB.markdown.helpers.table;
    const R = [];
    const add = function (g, art, name, adt, note) { R.push([g, art, name || TBC, adt, note || '']); };
    list.forEach(function (e) { add('1 · Dictionary', 'Persistent table' + (e.role === 'root' ? '' : ' (' + (e.alias || e.name) + ')'), e.table, 'Table', ''); });
    if (d) list.forEach(function (e) { add('1 · Dictionary', 'Draft table', n.draftTable(e), 'Table', 'Generate from the BDEF (quick fix) – fields = CDS element names + "%admin"'); });
    list.forEach(function (e) { add('2 · Data model', (e.role === 'root' ? 'Root' : 'Child') + ' view entity', e.name, 'Data Definition', ''); });
    list.forEach(function (e) {
      const p = e.role === 'root' ? n.projection : (/^Z[RI]_/i.test(e.name || '') ? 'ZC_' + e.name.replace(/^Z[RI]_/i, '') : '');
      add('2 · Data model', 'Projection view', p, 'Data Definition', 'as projection on ' + (e.name || TBC) + (e.role === 'root' && n.projected ? ' (proposed name)' : ''));
    });
    const cdsRoot = find(s, 'CDS', (root(o) || {}).name);
    if (cdsRoot && /CHECK|MANDATORY/.test(cdsRoot.detail.accessControl || '')) add('2 · Data model', 'Access control', (root(o) || {}).name + ' / ' + (n.projection || TBC), 'Access Control', '@AccessControl.authorizationCheck ' + cdsRoot.detail.accessControl);
    if (/Fiori/.test(o.detail.ui || '')) add('2 · Data model', 'Metadata extension', n.projection, 'Metadata Extension', 'UI annotations for the projection');
    add('3 · Behavior', 'Behavior definition (interface)', (root(o) || {}).name, 'Behavior Definition', 'activate together with the behavior pool');
    add('3 · Behavior', 'Behavior definition (projection)', n.projection, 'Behavior Definition', '');
    add('3 · Behavior', 'Behavior pool', n.pool + (n.poolProposed ? ' (proposed)' : ''), 'ABAP Class', 'FOR BEHAVIOR OF · handlers in local types · ABAP Unit in test include');
    add('4 · Service', 'Service definition', n.service + (n.serviceProposed ? ' (proposed)' : ''), 'Service Definition', 'expose ' + (n.projection || TBC));
    add('4 · Service', 'Service binding', n.binding + ' (proposed)', 'Service Binding', (o.detail.binding || TBC) + ' · publish after activation');
    if (/Fiori/.test(o.detail.ui || '')) add('5 · UI', 'Fiori elements app', '', 'BAS / generator', o.detail.ui);
    return T(['Group', 'Artifact', 'Name', 'ADT object', 'Notes'], R.map(function (r) { return r.map(function (c) { return APB.markdown.helpers.clean(c) || '–'; }); }));
  }

  function adminTable(s, o) {
    const r = root(o);
    if (!r) return '';
    const info = entityInfo(s, r);
    return APB.markdown.helpers.table(['Table field', 'Data element', 'CDS element', 'Annotation', 'Status'], ADMIN.map(function (a) {
      const x = info.admin.filter(function (y) { return y.a === a; })[0];
      return [a.field, a.de, x.el || a.el, '`' + a.ann + '`', x.inTable && x.el ? '✓' : TBC];
    }));
  }

  /* Markdown section; '' when there is no RAP object with a designer. */
  function markdown(s) {
    return rapObjects(s).map(function (o) {
      if (!entities(o).length) return '';
      const parts = ['### RAP ' + (o.name || TBC) + ' – artifacts and activation order',
        'Create the artifacts of one group, then **activate the whole group in one activation**. Interdependent objects (behavior definition and behavior pool; root and projection views) do not activate one by one.',
        plan(s, o),
        '#### Admin fields (root entity)', adminTable(s, o),
        '#### Behavior definition – interface', code(bdef(s, o)),
        '#### Behavior definition – projection', code(projectionBdef(s, o)),
        '#### Behavior pool skeleton', code(behaviorPool(s, o))];
      if (draft(o)) parts.push('#### Draft table', '- Generate it with the ADT quick fix on the `draft table` line of the behavior definition.\n- If created manually: one field per **CDS element name** of the entity (not the persistent table names) plus `"%admin" : include sych_bdl_draft_admin_inc;`.\n- Never add business fields to the draft table that are not elements of the CDS entity.');
      const open = checks(s).filter(function (c) { return s.objects[c.i] === o; });
      if (open.length) parts.push('#### Readiness findings', open.map(function (c) { return '- ' + (c.level === 'error' ? '**Fix before build:** ' : '') + c.text.replace(/^RAP [^:]+: /, ''); }).join('\n'));
      return parts.join('\n\n');
    }).filter(Boolean).join('\n\n');
  }

  function instructions(s) {
    if (!rapObjects(s).length) return [];
    return [
      'For RAP, build from the RAP Implementation Blueprint: keep its artifact names, behavior definition statements and handler method signatures; implement only the method bodies and the items marked ' + TBC + '.',
      'Work group by group (Dictionary → Data model → Behavior → Service): create all objects of a group, then activate the whole group in one activation through the ADT MCP server. Never activate interdependent RAP objects one at a time.',
      'Create the behavior pool as CLASS … DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF <root entity>, with the handler classes (INHERITING FROM cl_abap_behavior_handler) in its local types – never as a normal class.',
      'Generate the draft table from the behavior definition (ADT quick fix) or with field names equal to the CDS element names plus "%admin" : include sych_bdl_draft_admin_inc.',
      'Activate yourself after each group and report the result; ask the user only at the end of a group, not for every object.',
      'On activation errors, read the complete error list of the group and fix all errors in one pass. After 3 unsuccessful rounds, stop and report the remaining errors with your analysis instead of retrying.',
      'Publish the service binding only after the behavior group activates without errors.'
    ];
  }

  APB.rap = { checks: checks, fix: fix, isDraftTable: isDraftTable, markdown: markdown, instructions: instructions, names: names, ADMIN: ADMIN };
})(window.APB = window.APB || {});
