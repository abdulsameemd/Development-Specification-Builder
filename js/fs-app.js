/* Functional-specification wizard. Rendering reuses the generic field renderers of app.js (exposed as APB.ui);
   this file only adds what is FS-specific: step layouts, discovery panel, UAT skeleton, hand-off to a
   development spec, and the FS flavour of hero, preview actions and command palette. */
(function (APB) {
  'use strict';
  const F = APB.fs, FC = APB.fsCompleteness, FM = APB.fsMarkdown, DS = APB.discovery, V = APB.validation, S = APB.state;

  function U() { return APB.ui; }
  function esc(t) { return U().esc(t); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Record titles: FR-01 … and per-type RICEFW ids (R-01, E-01 …) instead of "Item 1". */
  F.field('reqs', 'frs').labelFor = function (recs, i) { return F.frId(i); };
  F.field('solution', 'ricefw').labelFor = function (recs, i) { return F.ricefwIds(recs)[i]; };

  /* ------------------------------------------------------------------ chrome */
  const HERO = '<div class="hero-copy">' +
    '<p class="hero-badge"><span class="spark" aria-hidden="true">✦</span> Functional specs checked against your SAP system</p>' +
    '<h1 id="hero-title">SAP Functional <span class="grad">Specification Builder</span></h1>' +
    '<p class="hero-sub">From business requirement to a sign-off-ready FS for ' +
    '<span class="rotator" aria-hidden="true"><span id="rotator-text">FI-AP processes</span><span class="caret"></span></span><span class="sr-only">FI, MM, SD, IS-U and CRM processes</span></p>' +
    '<ul class="hero-chips" aria-label="Highlights"><li><strong>5</strong> steps · 15–30 min</li><li><strong>Word</strong> + Markdown</li><li><strong>Read-only</strong> SAP discovery via Copilot</li><li><strong>0</strong> data leaves your machine</li></ul></div>' +
    '<div class="hero-cta"><button type="button" class="btn btn-primary btn-lg" data-action="start">Start the FS <span aria-hidden="true">→</span></button>' +
    '<button type="button" class="btn btn-ghost btn-lg" data-action="examples">See an example</button></div>';

  const ROTATOR = ['FI-AP processes', 'MM procurement', 'SD order-to-cash', 'IS-U meter-to-cash', 'CRM customer service', 'Fiori app rollouts', 'RICEFW inventories'];

  const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/></svg>';
  const PV_ACTIONS = '<button type="button" class="btn btn-primary" data-action="fs-docx">' + DOWNLOAD_ICON + ' Word</button>' +
    '<button type="button" class="btn btn-ghost" data-action="download">Markdown</button>' +
    '<button type="button" class="btn btn-ghost" data-action="copy">Copy</button>';

  /* ------------------------------------------------------------ step helpers */
  function header(n) {
    const st = F.steps[n - 1];
    return '<h2 class="step-title">' + esc(st.title) + '</h2><p class="muted">' + esc(st.intro) + '</p>';
  }

  function fieldsOf(sectionId, ids, exclude) {
    return F.section(sectionId).fields.filter(function (f) { return ids ? ids.indexOf(f.id) >= 0 : (exclude || []).indexOf(f.id) < 0; });
  }

  function block(sectionId, ids, exclude, opts) {
    const s = S.get();
    return U().fieldsBlock(fieldsOf(sectionId, ids, exclude), s[sectionId], sectionId, opts);
  }

  function flowHtml(list) {
    list = (list || []).filter(function (r) { return r && (r.step || '').trim(); });
    if (!list.length) return '<p class="muted small">Add TO-BE steps to see the flow.</p>';
    return '<ol class="pipe fs-flow">' + list.map(function (r, i) {
      return '<li><span class="pipe-n">' + (i + 1) + '</span><span class="pipe-t">' + esc(r.step) +
        ((r.role || r.tx) ? '<small>' + esc([r.role, r.tx].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  /* ------------------------------------------------------------------- steps */
  function step1(s, ui) {
    const missing = ui.showErrors ? FC.checkMandatory(s).map(function (r) { return r.id; }) : [];
    const c = s.context;
    const mod = F.field('context', 'module');
    const tpls = F.templates.list().map(function (t) {
      return '<button type="button" class="chip" data-action="fs-template" data-id="' + esc(t.id) + '" title="' + esc(t.description) + '">' + esc(t.label) + '</button>';
    }).join('');
    return header(1) +
      '<div class="grid-2"><div class="field"><label for="fs-title">Specification title</label><input id="fs-title" type="text" data-bind="context.title" value="' + esc(c.title) + '" placeholder="' + esc(F.field('context', 'title').placeholder) + '"></div>' +
      '<div class="field"><label for="fs-module">Module <span class="req">required</span></label><select id="fs-module" data-bind="context.module"' + (missing.indexOf('module') >= 0 ? ' aria-invalid="true"' : '') + '>' +
      mod.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (c.module === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>' +
      (missing.indexOf('module') >= 0 ? '<p class="field-error" role="alert">Pick the module.</p>' : '') + '</div></div>' +
      '<div class="field"><label for="fs-req">Business requirement <span class="req">required</span></label>' +
      '<textarea id="fs-req" class="tall" rows="7" data-bind="context.requirement" placeholder="' + esc(F.field('context', 'requirement').placeholder) + '"' + (missing.indexOf('requirement') >= 0 ? ' aria-invalid="true" aria-describedby="fs-req-err"' : '') + '>' + esc(c.requirement) + '</textarea>' +
      (missing.indexOf('requirement') >= 0 ? '<p id="fs-req-err" class="field-error" role="alert">Describe the business need (a sentence or two is enough).</p>' : '') + '</div>' +
      block('context', null, ['title', 'module', 'requirement']) +
      '<details class="more"' + U().detailsAttrs('fs-templates', false) + '><summary>Start from a module template</summary><p class="muted small">Adds typical process steps, FR headings and roles for the module — only where you have not typed anything. Want a complete FS? <button type="button" class="link" data-action="examples">Load an example</button>.</p><div class="chips">' + tpls + '</div></details>' +
      U().nav(false, 'Continue');
  }

  /* Suggestions per step: from the SAP system (discovery stepMatches), else from the built-in standard list.
     A functional consultant describes the step; the technical name is picked, not remembered. */
  function stepSuggestions(s) {
    const open = DS.processSteps(s).filter(function (p) { return !p.tx; });
    const fromSystem = !!(s.discovery && s.discovery.stepMatches.length);
    const rowsHtml = open.map(function (p) {
      const c = DS.suggestions(s, p);
      return '<li><span class="sg-step"><b>' + esc(p.label) + '</b> ' + esc(p.text) + '</span><span class="chips">' +
        (c.length ? c.map(function (x) {
          return '<button type="button" class="chip sg-' + x.source + '" data-action="fs-pick-tx" data-key="' + esc(p.key) + '" data-v="' + esc(x.id) + '" title="' + esc(x.source === 'system' ? 'Found in the SAP system' : 'SAP standard – check with discovery') + '">' +
            esc(x.id) + ' <small>' + esc(x.title || '') + '</small></button>';
        }).join('') : '<span class="muted small">no suggestion yet</span>') + '</span></li>';
    }).join('');
    const btn = '<button type="button" class="btn btn-primary btn-sm" data-action="fs-suggest">✦ Suggest from SAP</button>';
    return '<section class="card fs-suggest" aria-labelledby="h-sg"><h3 id="h-sg">Transactions &amp; Fiori apps</h3>' +
      '<p class="muted small">Describe each step in business words – no technical names needed. <strong>Suggest from SAP</strong> asks discovery to find the matching transactions and Fiori apps in your system (read-only); until then, well-known SAP standard transactions are suggested. Click a suggestion to use it, or type in the cell to search by description.</p>' +
      (open.length ? '<ul class="sg-list">' + rowsHtml + '</ul>' : '<p class="muted small">Every step has a transaction or app.</p>') +
      '<div class="gen-actions">' + btn + (fromSystem ? '<span class="chk ok">✓ suggestions from ' + esc(s.discovery.system.sid || 'the system') + '</span>' : '<span class="muted small">Showing SAP standard suggestions</span>') + '</div></section>';
  }

  function step2(s) {
    const asIs = (s.process.asIs || []).filter(V.isFilled);
    const toBe = (s.process.toBe || []).filter(V.isFilled);
    return header(2) +
      block('process', ['asIs']) +
      (asIs.length && !toBe.length ? '<p><button type="button" class="btn btn-ghost btn-sm" data-action="fs-copy-asis">Start TO-BE from the AS-IS steps</button></p>' : '') +
      block('process', null, ['asIs']) +
      (asIs.length || toBe.length ? stepSuggestions(s) : '') +
      '<h3>TO-BE flow</h3>' + flowHtml(s.process.toBe) +
      U().nav(true, 'Continue');
  }

  function step3(s) {
    const c = FC.evaluate(s).counts;
    const summary = c.frs ? '<div class="fs-fit" aria-label="Fit-gap summary"><span><b>' + c.frs + '</b> FRs</span><span><b>' + c.must + '</b> must-have</span><span class="ok"><b>' + c.standard + '</b> standard / config</span><span class="gap"><b>' + c.gaps + '</b> gaps</span></div>' : '';
    return header(3) + summary + block('reqs') + U().nav(true, 'Continue');
  }

  function badge(status) {
    const map = { verified: ['ok', '✓ in system'], missing: ['bad', '✗ not found'], unchecked: ['', '– not checked'], clash: ['bad', '⚠ already exists'], free: ['ok', '✓ name free'] };
    const m = map[status] || map.unchecked;
    return '<span class="chk ' + m[0] + '">' + m[1] + '</span>';
  }

  /* ---------------------------------------------- discovery inside VS Code */
  const H = APB.host;
  const disc = { auth: null, running: false, mode: '', log: [], error: '' }; // runtime only, never saved

  function copilotStatus() {
    const a = disc.auth;
    if (!a) return '<span class="chip chip-static">Checking GitHub Copilot…</span>';
    if (!a.copilot) return '<span class="chip chip-static chk bad">GitHub Copilot Chat is not installed</span>';
    return a.signedIn
      ? '<span class="chip chip-static copilot-on">● GitHub Copilot · signed in as ' + esc(a.account || 'GitHub user') + '</span>'
      : '<span class="chip chip-static">GitHub Copilot · not signed in</span> <button type="button" class="btn btn-primary btn-sm" data-action="fs-signin">Sign in to GitHub Copilot</button>';
  }

  function logHtml() {
    if (!disc.log.length && !disc.error) return '';
    const icon = { running: '…', done: '✓', blocked: '⛔', error: '✗', info: '›' };
    return '<ol class="fs-log" aria-live="polite">' + disc.log.map(function (l) {
      return '<li class="' + esc(l.status || 'info') + '"><span aria-hidden="true">' + (icon[l.status] || '›') + '</span> ' + esc(l.text) + '</li>';
    }).join('') + (disc.error ? '<li class="error"><span aria-hidden="true">✗</span> ' + esc(disc.error) + '</li>' : '') + '</ol>';
  }

  function vscodeHow() {
    return '<div class="chips fs-copilot">' + copilotStatus() + '</div>' +
      '<ol class="ag-steps fs-how">' +
      '<li>Sign in to <strong>GitHub Copilot</strong> in VS Code (button above, or the Accounts menu).</li>' +
      '<li><strong>Discover automatically</strong> runs the read-only <code class="agent-name">' + esc(DS.cfg.agent) + '</code> instructions here, using only the read tools of the ' + esc(DS.cfg.mcpServers.join(', ')) + ' MCP servers. Or <strong>Run in Copilot Chat</strong> to watch and steer the agent beside this panel.</li>' +
      '<li>The result is imported into this FS automatically — nothing in SAP is changed.</li></ol>';
  }

  function vscodeActions(p) {
    const ready = disc.auth && disc.auth.copilot && disc.auth.signedIn;
    return '<div class="gen-actions">' +
      (disc.running
        ? '<button type="button" class="btn btn-ghost" data-action="fs-stop">Stop discovery</button><span class="muted small">' + (disc.mode === 'chat' ? 'Waiting for the agent in Copilot Chat…' : 'Reading the SAP system…') + '</span>'
        : '<button type="button" class="btn btn-primary" data-action="fs-auto"' + (ready ? '' : ' disabled') + '>✦ ' + (p ? 'Re-run discovery' : 'Discover automatically') + '</button>' +
          '<button type="button" class="btn btn-ghost" data-action="fs-chat"' + (ready ? '' : ' disabled') + '>Run in Copilot Chat</button>' +
          '<button type="button" class="btn btn-ghost" data-action="fs-import-clip">Import from clipboard</button>' +
          (p ? '<button type="button" class="btn btn-ghost" data-action="fs-clear-pack">Remove pack</button>' : '<button type="button" class="link small" data-action="fs-sample-pack">Try a sample pack</button>')) +
      '</div>' + logHtml();
  }

  function rerenderDiscovery() {
    if (S.isFs() && !U().ui.generated && U().ui.step === 4 && !U().ui.view) U().renderMain();
  }

  if (H.isVscode) {
    H.on('auth', function (m) { disc.auth = { signedIn: !!m.signedIn, account: String(m.account || ''), copilot: m.copilot !== false }; rerenderDiscovery(); });
    H.on('discovery-progress', function (m) {
      const text = String(m.text || '').slice(0, 300);
      const last = disc.log[disc.log.length - 1];
      if (m.key && last && last.key === m.key) { last.text = text; last.status = m.status; } else disc.log.push({ key: m.key, text: text, status: m.status });
      if (disc.log.length > 80) disc.log.shift();
      const el = document.querySelector('.fs-log');
      if (el) el.outerHTML = logHtml(); else rerenderDiscovery();
    });
    H.on('discovery-result', function (m) {
      disc.running = false;
      const answer = String(m.text || '');
      if (!importText(answer, disc.mode === 'chat' ? 'Copilot Chat' : 'Copilot')) {
        disc.error = 'The answer did not contain a valid context pack. The model\'s answer is shown below – fix or complete it and click Import pasted pack, try again (setting dewaSpecBuilder.model selects a stronger model), or run it in Copilot Chat.';
        U().ui.open['fs-paste'] = true;
        rerenderDiscovery();
        const ta = document.getElementById('fs-pack');
        if (ta) ta.value = answer;
      }
    });
    H.on('discovery-error', function (m) { disc.running = false; disc.error = String(m.message || 'Discovery failed').slice(0, 400); rerenderDiscovery(); });
    H.on('saved', function (m) { U().toast('Saved ' + String(m.path || ''), 5000); });
    H.post({ type: 'auth-status' });
  }

  function startDiscovery(mode) {
    const s = S.get();
    if (FC.checkMandatory(s).length) { U().toast('Add the business requirement and the module first (step 1)'); return; }
    disc.running = true; disc.mode = mode; disc.error = ''; disc.log = [];
    disc.log.push({ text: mode === 'chat' ? 'Opening Copilot Chat with ' + DS.cfg.agent + ' — press Enter there' : 'Starting read-only discovery with GitHub Copilot', status: 'info' });
    H.post({ type: 'discover', mode: mode, prompt: DS.prompt(s) });
    rerenderDiscovery();
  }

  function discoveryPanel(s) {
    const p = s.discovery;
    const launch = APB.storage.getPref('vscodeLaunch', 'extension');
    const ext = APB.storage.getPref('extensionId', DS.cfg.extensionId);
    const how = '<ol class="ag-steps fs-how">' +
      '<li><strong>Discover in SAP</strong> copies a read-only prompt and opens VS Code with the <code class="agent-name">' + esc(DS.cfg.agent) + '</code> agent.</li>' +
      '<li>Sign in to GitHub Copilot if VS Code asks, then press <kbd>Enter</kbd>. The agent reads the system through the ' + esc(DS.cfg.mcpServers.join(', ')) + ' MCP servers — nothing is changed.</li>' +
      '<li>Copy the agent\'s answer and click <strong>Import from clipboard</strong> (or paste it below).</li></ol>';
    const settings = '<details class="more"' + U().detailsAttrs('fs-launch', false) + '><summary>VS Code launch settings</summary>' +
      '<fieldset class="field"><legend>Open VS Code with</legend><div class="choices">' +
      '<label class="choice"><input type="radio" name="fs-launch" value="extension" data-action="fs-launch-mode"' + (launch !== 'plain' ? ' checked' : '') + '><span>DEWA extension (opens the agent with the prompt)</span></label>' +
      '<label class="choice"><input type="radio" name="fs-launch" value="plain" data-action="fs-launch-mode"' + (launch === 'plain' ? ' checked' : '') + '><span>Plain VS Code (copy &amp; paste)</span></label></div></fieldset>' +
      '<div class="field narrow"><label for="fs-ext">DEWA extension ID</label><input id="fs-ext" type="text" value="' + esc(ext) + '" data-pref="extensionId" spellcheck="false"><p class="field-hint">Publisher.name of DEWA\'s VS Code extension with the discovery add-on (see <code>vscode-extension-addon/INSTALL.md</code>). Remembered in this browser.</p></div></details>';
    const paste = '<details class="paste"' + U().detailsAttrs('fs-paste', false) + '><summary>Paste the agent\'s answer instead</summary>' +
      '<label for="fs-pack" class="small muted">The whole answer or only its ```json block.</label><textarea id="fs-pack" rows="6" spellcheck="false"></textarea>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="fs-import-paste">Import pasted pack</button></details>';
    const actions = '<div class="gen-actions">' +
      '<button type="button" class="btn btn-primary" data-action="fs-discover"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3 8 12l9 9 4-2V5z"/><path d="M8 12 3 8m5 4-5 4"/></svg> ' + (p ? 'Re-run discovery' : 'Discover in SAP') + '</button>' +
      '<button type="button" class="btn btn-ghost" data-action="fs-import-clip">Import from clipboard</button>' +
      '<button type="button" class="btn btn-ghost" data-action="fs-copy-prompt">Copy prompt only</button>' +
      (p ? '<button type="button" class="btn btn-ghost" data-action="fs-clear-pack">Remove pack</button>' : '<button type="button" class="link small" data-action="fs-sample-pack">Try a sample pack</button>') + '</div>';
    let body;
    if (!p) {
      body = '<p class="muted">Read what already exists in the DEWA SAP system — tables, CDS views, transactions, Fiori apps, BAdIs, CAP services — so the FS is written against the real system, not from memory.</p>' + (H.isVscode ? vscodeHow() : how);
    } else {
      const age = DS.ageDays(p);
      const sys = p.system;
      const chips = [sys.sid && 'System ' + sys.sid + (sys.client ? ' / ' + sys.client : ''), sys.release, p.generatedAt && 'Read ' + p.generatedAt.slice(0, 10) + (age !== null ? ' (' + (age === 0 ? 'today' : age + ' d ago') + ')' : '')].filter(Boolean);
      const n = [[p.objects.length, 'objects'], [p.transactions.length + p.fioriApps.length + p.ui5Apps.length, 'transactions / apps'], [p.enhancements.length, 'enhancement options'], [p.capServices.length, 'CAP services'], [p.notFound.length, 'not found']];
      body = (p.sample ? '<p class="note">Sample pack for demonstration — not read from your system. Run <strong>Discover in SAP</strong> for real data.</p>' : '') +
        (DS.isStale(p) ? '<p class="note">This discovery is ' + age + ' days old. Re-run it before sign-off so the FS matches the current system.</p>' : '') +
        '<div class="chips fs-sys">' + chips.map(function (c) { return '<span class="chip chip-static">' + esc(c) + '</span>'; }).join('') + '</div>' +
        '<div class="stats">' + n.map(function (x) { return U().stat(esc(x[1]), String(x[0])); }).join('') + '</div>' +
        (H.isVscode ? '<div class="chips fs-copilot">' + copilotStatus() + '</div>' : '');
    }
    const checks = p ? DS.crossCheck(s) : [];
    const checkHtml = checks.length ? '<h4>Reference check</h4><p class="muted small">Names used in this FS compared with the system.</p><div class="table-scroll"><table class="grid fs-check"><thead><tr><th>Name</th><th>Used in</th><th>Result</th></tr></thead><tbody>' +
      checks.map(function (r) { return '<tr><td><code>' + esc(r.name) + '</code></td><td>' + esc(r.where) + '</td><td>' + badge(r.status) + (r.info && r.status !== 'unchecked' ? ' <span class="muted small">' + esc(r.info) + '</span>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '';
    return '<section class="card fs-disc" aria-labelledby="h-disc"><h3 id="h-disc">Current SAP system</h3>' + body +
      (H.isVscode ? vscodeActions(p) + paste + checkHtml : actions + paste + checkHtml + settings) + '</section>';
  }

  function handoffHtml(s) {
    const list = s.solution.ricefw || [];
    const ids = F.ricefwIds(list);
    const items = list.map(function (r, i) { return { r: r, i: i, id: ids[i] }; }).filter(function (x) { return V.isFilled(x.r) && x.r.type; });
    if (!items.length) return '';
    return '<div class="suggest fs-handoff"><p class="muted small" id="ho-h">Hand a RICEFW item to the developer as a <strong>Development Specification</strong> for <code class="agent-name">dewa-abap</code> (opens the Technical builder pre-filled; this FS stays in Drafts):</p><div class="chips" aria-labelledby="ho-h">' +
      items.map(function (x) { return '<button type="button" class="chip" data-action="fs-handoff" data-i="' + x.i + '">→ ' + esc(x.id) + ' ' + esc(x.r.name || F.ricefwType(x.r.type).label) + '</button>'; }).join('') + '</div></div>';
  }

  function step4(s) {
    const gaps = FC.uncoveredGaps(s);
    return header(4) + discoveryPanel(s) +
      (gaps.length ? '<div class="refs" role="note"><strong>Gaps without a RICEFW item:</strong> ' + gaps.map(esc).join(', ') + ' — add an item and list the FR under “Covers FRs”.</div>' : '') +
      block('solution', ['ricefw']) + handoffHtml(s) +
      block('solution', null, ['ricefw']) +
      U().nav(true, 'Continue');
  }

  function step5(s, ui) {
    const ev = FC.evaluate(s);
    const c = ev.counts;
    return header(5) + U().statusHtml(ev, true) +
      '<div class="stats">' +
      U().stat('Requirements', c.frs + ' FRs<br>' + c.gaps + ' gaps') +
      U().stat('RICEFW', String(c.ricefw)) +
      U().stat('UAT scenarios', String(c.uat)) +
      U().stat('System context', s.discovery ? (s.discovery.sample ? 'sample pack' : '✓ discovered') : 'not run') +
      U().stat('Open questions', String(ev.questions.length)) + '</div>' +
      (ev.questions.length ? '<details class="more"' + U().detailsAttrs('fs-questions', false) + '><summary>Open questions (' + ev.questions.length + ')</summary><ol class="small">' + ev.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></details>' : '') +
      '<h3>Non-functional requirements</h3>' + block('quality', ['performance', 'volume', 'availability', 'audit', 'privacy']) +
      '<h3>Testing &amp; risks</h3>' +
      (FC.frs(s).length ? '<p><button type="button" class="btn btn-ghost btn-sm" data-action="fs-uat">Create UAT skeleton from FRs</button> <span class="muted small">one positive and one negative case per FR that has none yet</span></p>' : '') +
      block('quality', ['uat', 'risks']) +
      '<section class="card" aria-labelledby="h-ctl"><h3 id="h-ctl">Document control &amp; sign-off</h3>' + block('control') + '</section>' +
      '<div class="nav-row"><button type="button" class="btn btn-ghost" data-action="back">Back</button><span class="spacer"></span>' +
      (ev.level === 'almost' ? '<button type="button" class="btn btn-ghost" data-action="missing">Add Missing Details</button>' : '') +
      '<button type="button" class="btn btn-primary btn-lg" data-action="generate"' + (ev.mandatory.length ? ' disabled' : '') + '>Generate Specification</button></div>' +
      (ev.mandatory.length ? '<p class="field-error" role="alert">Still needed: ' + ev.mandatory.map(function (r) { return esc(r.label.toLowerCase()); }).join(' and ') + '.</p>' : '');
  }

  function renderStep(n, s, ui) { return [step1, step2, step3, step4, step5][n - 1](s, ui); }

  function generatedView(s, ui) {
    const md = FM.build(s);
    const ho = handoffHtml(s);
    return '<div class="gen-head"><h2 class="step-title">Your functional specification is ready</h2>' +
      '<p class="muted">Download it as <strong>Word</strong> for review and sign-off, or as Markdown (<code>' + esc(FM.filename()) + '</code>) for the project repository. ' +
      (s.discovery ? 'System facts come from the discovery pack of ' + esc((s.discovery.generatedAt || '').slice(0, 10) || 'unknown date') + '.' : 'Tip: run <button type="button" class="link" data-action="goto" data-step="4">system discovery</button> so the FS reflects the current SAP system.') + '</p></div>' +
      '<div class="gen-actions"><button type="button" class="btn btn-primary btn-lg" data-action="fs-docx">' + DOWNLOAD_ICON + ' Download Word</button>' +
      '<button type="button" class="btn btn-ghost btn-lg" data-action="download">Download Markdown</button>' +
      '<button type="button" class="btn btn-ghost" data-action="copy">Copy Markdown</button>' +
      '<button type="button" class="btn btn-ghost" data-action="share">Copy share link</button>' +
      '<button type="button" class="btn btn-ghost" data-action="edit">Review Details</button></div>' + ho +
      '<div class="seg gen-seg" role="group" aria-label="Format"><button type="button" data-action="view-rendered" aria-pressed="' + !ui.raw + '">Preview</button><button type="button" data-action="view-raw" aria-pressed="' + ui.raw + '">Markdown</button></div>' +
      '<div class="gen-doc md" tabindex="0" aria-label="Generated specification">' + (ui.raw ? '<pre>' + esc(md) + '</pre>' : APB.markdown.toHtml(md)) + '</div>';
  }

  /* ------------------------------------------------------------- hand-off */
  const PACK_TO_TYPE = DS.cfg.objectTypeMap;

  /* One RICEFW item → a development-spec state (technical builder), traceable to this FS. */
  function toDevSpec(s, i) {
    const r = s.solution.ricefw[i] || {};
    const id = F.ricefwIds(s.solution.ricefw)[i];
    const rt = F.ricefwType(r.type);
    const devType = rt.devType && APB.defs.types[rt.devType] ? rt.devType : 'REPORT';
    const frRefs = F.parseFrRefs(r.frs);
    const frs = (s.reqs.frs || []).map(function (f, k) { return { f: f, id: F.frId(k) }; }).filter(function (x) { return frRefs.indexOf(x.id) >= 0 && V.isFilled(x.f); });
    const pack = s.discovery;
    const known = {};
    if (pack) pack.objects.forEach(function (o) { known[o.name] = PACK_TO_TYPE[o.type] || 'Other'; });
    if (pack) pack.enhancements.forEach(function (e) { known[e.name] = 'BAdI / Enhancement'; });
    const objects = [{ type: APB.defs.types[devType].mainObject[0], name: (r.name || '').trim(), status: 'new', purpose: 'Main object (' + id + ')' }];
    DS.names(r.existing).forEach(function (n) {
      if (objects.some(function (o) { return o.name.toUpperCase() === n; })) return;
      objects.push({ type: known[n] || 'Other', name: n, status: known[n] ? 'existing' : 'tbc', purpose: known[n] ? 'Verified in system (FS discovery)' : 'Named in the FS – confirm in the system' });
    });
    const reqText = [(r.description || '').trim() || (s.context.requirement || '').trim()]
      .concat(frs.map(function (x) { return x.id + ' ' + (x.f.title || '').trim() + ((x.f.description || '').trim() ? ': ' + x.f.description.trim() : ''); })).filter(Boolean).join('\n\n');
    const rules = (s.reqs.rules || []).filter(function (b) { return V.isFilled(b) && (!b.fr || F.parseFrRefs(b.fr).some(function (x) { return frRefs.indexOf(x) >= 0; })); })
      .map(function (b) { return { condition: (b.rule || '').trim(), behavior: (b.outcome || '').trim() }; });
    const acceptance = [];
    frs.forEach(function (x) { APB.markdown.helpers.splitLines(x.f.acceptance).forEach(function (a) { acceptance.push({ text: a }); }); });
    const tests = (s.quality.uat || []).filter(function (u) { return V.isFilled(u) && F.parseFrRefs(u.fr).some(function (x) { return frRefs.indexOf(x) >= 0; }); })
      .map(function (u) { return (u.scenario || '').trim() + ((u.expected || '').trim() ? ' => ' + u.expected.trim() : ''); });
    const roles = (s.solution.roles || []).filter(V.isFilled);
    const auth = roles.filter(function (x) { return (x.authObj || '').trim(); });
    const users = roles.map(function (x) { return (x.role || '').trim(); }).filter(Boolean).join(', ');
    const docRef = 'Source: functional specification ' + ([s.control.docId, s.control.version && 'v' + s.control.version].filter(Boolean).join(' ') || '"' + F.model.name(s) + '"') + ', RICEFW item ' + id + (frRefs.length ? ' (' + frRefs.join(', ') + ')' : '') + '.';
    const quality = { authorization: auth.length ? 'yes' : '', authChecks: auth.map(function (x) { return { object: x.authObj.trim(), fields: (x.scope || '').trim(), where: (x.role || '').trim() }; }), dataVolume: '', performanceReq: (s.quality.performance || '').trim(), testTypes: ['Unit', 'Functional', 'Integration'], testScenarios: tests.join('\n'), cleanCore: '', cleanCoreNote: '' };
    return APB.state.migrate({
      project: { name: [s.control.docId, id, (r.name || '').trim()].filter(Boolean).join(' · ') },
      types: [devType],
      requirement: { text: reqText, objective: APB.markdown.helpers.splitLines(s.context.objectives).join('; '), users: users, expectedOutput: '' },
      objects: objects.map(function (o) { o.id = S.uid(); o.detail = {}; return o; }),
      rules: rules.map(function (b) { b.id = S.uid(); return b; }),
      acceptance: acceptance.map(function (a) { a.id = S.uid(); return a; }),
      assumptions: docRef,
      quality: quality
    });
  }

  /* UAT skeleton: one positive and one negative case per FR without any case yet. */
  function uatSkeleton(s) {
    const have = {};
    (s.quality.uat || []).forEach(function (u) { if (u) F.parseFrRefs(u.fr).forEach(function (x) { have[x] = true; }); });
    const out = [];
    (s.reqs.frs || []).forEach(function (f, i) {
      const id = F.frId(i);
      if (!V.isFilled(f) || have[id]) return;
      const ac = APB.markdown.helpers.splitLines(f.acceptance);
      const t = (f.title || '').trim() || id;
      out.push({ fr: id, scenario: ac[0] || t + ' – valid input', type: 'positive', expected: ac[0] ? '' : 'Requirement met' });
      out.push({ fr: id, scenario: t + ' – invalid or missing input', type: 'negative', expected: 'Clear error message; nothing is saved' });
    });
    return out;
  }

  /* ------------------------------------------------------------------ actions */
  function importText(text, source) {
    const res = DS.parse(text);
    if (!res.pack) { U().toast(res.errors[0] || 'This is not a context pack', 6000); return false; }
    U().updateSteps(function (st) { st.discovery = res.pack; });
    U().renderDatalists();
    const ok = DS.crossCheck(S.get()).filter(function (r) { return r.status === 'verified'; }).length;
    U().toast('System context imported' + (source ? ' from ' + source : '') + ' ✓ ' + ok + ' reference(s) verified' + (res.warnings.length ? ' · ' + res.warnings[0] : ''), 6000);
    return true;
  }

  const actions = {
    'fs-template': function (el) {
      const t = F.templates.fromTemplate(el.dataset.id, S.get());
      if (!t) return;
      S.replace(t);
      U().renderMain();
      U().toast('Template applied — adjust the steps and FRs to your requirement');
    },
    'fs-copy-asis': function () {
      U().updateSteps(function (st) { st.process.toBe = (st.process.asIs || []).filter(V.isFilled).map(function (r) { return { step: r.step || '', role: r.role || '', tx: r.tx || '', change: 'unchanged' }; }); });
      U().toast('TO-BE started from AS-IS — mark what changes');
    },
    'fs-uat': function () {
      const rows = uatSkeleton(S.get());
      if (!rows.length) { U().toast('Every FR already has a UAT case'); return; }
      U().updateSteps(function (st) { st.quality.uat = (st.quality.uat || []).filter(V.isFilled).concat(rows); });
      U().toast(rows.length + ' UAT case(s) added — complete the expected results');
    },
    'fs-discover': function () {
      if (H.isVscode) { startDiscovery('auto'); return; }
      const s = S.get();
      if (FC.checkMandatory(s).length) { U().toast('Add the business requirement and the module first (step 1)'); return; }
      const mode = APB.storage.getPref('vscodeLaunch', 'extension');
      const copied = APB.exporter.copyNow(DS.prompt(s));
      APB.exporter.launchVscode(DS.launchUrl(mode, APB.storage.getPref('extensionId', DS.cfg.extensionId)));
      U().toast(!copied ? 'VS Code is opening — copying failed, use Copy prompt only'
        : mode === 'plain' ? 'Prompt copied ✓ In VS Code open Copilot Chat (Ctrl+Alt+I), pick ' + DS.cfg.agent + ', paste and press Enter'
          : 'Prompt copied ✓ VS Code opens Copilot Chat with ' + DS.cfg.agent + ' — sign in if asked, then press Enter', 8000);
    },
    'fs-copy-prompt': function () {
      Promise.resolve(APB.exporter.copy(DS.prompt(S.get()))).then(function (ok) { U().toast(ok ? 'Discovery prompt copied' : 'Copy failed'); });
    },
    'fs-pick-tx': function (el) {
      const m = /^(asIs|toBe)\.(\d+)$/.exec(el.dataset.key || '');
      if (!m) return;
      U().updateSteps(function (st) { const r = (st.process[m[1]] || [])[Number(m[2])]; if (r) r.tx = el.dataset.v; });
      U().toast(el.dataset.v + ' set for ' + (m[1] === 'asIs' ? 'AS-IS' : 'TO-BE') + ' step ' + (Number(m[2]) + 1));
    },
    'fs-suggest': function () {
      if (H.isVscode) { startDiscovery('auto'); U().toast('Discovery is reading the system – suggestions appear here when it is done', 6000); return; }
      actions['fs-discover']();
    },
    'fs-signin': function () { H.post({ type: 'sign-in' }); },
    'fs-auto': function () { startDiscovery('auto'); },
    'fs-chat': function () { startDiscovery('chat'); },
    'fs-stop': function () { H.post({ type: 'stop' }); disc.running = false; disc.log.push({ text: 'Stopped', status: 'info' }); rerenderDiscovery(); },
    'fs-import-clip': function () {
      if (H.isVscode) {
        H.request('clipboard-read').then(function (t) { importText(String(t || ''), 'clipboard'); }, function () { U().toast('Could not read the clipboard'); });
        return;
      }
      if (!navigator.clipboard || !navigator.clipboard.readText) { U().ui.open['fs-paste'] = true; U().renderMain(); U().toast('Clipboard access is not available here — paste the answer below'); return; }
      navigator.clipboard.readText().then(function (t) { importText(t, 'clipboard'); }, function () {
        U().ui.open['fs-paste'] = true; U().renderMain();
        U().toast('The browser blocked clipboard access — paste the answer below', 6000);
      });
    },
    'fs-import-paste': function () {
      const ta = document.getElementById('fs-pack');
      if (ta && importText(ta.value)) U().ui.open['fs-paste'] = false;
    },
    'fs-sample-pack': function () { importText(JSON.stringify(APB.config.fsTemplates.samplePack), 'the sample'); },
    'fs-clear-pack': function () {
      if (!window.confirm('Remove the system context from this FS?')) return;
      U().updateSteps(function (st) { st.discovery = null; });
      U().renderDatalists();
    },
    'fs-launch-mode': function (el) { APB.storage.setPref('vscodeLaunch', el.value); U().toast(el.value === 'plain' ? 'VS Code opens without the extension — paste the prompt yourself' : 'VS Code opens through the DEWA extension'); },
    'fs-handoff': function (el) {
      const s = S.get();
      const dev = toDevSpec(s, Number(el.dataset.i));
      U().loadState(dev, 'Development spec created from ' + F.ricefwIds(s.solution.ricefw)[Number(el.dataset.i)] + ' — your FS is in Drafts');
    },
    'fs-docx': function () {
      const s = S.get();
      if (FC.checkMandatory(s).length) { U().toast('Add the business requirement and the module first'); return; }
      const bytes = APB.docx.fromMarkdown(FM.build(s), FM.docMeta(s));
      APB.exporter.downloadBytes(FM.docxFilename(s), bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      U().toast(U().savedMsg(FM.docxFilename(s)));
    }
  };

  /* Extension ID setting: saved as typed (no re-render). */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.dataset && e.target.dataset.pref) APB.storage.setPref(e.target.dataset.pref, e.target.value.trim());
  });

  function commands(run) {
    const list = F.steps.map(function (st) { return { g: 'Navigate', i: String(st.n), t: 'Step ' + st.n + ' · ' + st.title, run: function () { run.setStep(st.n); } }; });
    list.push(
      { g: 'Create', i: '✦', t: 'Generate functional specification', run: function () { run.setStep(5); run.actions.generate(); } },
      { g: 'Create', i: 'W', t: 'Download Word (.docx)', run: actions['fs-docx'] },
      { g: 'Create', i: '⬇', t: 'Download Markdown', run: run.actions.download },
      { g: 'Create', i: '⧉', t: 'Copy Markdown', run: run.actions.copy },
      { g: 'Create', i: '+', t: 'New functional specification', run: run.actions.new },
      { g: 'System', i: '›', t: H.isVscode ? 'Discover in SAP (automatic, read-only)' : 'Discover in SAP (open VS Code with ' + DS.cfg.agent + ')', run: function () { run.setStep(4); actions['fs-discover'](); } },
      { g: 'System', i: '⇩', t: 'Import context pack from clipboard', run: function () { run.setStep(4); actions['fs-import-clip'](); } },
      { g: 'Create', i: '✓', t: 'Create UAT skeleton from FRs', run: function () { run.setStep(5); actions['fs-uat'](); } }
    );
    F.templates.list().forEach(function (t) { list.push({ g: 'Template', i: '◇', t: t.label, run: function () { run.setStep(1); actions['fs-template']({ dataset: { id: t.id } }); } }); });
    F.templates.examples().forEach(function (e) { list.push({ g: 'Example', i: e.module, t: e.label, run: function () { run.loadState(F.templates.example(e.id), 'Example loaded'); } }); });
    return list;
  }

  APB.fsApp = {
    hero: HERO,
    rotator: ROTATOR,
    previewActions: PV_ACTIONS,
    fileLabel: 'Functional specification',
    renderStep: renderStep,
    generatedView: generatedView,
    actions: actions,
    commands: commands,
    toDevSpec: toDevSpec,
    uatSkeleton: uatSkeleton
  };
})(window.APB = window.APB || {});
