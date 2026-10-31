/* Functional-specification wizard. Rendering reuses the generic field renderers of app.js (exposed as APB.ui);
   this file only adds what is FS-specific: step layouts, discovery panel, UAT skeleton, hand-off to a
   development spec, and the FS flavour of hero, preview actions and command palette. */
(function (APB) {
  'use strict';
  const F = APB.fs, FC = APB.fsCompleteness, FM = APB.fsMarkdown, DS = APB.discovery, V = APB.validation, S = APB.state, H = APB.host;

  function U() { return APB.ui; }
  function esc(t) { return U().esc(t); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Record titles: FR-01 … and per-type RICEFW ids (R-01, E-01 …) instead of "Item 1". */
  F.field('reqs', 'frs').labelFor = function (recs, i) { return F.frId(i); };
  F.field('solution', 'ricefw').labelFor = function (recs, i) { return F.ricefwIds(recs)[i]; };

  /* ------------------------------------------------------------------ chrome */
  const HERO = '<div class="hero-copy">' +
    '<p class="hero-badge"><span class="spark" aria-hidden="true">✦</span> Functional specs for SAP and any other system</p>' +
    '<h1 id="hero-title">Functional <span class="grad">Specification Builder</span></h1>' +
    '<p class="hero-sub">From business requirement to a sign-off-ready FS for ' +
    '<span class="rotator" aria-hidden="true"><span id="rotator-text">FI-AP processes</span><span class="caret"></span></span><span class="sr-only">SAP processes, customer portals, CRM, HR and any other business process</span></p>' +
    '<ul class="hero-chips" aria-label="Highlights"><li><strong>SAP</strong> or any system</li><li><strong>1</strong> requirement is enough to start</li><li><strong>Word</strong> + Markdown</li><li><strong>AI draft</strong> you review</li></ul></div>' +
    '<div class="hero-cta"><button type="button" class="btn btn-primary btn-lg" data-action="start">Start — just describe the need <span aria-hidden="true">→</span></button>' +
    '<button type="button" class="btn btn-ghost btn-lg" data-action="examples">See an example</button></div>';

  const ROTATOR = ['FI-AP processes', 'customer portals', 'SD order-to-cash', 'complaint handling', 'IS-U meter-to-cash', 'HR onboarding', 'Fiori app rollouts', 'any business process'];

  const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/></svg>';
  const PV_ACTIONS = '<button type="button" class="btn btn-primary" data-action="fs-docx">' + DOWNLOAD_ICON + ' Word</button>' +
    '<button type="button" class="btn btn-ghost" data-action="download">Markdown</button>' +
    '<button type="button" class="btn btn-ghost" data-action="copy">Copy</button>' +
    (H.isVscode ? '<button type="button" class="btn btn-ghost" data-action="fs-chat-review" title="Open this FS in Copilot Chat to review it and ask questions">Copilot Chat</button>' : '');

  /* ------------------------------------------------------------ step helpers */
  function header(n) {
    const st = F.stepFor(n, S.get());
    return '<h2 class="step-title">' + esc(st.title) + '</h2><p class="muted">' + esc(st.intro) + '</p>';
  }

  /* Fields as this spec shows them: SAP-only ones dropped and generic labels for other systems; "custom" ones
     (the system choice) are rendered by the step itself. */
  function fieldsOf(sectionId, ids, exclude) {
    return F.fieldsFor(sectionId, S.get()).filter(function (f) { return !f.custom && (ids ? ids.indexOf(f.id) >= 0 : (exclude || []).indexOf(f.id) < 0); });
  }

  function mandatoryMsg(s) {
    return F.isSap(s) ? 'Add the business requirement and the module first (step 1)' : 'Describe the business requirement first (step 1)';
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
  const SYSTEM_ICON = { sap: 'SAP', other: '▣', tbd: '?' };

  function systemCards(s) {
    const c = s.context;
    const f = F.field('context', 'system');
    return '<fieldset class="field wide fs-system"><legend>' + esc(f.label) + ' <span class="hint">pick one – you can change it later</span></legend><div class="type-grid">' +
      f.options.map(function (o) {
        return '<button type="button" class="type-card" data-action="fs-system" data-v="' + esc(o.value) + '" aria-pressed="' + (c.system === o.value) + '">' +
          '<span class="type-ico">' + esc(SYSTEM_ICON[o.value]) + '</span><span class="type-name">' + esc(o.label) + '</span><span class="type-hint">' + esc(o.hint) + '</span></button>';
      }).join('') + '</div>' +
      (c.system === 'other' ? '<div class="field narrow"><label for="fs-sysname">' + esc(F.field('context', 'systemName').label) + ' <span class="hint">optional</span></label><input id="fs-sysname" type="text" data-bind="context.systemName" value="' + esc(c.systemName) + '" placeholder="' + esc(F.field('context', 'systemName').placeholder) + '"></div>' : '') +
      '</fieldset>';
  }

  /* ------------------------------------------------------------- AI draft */
  /* One Copilot job at a time: kind 'draft' (generate the spec) or 'program' (read an existing program). */
  const drf = { running: false, kind: '', mode: '', status: '', error: '', pending: null, pendingKind: '', log: [] };
  /* Copilot Chat sends prompts itself unless dewaSpecBuilder.chatAutoSend is off (reported with the auth status). */
  function autoSend() { return !disc.auth || disc.auth.chatAutoSend !== false; }

  function copilotReady() { const a = disc.auth; return !!(a && a.copilot && a.signedIn); }

  function runningHtml() {
    return '<button type="button" class="btn btn-ghost" data-action="fs-draft-stop">' + (drf.mode === 'chat' ? 'Stop waiting' : 'Stop') + '</button><span class="muted small fs-draft-status">' + esc(drf.status || 'Copilot is working…') + '</span>';
  }

  function draftLogHtml() {
    if (!drf.log.length) return '';
    const icon = { running: '…', done: '✓', blocked: '⛔', error: '✗', info: '›' };
    return '<ol class="fs-log" aria-live="polite">' + drf.log.map(function (l) { return '<li class="' + esc(l.status || 'info') + '"><span aria-hidden="true">' + (icon[l.status] || '›') + '</span> ' + esc(l.text) + '</li>'; }).join('') + '</ol>';
  }

  function draftCard(s) {
    const ready = (s.context.requirement || '').trim().length >= 10;
    const can = ready && copilotReady() && !drf.running;
    const vs = H.isVscode ? '<div class="chips fs-copilot">' + copilotStatus() + '</div>' : '';
    const run = H.isVscode
      ? (drf.running && drf.kind === 'draft'
        ? runningHtml()
        : '<button type="button" class="btn btn-primary" data-action="fs-draft-run"' + (can ? '' : ' disabled') + '>✦ Generate with Copilot</button>' +
          '<button type="button" class="btn btn-ghost" data-action="fs-draft-chat"' + (can ? '' : ' disabled') + ' title="Watch and steer it in Copilot Chat; the result comes back here for review">Generate in Copilot Chat</button>')
      : '<button type="button" class="btn btn-primary" data-action="fs-draft-copy"' + (ready ? '' : ' disabled') + '>✦ Copy AI prompt</button>';
    const paste = '<details class="paste"' + U().detailsAttrs('fs-draft-paste', false) + '><summary>' + (H.isVscode ? 'Use another AI chat instead' : 'Paste the AI answer') + '</summary>' +
      (H.isVscode ? '<p class="small muted"><button type="button" class="link" data-action="fs-draft-copy">Copy the prompt</button>, paste it into an AI chat your organisation allows, then paste the whole answer here.</p>' : '<label for="fs-draft-answer" class="small muted">The whole answer, or only its ```json block.</label>') +
      '<textarea id="fs-draft-answer" rows="5" spellcheck="false"></textarea>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="fs-draft-review">Review the answer</button></details>';
    return '<section class="card fs-draft" aria-labelledby="h-draft"><h3 id="h-draft">✦ Generate the whole spec with Copilot <span class="hint">recommended</span></h3>' +
      '<p class="muted small">From your requirement, Copilot writes the complete specification: objectives, scope, process, functional requirements with acceptance criteria, rules, data, roles, interfaces, test scenarios and risks. You review it before anything is added, nothing you typed is overwritten, and the document opens right after.' +
      (H.isVscode ? ' Uses your GitHub Copilot in VS Code – no system access. <strong>Generate in Copilot Chat</strong> lets you watch and steer it.' : ' Copy the prompt, paste it into an AI chat your organisation allows (for example Copilot Chat), then paste the answer below.') + '</p>' +
      vs + '<div class="gen-actions">' + run + (ready ? '' : '<span class="muted small">Describe the requirement first.</span>') + '</div>' +
      (drf.error && drf.kind !== 'program' ? '<p class="field-error" role="alert">' + esc(drf.error) + '</p>' : '') + paste + '</section>';
  }

  /* SAP only: read an existing program (and what it uses) read-only, and bring its logic into the spec. */
  function programCard(s) {
    const names = APB.storage.getPref('programNames', '');
    const can = copilotReady() && !drf.running;
    const run = H.isVscode
      ? (drf.running && drf.kind === 'program'
        ? runningHtml()
        : '<button type="button" class="btn btn-primary" data-action="fs-prog-auto"' + (can ? '' : ' disabled') + '>Read automatically</button>' +
          '<button type="button" class="btn btn-ghost" data-action="fs-prog-chat"' + (can ? '' : ' disabled') + '>Read in Copilot Chat</button>')
      : '<button type="button" class="btn btn-primary" data-action="fs-prog-copy">Copy prompt</button>';
    return '<section class="card fs-prog" aria-labelledby="h-prog"><h3 id="h-prog">Read an existing program <span class="hint">optional</span></h3>' +
      '<p class="muted small">Copilot reads the program, the objects it uses and the SAP system <strong>read-only</strong> through the SAP MCP servers, and describes the current logic in business words: current process, business rules, data, current behaviour as requirements. You review it before it is added. Afterwards you can create a Technical spec that changes the program.' +
      (H.isVscode ? '' : ' In the browser: copy the prompt, paste it into Copilot Chat in VS Code with the <code class="agent-name">' + esc(DS.cfg.agent) + '</code> agent, then paste the answer under <em>Paste the AI answer</em> above.') + '</p>' +
      '<div class="field narrow"><label for="fs-prog-names">Programs, transactions, classes or function modules</label><input id="fs-prog-names" type="text" data-pref="programNames" value="' + esc(names) + '" placeholder="e.g. ZFI_AGEING, FBL1N" spellcheck="false"></div>' +
      '<div class="gen-actions">' + run + '</div>' + (drf.kind === 'program' ? draftLogHtml() : '') +
      (drf.error && drf.kind === 'program' ? '<p class="field-error" role="alert">' + esc(drf.error) + '</p>' : '') + '</section>';
  }

  /* All fields of a section in one form grid (no nested "Advanced details"); used inside "More details". */
  function blockAll(sectionId, ids, exclude) {
    const s = S.get();
    const fields = fieldsOf(sectionId, ids, exclude).map(function (f) { return f.advanced ? Object.assign({}, f, { advanced: false }) : f; });
    return fields.length ? U().fieldsBlock(fields, s[sectionId], sectionId) : '';
  }
  function more(id, title, html, open) {
    return html ? '<details class="more"' + U().detailsAttrs(id, !!open) + '><summary>' + esc(title) + '</summary>' + html + '</details>' : '';
  }

  function step1(s, ui) {
    const missing = ui.showErrors ? FC.checkMandatory(s).map(function (r) { return r.id; }) : [];
    const c = s.context;
    const sap = F.isSap(s);
    const mod = F.field('context', 'module');
    const req = F.view(F.field('context', 'requirement'), s);
    const tpls = F.templates.list().map(function (t) {
      return '<button type="button" class="chip" data-action="fs-template" data-id="' + esc(t.id) + '" title="' + esc(t.description) + '">' + esc(t.label) + '</button>';
    }).join('');
    const ctxFilled = ['processArea', 'objectives', 'kpis', 'inScope', 'outOfScope', 'stakeholders', 'otherOrg'].some(function (k) { return V.isFilled(c[k]); });
    return header(1) + systemCards(s) +
      '<div class="grid-2"><div class="field"><label for="fs-title">Specification title</label><input id="fs-title" type="text" data-bind="context.title" value="' + esc(c.title) + '" placeholder="' + esc(F.view(F.field('context', 'title'), s).placeholder) + '"></div>' +
      (!sap ? '</div>' : '') + (sap ? '<div class="field"><label for="fs-module">Module <span class="req">required</span></label><select id="fs-module" data-bind="context.module"' + (missing.indexOf('module') >= 0 ? ' aria-invalid="true"' : '') + '>' +
      mod.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (c.module === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>' +
      (missing.indexOf('module') >= 0 ? '<p class="field-error" role="alert">Pick the module.</p>' : '') + '</div></div>' : '') +
      '<div class="field"><label for="fs-req">Business requirement <span class="req">required</span></label>' +
      '<textarea id="fs-req" class="tall" rows="7" data-bind="context.requirement" placeholder="' + esc(req.placeholder) + '"' + (missing.indexOf('requirement') >= 0 ? ' aria-invalid="true" aria-describedby="fs-req-err"' : '') + '>' + esc(c.requirement) + '</textarea>' +
      (missing.indexOf('requirement') >= 0 ? '<p id="fs-req-err" class="field-error" role="alert">Describe the business need (a sentence or two is enough).</p>' : '') + '</div>' +
      draftCard(s) + (sap ? programCard(s) : '') +
      more('fs-more-ctx', 'More details – process area, objectives, KPIs, scope, stakeholders', blockAll('context', null, ['title', 'module', 'requirement']) +
        (!sap ? '' : '<p class="muted small">Start from a module template – adds typical process steps, FR headings and roles where you have not typed anything. Want a complete FS? <button type="button" class="link" data-action="examples">Load an example</button>.</p><div class="chips">' + tpls + '</div>'), ctxFilled) +
      '<div class="nav-row"><span class="spacer"></span>' +
      '<button type="button" class="btn btn-ghost" data-action="fs-quick" title="Create the document from what you have – the rest is listed as open questions">Create document now</button>' +
      '<button type="button" class="btn btn-primary" data-action="next">Continue <span aria-hidden="true">→</span></button></div>';
  }

  function step2(s) {
    const p = s.process;
    const asIs = (p.asIs || []).filter(V.isFilled);
    const toBe = (p.toBe || []).filter(V.isFilled);
    const c = FC.evaluate(s).counts;
    const summary = c.frs ? '<div class="fs-fit" aria-label="Fit-gap summary"><span><b>' + c.frs + '</b> FRs</span><span><b>' + c.must + '</b> must-have</span><span class="ok"><b>' + c.standard + '</b> standard / config</span><span class="gap"><b>' + c.gaps + '</b> gaps</span></div>' : '';
    const moreFilled = asIs.length || V.isFilled(p.variants) || V.isFilled(p.currentLogic) || V.isFilled(p.programs) || V.isFilled(s.reqs.data);
    return header(2) +
      block('process', ['toBe']) +
      (asIs.length && !toBe.length ? '<p><button type="button" class="btn btn-ghost btn-sm" data-action="fs-copy-asis">Start TO-BE from the AS-IS steps</button></p>' : '') +
      (toBe.length ? '<h3>TO-BE flow</h3>' + flowHtml(p.toBe) : '') +
      summary + block('reqs', ['frs', 'rules']) +
      more('fs-more-proc', 'More details – current process (AS-IS), current program logic, variants, data', blockAll('process', ['asIs', 'currentLogic', 'programs', 'variants']) + blockAll('reqs', ['data']), moreFilled) +
      U().nav(true, 'Continue');
  }

  function badge(status) {
    const map = { verified: ['ok', '✓ in system'], missing: ['bad', '✗ not found'], unchecked: ['', '– not checked'], clash: ['bad', '⚠ already exists'], free: ['ok', '✓ name free'] };
    const m = map[status] || map.unchecked;
    return '<span class="chk ' + m[0] + '">' + m[1] + '</span>';
  }

  /* ---------------------------------------------- discovery inside VS Code */
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
    if (S.isFs() && !U().ui.generated && U().ui.step === 3 && !U().ui.view) U().renderMain();
  }

  if (H.isVscode) {
    H.on('auth', function (m) { disc.auth = { signedIn: !!m.signedIn, account: String(m.account || ''), copilot: m.copilot !== false, chatAutoSend: m.chatAutoSend !== false }; rerenderDiscovery(); rerenderStep1(); });
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
    if (FC.checkMandatory(s).length) { U().toast(mandatoryMsg(s)); return; }
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

  /* Technical specs created from this FS (spec-link.js), with their state. */
  function linkedHtml(s) {
    const l = APB.specLink.linkedTo(s);
    if (!l.length) return '';
    const word = { current: 'up to date', changed: 'FS changed – open to update', gone: 'item no longer in the FS', missing: '' };
    return '<div class="suggest fs-linked"><p class="muted small">Technical specs created from this FS – they are updated from it when you open them:</p><div class="chips">' +
      l.map(function (x) { return '<button type="button" class="chip' + (x.state === 'changed' ? ' chip-warn' : '') + '" data-action="link-open" data-id="' + esc(x.id) + '">' + esc(x.label) + ' · ' + esc(word[x.state] || '') + '</button>'; }).join('') + '</div></div>';
  }

  /* "Technical spec from the program" – after Read an existing program. */
  function programHandoffHtml(s) {
    if (!F.isSap(s) || !mainProgram(s)) return '';
    const m = mainProgram(s);
    return '<div class="suggest fs-handoff"><p class="muted small">Change the existing program: create a <strong>Development Specification</strong> for <code class="agent-name">dewa-abap</code> with <code>' + esc(m.name) + '</code> as the object to change and the objects it uses as existing objects (this FS stays in Drafts).</p>' +
      '<div class="chips"><button type="button" class="chip" data-action="fs-dev-from-program">→ Technical spec: change ' + esc(m.name) + '</button></div></div>';
  }

  function step3(s, ui) {
    const ev = FC.evaluate(s);
    const c = ev.counts;
    const sap = F.isSap(s);
    const gaps = sap ? FC.uncoveredGaps(s) : [];
    const solution = sap
      ? discoveryPanel(s) +
        (gaps.length ? '<div class="refs" role="note"><strong>Gaps without a RICEFW item:</strong> ' + gaps.map(esc).join(', ') + ' — add an item and list the FR under “Covers FRs”.</div>' : '') +
        block('solution', ['ricefw']) + handoffHtml(s) + programHandoffHtml(s) + linkedHtml(s) +
        more('fs-more-sol', 'More details – roles & authorizations, interfaces, outputs, configuration', blockAll('solution', null, ['ricefw']), ['roles', 'interfaces', 'outputs', 'customizing'].some(function (k) { return V.isFilled(s.solution[k]); }))
      : block('solution');
    const q = s.quality, ctl = s.control;
    const moreFilled = ['performance', 'volume', 'availability', 'audit', 'privacy', 'risks'].some(function (k) { return V.isFilled(q[k]); }) || V.isFilled(ctl.docId) || V.isFilled(ctl.author) || V.isFilled(ctl.history);
    return header(3) + U().statusHtml(ev, true) +
      '<div class="stats">' +
      U().stat('Requirements', c.frs + ' FRs<br>' + c.gaps + ' gaps') +
      (sap ? U().stat('RICEFW', String(c.ricefw)) : U().stat('System', esc(F.systemLabel(s)))) +
      U().stat('UAT scenarios', String(c.uat)) +
      (sap ? U().stat('System context', s.discovery ? (s.discovery.sample ? 'sample pack' : '✓ discovered') : 'not run') : '') +
      U().stat('Open questions', String(ev.questions.length)) + '</div>' +
      (ev.questions.length ? '<details class="more"' + U().detailsAttrs('fs-questions', false) + '><summary>Open questions (' + ev.questions.length + ')</summary><ol class="small">' + ev.questions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></details>' : '') +
      '<h3>Solution</h3>' + solution +
      '<h3>Testing &amp; sign-off</h3>' +
      (FC.frs(s).length ? '<p><button type="button" class="btn btn-ghost btn-sm" data-action="fs-uat">Create UAT skeleton from FRs</button> <span class="muted small">one positive and one negative case per FR that has none yet</span></p>' : '') +
      block('quality', ['uat']) + block('control', ['approvals']) +
      more('fs-more-q', 'More details – non-functional requirements, risks, document control', blockAll('quality', ['performance', 'volume', 'availability', 'audit', 'privacy', 'risks']) + blockAll('control', ['docId', 'version', 'status', 'author', 'history']), moreFilled) +
      '<div class="nav-row"><button type="button" class="btn btn-ghost" data-action="back">Back</button><span class="spacer"></span>' +
      (ev.level === 'almost' ? '<button type="button" class="btn btn-ghost" data-action="missing">Add Missing Details</button>' : '') +
      '<button type="button" class="btn btn-primary btn-lg" data-action="generate"' + (ev.mandatory.length ? ' disabled' : '') + '>Generate Specification</button></div>' +
      (ev.mandatory.length ? '<p class="field-error" role="alert">Still needed: ' + ev.mandatory.map(function (r) { return esc(r.label.toLowerCase()); }).join(' and ') + '.</p>' : '');
  }

  function renderStep(n, s, ui) { return [step1, step2, step3][n - 1](s, ui); }

  function generatedView(s, ui) {
    const md = FM.build(s);
    const ho = F.isSap(s) ? handoffHtml(s) : '';
    const qn = FC.openQuestions(s).length;
    return '<div class="gen-head"><h2 class="step-title">Your functional specification is ready</h2>' +
      '<p class="muted">Download it as <strong>Word</strong> for review and sign-off, or as Markdown (<code>' + esc(FM.filename()) + '</code>) for the project repository. ' +
      (!F.isSap(s) ? (qn ? qn + ' open question' + (qn > 1 ? 's are' : ' is') + ' listed at the end – <button type="button" class="link" data-action="edit">add the details</button> whenever you have them.' : '')
        : s.discovery ? 'System facts come from the discovery pack of ' + esc((s.discovery.generatedAt || '').slice(0, 10) || 'unknown date') + '.' : 'Tip: run <button type="button" class="link" data-action="goto" data-step="3">system discovery</button> so the FS reflects the current SAP system.') + '</p></div>' +
      '<div class="gen-actions"><button type="button" class="btn btn-primary btn-lg" data-action="fs-docx">' + DOWNLOAD_ICON + ' Download Word</button>' +
      '<button type="button" class="btn btn-ghost btn-lg" data-action="download">Download Markdown</button>' +
      '<button type="button" class="btn btn-ghost" data-action="copy">Copy Markdown</button>' +
      (H.isVscode ? '<button type="button" class="btn btn-ghost" data-action="fs-chat-review">Open in Copilot Chat</button>' : '<button type="button" class="btn btn-ghost" data-action="share">Copy share link</button>') +
      '<button type="button" class="btn btn-ghost" data-action="edit">Review Details</button></div>' + ho + (F.isSap(s) ? programHandoffHtml(s) + linkedHtml(s) : '') +
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

  /* ------------------------------------------- Technical spec from a program */
  function mainProgram(s) {
    const l = (s.process.programs || []).filter(function (p) { return p && (p.name || '').trim(); });
    return l.filter(function (p) { return p.role === 'main'; })[0] || l[0] || null;
  }

  function devObjectType(t) {
    const v = PACK_TO_TYPE[String(t || '').toUpperCase()] || String(t || '');
    return APB.defs.objectTypes.indexOf(v) >= 0 ? v : 'Other';
  }

  /* The program read by "Read an existing program" becomes the object to change; what it uses stays existing. */
  function toDevSpecFromProgram(s) {
    const main = mainProgram(s);
    if (!main) return null;
    const mainType = devObjectType(main.type);
    const devType = APB.defs.typeKeys().filter(function (k) { return APB.defs.types[k].mainObject.indexOf(mainType) >= 0; })[0] || 'REPORT';
    const objects = [{ type: mainType, name: main.name.trim().toUpperCase(), status: 'change', purpose: (main.description || '').trim() || 'Existing program to change' }];
    (s.process.programs || []).forEach(function (p) {
      if (!p || !(p.name || '').trim() || p === main) return;
      if (objects.some(function (o) { return o.name === p.name.trim().toUpperCase(); })) return;
      objects.push({ type: devObjectType(p.type), name: p.name.trim().toUpperCase(), status: 'existing', purpose: (p.description || '').trim() || 'Used by ' + main.name });
    });
    const frs = (s.reqs.frs || []).map(function (f, k) { return { f: f, id: F.frId(k) }; }).filter(function (x) { return V.isFilled(x.f); });
    const reqText = [(s.context.requirement || '').trim(),
      (s.process.currentLogic || '').trim() && 'Current logic of ' + main.name + ':\n' + s.process.currentLogic.trim()]
      .concat(frs.map(function (x) { return x.id + ' ' + (x.f.title || '').trim() + ((x.f.description || '').trim() ? ': ' + x.f.description.trim() : ''); })).filter(Boolean).join('\n\n');
    const acceptance = [];
    frs.forEach(function (x) { APB.markdown.helpers.splitLines(x.f.acceptance).forEach(function (a) { acceptance.push({ text: a }); }); });
    const rules = (s.reqs.rules || []).filter(V.isFilled).map(function (b) { return { condition: (b.rule || '').trim(), behavior: (b.outcome || '').trim() }; });
    const docRef = 'Source: functional specification ' + ([s.control.docId, s.control.version && 'v' + s.control.version].filter(Boolean).join(' ') || '"' + F.model.name(s) + '"') + '; current logic read from ' + main.name + ' (read-only).';
    return APB.state.migrate({
      project: { name: [s.control.docId, 'Change ' + main.name.trim().toUpperCase()].filter(Boolean).join(' · ') },
      types: [devType],
      requirement: { text: reqText, objective: APB.markdown.helpers.splitLines(s.context.objectives).join('; '), users: '', expectedOutput: '' },
      objects: objects.map(function (o) { o.id = S.uid(); o.detail = {}; return o; }),
      rules: rules.map(function (b) { b.id = S.uid(); return b; }),
      acceptance: acceptance.map(function (a) { a.id = S.uid(); return a; }),
      assumptions: docRef
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

  function rerenderStep1() {
    if (S.isFs() && !U().ui.generated && U().ui.step === 1 && !U().ui.view) U().renderMain();
  }

  function reviewDraft(text) {
    const r = APB.fsDraft.parse(text);
    if (!r.draft) { drf.error = r.error; rerenderStep1(); U().toast(r.error, 6000); return false; }
    const parts = APB.fsDraft.preview(S.get(), r.draft);
    if (!parts.length) { drf.error = ''; rerenderStep1(); U().toast('The draft adds nothing new – everything it proposes is already in the specification', 6000); return false; }
    drf.error = '';
    drf.pending = r.draft;
    drf.pendingKind = drf.kind || 'draft';
    document.getElementById('draft-list').innerHTML = parts.map(function (p) {
      const more = p.items.length > 4 ? '<li class="muted">… and ' + (p.items.length - 4) + ' more</li>' : '';
      return '<li><label class="check"><input type="checkbox" name="draft-part" value="' + esc(p.id) + '" checked> <strong>' + esc(p.label) + '</strong> <span class="count">' + p.items.length + '</span></label>' +
        '<ul class="small">' + p.items.slice(0, 4).map(function (i) { return '<li>' + esc(String(i).slice(0, 160)) + '</li>'; }).join('') + more + '</ul></li>';
    }).join('');
    const dlg = document.getElementById('draft-dialog');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    return true;
  }

  if (H.isVscode) {
    H.on('draft-progress', function (m) {
      const text = String(m.text || '').slice(0, 300);
      if (m.key) {
        const last = drf.log.filter(function (l) { return l.key === m.key; })[0];
        if (last) { last.text = text; last.status = m.status; } else drf.log.push({ key: m.key, text: text, status: m.status });
        if (drf.log.length > 80) drf.log.shift();
        const el = document.querySelector('.fs-prog .fs-log');
        if (el) el.outerHTML = draftLogHtml(); else rerenderStep1();
        return;
      }
      drf.status = text;
      const el = document.querySelector('.fs-draft-status');
      if (el && drf.running) el.textContent = drf.status; else rerenderStep1();
    });
    H.on('draft-result', function (m) {
      drf.running = false; drf.status = ''; drf.mode = '';
      drf.log.push({ text: 'Result received', status: 'done' });
      const answer = String(m.text || '');
      if (!reviewDraft(answer)) {
        U().ui.open['fs-draft-paste'] = true; rerenderStep1();
        const ta = document.getElementById('fs-draft-answer');
        if (ta) ta.value = answer;
      } else rerenderStep1();
    });
    H.on('draft-error', function (m) { drf.running = false; drf.status = ''; drf.error = String(m.message || 'Drafting failed').slice(0, 400); rerenderStep1(); });
  }

  function programNames() {
    return APB.storage.getPref('programNames', '').split(/[\s,;]+/).map(function (n) { return n.trim().toUpperCase(); }).filter(function (n) { return /^[A-Z0-9_\/]{2,40}$/.test(n); }).slice(0, 10);
  }

  function readProgram(mode) {
    const s = S.get();
    const names = programNames();
    if (!names.length) { U().toast('Name the program or transaction first'); return; }
    drf.running = true; drf.kind = 'program'; drf.mode = mode; drf.error = ''; drf.log = [];
    drf.status = mode === 'chat' ? 'Opening Copilot Chat…' : 'Reading ' + names.join(', ') + ' (read-only)…';
    H.post({ type: 'read-program', mode: mode, prompt: APB.fsDraft.programPrompt(s, names) });
    rerenderStep1();
  }

  const actions = {
    'fs-system': function (el) {
      const v = el.dataset.v;
      U().updateSteps(function (st) { st.context.system = st.context.system === v ? '' : v; });
      const s = S.get();
      U().toast(F.isSap(s) ? 'SAP – modules, transactions, RICEFW and SAP discovery are available' : s.context.system === 'other' ? 'Other system – SAP-specific fields are hidden' : s.context.system === 'tbd' ? 'Not decided yet – only the business view is asked' : 'No system selected');
    },
    'fs-quick': function () {
      const s = S.get();
      if (FC.checkMandatory(s).length) {
        U().ui.showErrors = true;
        U().renderMain();
        const bad = document.querySelector('[aria-invalid="true"]');
        if (bad) bad.focus();
        U().toast(mandatoryMsg(s));
        return;
      }
      U().ui.generated = true;
      U().renderMain();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    'fs-draft-copy': function () {
      const s = S.get();
      if ((s.context.requirement || '').trim().length < 10) { U().toast('Describe the business requirement first'); return; }
      Promise.resolve(APB.exporter.copy(APB.fsDraft.prompt(s))).then(function (ok) {
        U().ui.open['fs-draft-paste'] = true;
        rerenderStep1();
        U().toast(ok ? 'AI prompt copied ✓ Paste it into an AI chat your organisation allows, then paste the answer here' : 'Copy failed', 7000);
      });
    },
    'fs-draft-run': function () {
      const s = S.get();
      if ((s.context.requirement || '').trim().length < 10) { U().toast('Describe the business requirement first'); return; }
      drf.running = true; drf.kind = 'draft'; drf.mode = 'auto'; drf.error = ''; drf.status = 'Copilot is writing the specification…'; drf.log = [];
      H.post({ type: 'draft', prompt: APB.fsDraft.prompt(s) });
      rerenderStep1();
    },
    'fs-draft-chat': function () {
      const s = S.get();
      if ((s.context.requirement || '').trim().length < 10) { U().toast('Describe the business requirement first'); return; }
      drf.running = true; drf.kind = 'draft'; drf.mode = 'chat'; drf.error = ''; drf.status = 'Opening Copilot Chat…'; drf.log = [];
      H.post({ type: 'draft', mode: 'chat', prompt: APB.fsDraft.prompt(s) });
      rerenderStep1();
    },
    'fs-draft-stop': function () { if (drf.mode !== 'chat') H.post({ type: 'stop' }); drf.running = false; drf.mode = ''; drf.status = ''; rerenderStep1(); },
    'fs-prog-auto': function () { readProgram('auto'); },
    'fs-prog-chat': function () { readProgram('chat'); },
    'fs-prog-copy': function () {
      const names = programNames();
      if (!names.length) { U().toast('Name the program or transaction first'); return; }
      Promise.resolve(APB.exporter.copy(APB.fsDraft.programPrompt(S.get(), names))).then(function (ok) {
        U().ui.open['fs-draft-paste'] = true;
        rerenderStep1();
        U().toast(ok ? 'Prompt copied ✓ Paste it into Copilot Chat in VS Code (' + DS.cfg.agent + '), then paste the answer under Paste the AI answer' : 'Copy failed', 8000);
      });
    },
    'fs-dev-from-program': function () {
      const s = S.get();
      const dev = toDevSpecFromProgram(s);
      if (!dev) { U().toast('Read an existing program first'); return; }
      APB.specLink.stamp(dev, s, 'program');
      U().loadState(dev, 'Development spec created to change ' + mainProgram(s).name + ' — your FS is in Drafts');
    },
    'fs-chat-review': function () {
      const s = S.get();
      if (FC.checkMandatory(s).length) { U().toast(mandatoryMsg(s)); return; }
      H.post({ type: 'open-chat', agent: 'ask', prompt: FM.chatPrompt(s) });
      U().toast(autoSend() ? 'Copilot Chat is reviewing the specification – ask your questions there' : 'The specification is in Copilot Chat – press Enter to start the review', 6000);
    },
    'fs-draft-review': function () {
      const ta = document.getElementById('fs-draft-answer');
      // a pasted answer to the program prompt carries the program logic; anything else is a spec draft
      drf.kind = /"(currentLogic|programs)"\s*:/.test(ta ? ta.value : '') ? 'program' : 'draft';
      if (ta && reviewDraft(ta.value)) U().ui.open['fs-draft-paste'] = false;
    },
    'fs-draft-apply': function () {
      const ids = Array.prototype.map.call(document.querySelectorAll('#draft-list input[name="draft-part"]:checked'), function (i) { return i.value; });
      const dlg = document.getElementById('draft-dialog');
      if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
      if (!drf.pending || !ids.length) return;
      const r = APB.fsDraft.merge(S.get(), drf.pending, ids);
      const kind = drf.pendingKind;
      drf.pending = null;
      S.replace(r.state);
      if (kind === 'program') {
        // the program logic belongs to the current process: show it in step 2
        U().ui.step = 2;
        U().ui.open['fs-more-proc'] = true;
      } else if (r.added.length && !FC.checkMandatory(r.state).length) U().ui.generated = true;
      U().renderMain();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      U().toast(r.added.length ? 'Added ' + r.added.join(', ') + (kind === 'program' ? ' – see More details in this step' : ' – use Review Details to change anything') : 'Nothing new to add', 7000);
    },
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
      if (FC.checkMandatory(s).length) { U().toast(mandatoryMsg(s)); return; }
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
      APB.specLink.stamp(dev, s, 'ricefw', Number(el.dataset.i));
      U().loadState(dev, 'Development spec created from ' + F.ricefwIds(s.solution.ricefw)[Number(el.dataset.i)] + ' — your FS is in Drafts');
    },
    'fs-docx': function () {
      const s = S.get();
      if (FC.checkMandatory(s).length) { U().toast(mandatoryMsg(s)); return; }
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
    const cur = S.get();
    const list = F.steps.map(function (n) { return F.stepFor(n.n, cur); }).map(function (st) { return { g: 'Navigate', i: String(st.n), t: 'Step ' + st.n + ' · ' + st.title, run: function () { run.setStep(st.n); } }; });
    list.push(
      { g: 'Create', i: '✦', t: 'Generate functional specification', run: function () { run.setStep(3); run.actions.generate(); } },
      { g: 'Create', i: 'W', t: 'Download Word (.docx)', run: actions['fs-docx'] },
      { g: 'Create', i: '⬇', t: 'Download Markdown', run: run.actions.download },
      { g: 'Create', i: '⧉', t: 'Copy Markdown', run: run.actions.copy },
      { g: 'Create', i: '+', t: 'New functional specification', run: run.actions.new },
      { g: 'Create', i: '✦', t: 'Generate the whole spec with Copilot', run: function () { run.setStep(1); actions[H.isVscode ? 'fs-draft-run' : 'fs-draft-copy'](); } },
      { g: 'Create', i: '⚡', t: 'Create document now (quick start)', run: actions['fs-quick'] }
    );
    if (F.isSap(cur)) list.push({ g: 'System', i: '⌕', t: 'Read an existing program (logic into the spec)', run: function () { run.setStep(1); const el = document.getElementById('fs-prog-names'); if (el) el.focus(); } });
    if (H.isVscode) list.push(
      { g: 'Create', i: '›', t: 'Generate the spec in Copilot Chat', run: function () { run.setStep(1); actions['fs-draft-chat'](); } },
      { g: 'Create', i: '›', t: 'Open in Copilot Chat (review the FS)', run: actions['fs-chat-review'] }
    );
    if (F.isSap(cur)) list.push(
      { g: 'System', i: '›', t: H.isVscode ? 'Discover in SAP (automatic, read-only)' : 'Discover in SAP (open VS Code with ' + DS.cfg.agent + ')', run: function () { run.setStep(3); actions['fs-discover'](); } },
      { g: 'System', i: '⇩', t: 'Import context pack from clipboard', run: function () { run.setStep(3); actions['fs-import-clip'](); } }
    );
    list.push(
      { g: 'Create', i: '✓', t: 'Create UAT skeleton from FRs', run: function () { run.setStep(3); actions['fs-uat'](); } }
    );
    if (F.isSap(cur)) F.templates.list().forEach(function (t) { list.push({ g: 'Template', i: '◇', t: t.label, run: function () { run.setStep(1); actions['fs-template']({ dataset: { id: t.id } }); } }); });
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
    toDevSpecFromProgram: toDevSpecFromProgram,
    autoSend: function () { return autoSend(); },
    uatSkeleton: uatSkeleton
  };
})(window.APB = window.APB || {});
