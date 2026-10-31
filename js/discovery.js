/* System discovery for functional specs. The browser never talks to SAP: the read-only Copilot agent
   dewa-fs-discovery reads the DEWA system through the ABAP ADT / Fiori / UI5 / CAP MCP servers and returns a
   "context pack" (JSON). This module builds the agent prompt, validates the pack and cross-checks the FS
   against it. Pack content is untrusted data: it is size-limited here and escaped wherever it is shown. */
(function (APB) {
  'use strict';
  const F = APB.fs;
  const cfg = F.cfg.discovery;
  const MAX_ITEMS = 500, MAX_LEN = 300;

  function s(v) { return typeof v === 'string' ? v.trim().slice(0, MAX_LEN) : (typeof v === 'number' ? String(v) : ''); }
  function list(v, map) {
    return (Array.isArray(v) ? v : []).slice(0, MAX_ITEMS).map(map).filter(function (x) { return x && Object.keys(x).some(function (k) { return x[k] !== '' && x[k] !== false; }); });
  }
  function pick(o, keys) { for (let i = 0; i < keys.length; i++) { const v = s(o && o[keys[i]]); if (v) return v; } return ''; }
  function bool(v) { return v === true || v === 'true' || v === 'X' || v === 'yes'; }

  /* Lenient about field names (agents vary), strict about types. Returns { pack, errors, warnings }. */
  function normalize(raw) {
    const errors = [], warnings = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { pack: null, errors: ['The context pack is not a JSON object.'], warnings: warnings };
    if (raw.kind !== cfg.packKind) errors.push('This is not a DEWA SAP context pack (expected "kind": "' + cfg.packKind + '").');
    if (Number(raw.version) !== cfg.packVersion) errors.push('Unsupported context pack version ' + s(String(raw.version)) + ' (expected ' + cfg.packVersion + ').');
    if (errors.length) return { pack: null, errors: errors, warnings: warnings };
    const sys = raw.system && typeof raw.system === 'object' ? raw.system : {};
    const pack = {
      kind: cfg.packKind,
      version: cfg.packVersion,
      sample: raw.sample === true,
      generatedAt: s(raw.generatedAt),
      system: { sid: s(sys.sid), client: s(sys.client), release: s(sys.release), components: list(sys.components, function (c) { return typeof c === 'string' ? { name: s(c) } : { name: pick(c, ['name', 'component']), release: pick(c, ['release', 'version']) }; }) },
      objects: list(raw.objects, function (o) { return { type: pick(o, ['type', 'objectType']).toUpperCase(), name: pick(o, ['name']).toUpperCase(), description: pick(o, ['description', 'text']), package: pick(o, ['package', 'devclass']).toUpperCase(), origin: /^(custom|standard)$/.test(s(o && o.origin)) ? s(o.origin) : (/^[ZY]|^\//i.test(pick(o, ['name'])) ? 'custom' : 'standard'), released: bool(o && o.released) }; }),
      transactions: list(raw.transactions, function (t) { return typeof t === 'string' ? { code: s(t).toUpperCase(), description: '' } : { code: pick(t, ['code', 'tcode', 'name']).toUpperCase(), description: pick(t, ['description', 'text']) }; }),
      fioriApps: list(raw.fioriApps, function (a) { return { appId: pick(a, ['appId', 'id']).toUpperCase(), title: pick(a, ['title', 'name']), semanticObject: pick(a, ['semanticObject']), action: pick(a, ['action']), odataService: pick(a, ['odataService', 'service']) }; }),
      ui5Apps: list(raw.ui5Apps, function (a) { return { name: pick(a, ['name', 'bspApp', 'id']).toUpperCase(), description: pick(a, ['description', 'title']) }; }),
      capServices: list(raw.capServices, function (c) { return { name: pick(c, ['name', 'service']), description: pick(c, ['description']), entities: (Array.isArray(c && c.entities) ? c.entities : []).slice(0, 50).map(s).filter(Boolean).join(', ') }; }),
      enhancements: list(raw.enhancements, function (e) { return { type: pick(e, ['type']), name: pick(e, ['name']).toUpperCase(), description: pick(e, ['description']), implemented: bool(e && e.implemented) }; }),
      customizingHints: list(raw.customizingHints, function (h) { return typeof h === 'string' ? { path: '', note: s(h) } : { path: pick(h, ['path', 'node']), note: pick(h, ['note', 'description']) }; }),
      notFound: list(raw.notFound, function (n) { return typeof n === 'string' ? { name: s(n).toUpperCase(), reason: '' } : { name: pick(n, ['name']).toUpperCase(), reason: pick(n, ['reason', 'note']) }; }),
      // candidates per process step (asIs.N / toBe.N), found in the system by description
      stepMatches: list(raw.stepMatches, function (m) {
        return { step: pick(m, ['step', 'key']), candidates: (Array.isArray(m && m.candidates) ? m.candidates : []).slice(0, 5).map(function (c) {
          return { kind: /fiori|app/i.test(pick(c, ['kind', 'type'])) ? 'fioriApp' : 'transaction', id: pick(c, ['id', 'code', 'appId']).toUpperCase(), title: pick(c, ['title', 'description', 'text']) };
        }).filter(function (c) { return c.id; }) };
      }).filter(function (m) { return /^(asIs|toBe)\.\d+$/.test(m.step) && m.candidates.length; })
    };
    if (!pack.generatedAt || isNaN(Date.parse(pack.generatedAt))) warnings.push('The pack has no valid "generatedAt" date, so its age is unknown.');
    if (!pack.system.sid) warnings.push('The pack does not name the SAP system (system.sid).');
    if (!pack.objects.length && !pack.transactions.length && !pack.fioriApps.length) warnings.push('The pack contains no objects, transactions or Fiori apps.');
    if (pack.sample) warnings.push('This is a sample pack for demonstrations – it was not read from your system.');
    return { pack: pack, errors: errors, warnings: warnings };
  }

  /* Accepts the agent's whole answer: uses the last ```json block, else the outermost {...}. */
  function parse(text) {
    text = String(text || '');
    const blocks = [];
    text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, function (_, b) { blocks.push(b); return _; });
    let candidate = blocks.length ? blocks[blocks.length - 1] : '';
    if (!candidate) {
      const a = text.indexOf('{'), b = text.lastIndexOf('}');
      candidate = a >= 0 && b > a ? text.slice(a, b + 1) : '';
    }
    if (!candidate.trim()) return { pack: null, errors: ['No JSON found. Paste the agent\'s answer or just its ```json block.'], warnings: [] };
    let raw;
    try { raw = JSON.parse(candidate); } catch (e) { return { pack: null, errors: ['The JSON could not be read: ' + e.message], warnings: [] }; }
    return normalize(raw);
  }

  function ageDays(pack) {
    const t = Date.parse(pack && pack.generatedAt);
    return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }
  function isStale(pack) { const d = ageDays(pack); return d !== null && d > cfg.staleDays; }

  /* Upper-case name → what the pack says about it. */
  function index(pack) {
    const idx = {};
    function add(name, kind, label) { if (name && !idx[name]) idx[name] = { kind: kind, label: label }; }
    if (!pack) return idx;
    pack.objects.forEach(function (o) { add(o.name, 'object', (cfg.objectTypeMap[o.type] || o.type || 'Object') + (o.description ? ' – ' + o.description : '')); });
    pack.transactions.forEach(function (t) { add(t.code, 'transaction', 'Transaction' + (t.description ? ' – ' + t.description : '')); });
    pack.fioriApps.forEach(function (a) { add(a.appId, 'app', 'Fiori app' + (a.title ? ' – ' + a.title : '')); add((a.title || '').toUpperCase(), 'app', 'Fiori app ' + a.appId); });
    pack.ui5Apps.forEach(function (a) { add(a.name, 'app', 'UI5 app' + (a.description ? ' – ' + a.description : '')); });
    pack.enhancements.forEach(function (e) { add(e.name, 'enhancement', (e.type || 'Enhancement') + (e.implemented ? ' (implemented)' : '')); });
    pack.capServices.forEach(function (c) { add((c.name || '').toUpperCase(), 'cap', 'CAP service'); });
    return idx;
  }

  /* SAP-looking (upper-case) names inside free text: "MIRO / FB60" → MIRO, FB60; "BAdI FI_ITEMS_CH_DATA" → FI_ITEMS_CH_DATA;
     prose such as "Fiori app (new)" is ignored, /NAMESPACE/ names stay intact. */
  function names(text) {
    return String(text || '').split(/[\s,;]+/).map(function (t) { return t.replace(/[.):]+$/, ''); })
      .filter(function (t) { return /^[A-Za-z0-9_\/.-]{2,40}$/.test(t) && /[A-Z0-9]/.test(t) && !/^\d+$/.test(t) && t === t.toUpperCase(); })
      .map(function (t) { return t.toUpperCase(); });
  }

  /* Every SAP reference made in the FS, with where it was made. kind 'new' = proposed new object name. */
  function references(st) {
    const out = [];
    const proposed = {}; // names the FS introduces: RICEFW object names and transactions of TO-BE steps marked "new"
    const ids = F.ricefwIds(st.solution.ricefw);
    (st.solution.ricefw || []).forEach(function (r) { if (r) names(r.name).forEach(function (n) { proposed[n] = true; }); });
    (st.process.toBe || []).forEach(function (r) { if (r && r.change === 'new') names(r.tx).forEach(function (n) { proposed[n] = true; }); });
    function add(text, where) {
      names(text).forEach(function (n) { if (!out.some(function (r) { return r.name === n; })) out.push({ name: n, where: where, kind: proposed[n] ? 'new' : 'ref' }); });
    }
    (st.process.asIs || []).forEach(function (r, i) { add(r && r.tx, 'AS-IS step ' + (i + 1)); });
    (st.process.toBe || []).forEach(function (r, i) { add(r && r.tx, 'TO-BE step ' + (i + 1)); });
    (st.reqs.data || []).forEach(function (r) { if (r) add(r.table, 'data: ' + (r.field || r.table)); });
    (st.solution.ricefw || []).forEach(function (r, i) { if (!r) return; add(r.existing, ids[i]); add(r.name, ids[i]); });
    (st.solution.roles || []).forEach(function (r) { if (!r) return; add(r.tx, 'role ' + (r.role || '')); add(r.authObj, 'role ' + (r.role || '')); });
    return out;
  }

  /* status: verified | missing (agent reported not found) | unchecked | clash (proposed new name already exists) | free (new name not taken) */
  function crossCheck(st) {
    const pack = st.discovery;
    const idx = index(pack);
    const nf = {};
    (pack ? pack.notFound : []).forEach(function (n) { nf[n.name] = n.reason || 'not found'; });
    return references(st).map(function (r) {
      const hit = idx[r.name];
      let status;
      if (r.kind === 'new') status = hit ? 'clash' : (nf[r.name] ? 'free' : 'unchecked');
      else status = hit ? 'verified' : nf[r.name] ? 'missing' : 'unchecked';
      return { name: r.name, where: r.where, kind: r.kind, status: status, info: hit ? hit.label : (nf[r.name] || '') };
    });
  }

  /* ----------------------------------------------------------- agent prompt */
  function bulletLines(text) { return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); }

  function prompt(st) {
    const c = st.context;
    const refs = references(st);
    const pick2 = function (kind) { return refs.filter(function (r) { return r.kind === kind; }).map(function (r) { return r.name; }); };
    const org = [['Company codes', c.companyCodes], ['Plants', c.plants], ['Sales organisations', c.salesOrgs], ['Other', c.otherOrg]]
      .filter(function (o) { return (o[1] || '').trim(); }).map(function (o) { return o[0] + ': ' + o[1].trim(); });
    const frLines = (st.reqs.frs || []).map(function (f, i) { return f && (f.title || f.description) ? '- ' + F.frId(i) + ' ' + (f.title || '').trim() + (f.description ? ' – ' + f.description.trim().replace(/\s+/g, ' ') : '') : ''; }).filter(Boolean);
    const schema = {
      kind: cfg.packKind, version: cfg.packVersion, generatedAt: '<ISO-8601 timestamp>',
      system: { sid: '<SID>', client: '<client>', release: '<e.g. S/4HANA 2023 FPS02>', components: [{ name: '<e.g. S4CORE>', release: '<release>' }] },
      objects: [{ type: '<ADT type, e.g. TABL, DDLS, CLAS, FUGR, PROG, BDEF, SRVB>', name: '<NAME>', description: '', package: '', origin: 'standard|custom', released: true }],
      transactions: [{ code: '<TCODE>', description: '' }],
      fioriApps: [{ appId: '<e.g. F0712>', title: '', semanticObject: '', action: '', odataService: '' }],
      ui5Apps: [{ name: '<BSP application>', description: '' }],
      capServices: [{ name: '', description: '', entities: [] }],
      enhancements: [{ type: 'BAdI|Enhancement spot|User exit', name: '', description: '', implemented: false }],
      customizingHints: [{ path: '<SPRO path or view>', note: '' }],
      notFound: [{ name: '<NAME>', reason: '' }],
      stepMatches: [{ step: '<step key, e.g. toBe.1>', candidates: [{ kind: 'transaction|fioriApp', id: '<TCODE or app ID>', title: '' }] }]
    };
    const lines = [
      cfg.marker,
      'Use the ' + cfg.agent + ' agent: read-only SAP system discovery for a functional specification.',
      '',
      'Rules:',
      '- READ ONLY. Use only the ' + cfg.mcpServers.join(', ') + ' MCP servers. Never create, change, activate, lock or transport anything.',
      '- Never invent objects, apps or fields. Everything you checked but could not find goes into "notFound".',
      '- Prefer released APIs, CDS views and standard Fiori apps; mark custom (Z/Y, /namespace/) objects as origin "custom".',
      '',
      'Functional specification: ' + ((c.title || '').trim() || '(untitled)'),
      'Module: ' + (c.module || 'not set') + ((c.processArea || '').trim() ? ' · Process area: ' + c.processArea.trim() : '')
    ];
    if (org.length) lines.push('Org scope: ' + org.join(' · '));
    lines.push('', 'Business requirement:', (c.requirement || '').trim() || '(not provided)');
    if (frLines.length) lines.push('', 'Functional requirements:', frLines.join('\n'));
    const r = pick2('ref'), n = pick2('new');
    lines.push('', 'Check each of these references (exists? description, package, released?):', r.length ? '- ' + r.join(', ') : '- (none named yet)');
    if (n.length) lines.push('', 'Proposed NEW object names – report any that already exist:', '- ' + n.join(', '));
    const steps = processSteps(st).filter(function (p) { return !p.tx; });
    if (steps.length) {
      lines.push('', 'Process steps without a transaction or app – find up to 3 candidates per step in the system (standard and custom transactions by description, Fiori apps by title) and return them in "stepMatches" with the step key:');
      steps.forEach(function (p) { lines.push('- ' + p.key + ': ' + p.text + (p.role ? ' (role: ' + p.role + ')' : '')); });
    }
    lines.push('',
      'Also find, for this process area:',
      '- the system ID, client, release and main software components;',
      '- standard Fiori apps (app ID, OData service) and transactions that cover the process steps;',
      '- released CDS views / APIs and the main tables involved;',
      '- existing custom objects (Z/Y) in the same area that could be reused;',
      '- relevant BAdIs / enhancement spots and whether they are already implemented;',
      '- CAP services if the requirement involves BTP;',
      '- customizing (SPRO) nodes worth checking.',
      '',
      'Answer with a short summary, then exactly one fenced ```json block in this shape (leave lists empty when nothing applies):',
      '```json', JSON.stringify(schema, null, 1), '```');
    return lines.join('\n');
  }

  /* Steps of the AS-IS / TO-BE grids: { key: 'toBe.1', label: 'TO-BE 2', text, role, tx } */
  function processSteps(st) {
    const out = [];
    [['asIs', 'AS-IS'], ['toBe', 'TO-BE']].forEach(function (g) {
      (st.process[g[0]] || []).forEach(function (r, i) {
        if (r && (r.step || '').trim()) out.push({ key: g[0] + '.' + i, label: g[1] + ' ' + (i + 1), text: r.step.trim(), role: (r.role || '').trim(), tx: (r.tx || '').trim() });
      });
    });
    return out;
  }

  /* Built-in list of well-known standard transactions (config/sap-catalog.json) for the type-ahead. */
  const CATALOG = (APB.config.sapCatalog || { transactions: [] }).transactions;

  /* Type-ahead lists: value = technical name, label = description, so typing "invoice" finds MIRO. */
  function datalists(pack) {
    const tx = CATALOG.map(function (t) { return { v: t.code, l: t.text + ' · standard' }; });
    if (!pack) return { 'ds-tx': tx, 'ds-obj': [] };
    const sys = pack.transactions.map(function (t) { return { v: t.code, l: (t.description || 'Transaction') + ' · in system' }; })
      .concat(pack.fioriApps.map(function (a) { return { v: a.appId, l: (a.title || 'Fiori app') + ' · Fiori app in system' }; }))
      // matches discovery found for process steps described in business words
      .concat([].concat.apply([], pack.stepMatches.map(function (m) { return m.candidates; })).map(function (c) { return { v: c.id, l: (c.title || (c.kind === 'fioriApp' ? 'Fiori app' : 'Transaction')) + ' · in system' }; }));
    const seen = {};
    const list = sys.concat(tx).filter(function (x) { if (!x.v || seen[x.v]) return false; seen[x.v] = true; return true; });
    return {
      'ds-tx': list,
      'ds-obj': pack.objects.map(function (o) { return o.name; }).concat(pack.enhancements.map(function (e) { return e.name; })).filter(Boolean)
    };
  }

  /* VS Code launch target: the DEWA extension's URI handler, or plain VS Code (copy & paste). */
  function launchUrl(mode, extensionId) {
    return mode === 'plain' ? 'vscode://' : 'vscode://' + (extensionId || cfg.extensionId) + '/discover?src=clipboard&v=' + cfg.packVersion;
  }

  APB.discovery = { cfg: cfg, normalize: normalize, parse: parse, ageDays: ageDays, isStale: isStale, index: index, names: names, references: references, crossCheck: crossCheck, prompt: prompt, datalists: datalists, launchUrl: launchUrl, processSteps: processSteps };
})(window.APB = window.APB || {});
