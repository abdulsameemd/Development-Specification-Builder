/* "Agents" info page: how the DEWA backend agents work in VS Code.
   Content mirrors docs/AGENT_WORKFLOWS.md; the Mermaid charts there are redrawn as inline SVG / HTML so the
   page works offline. The agent files under agents/ and AGENTS.md remain the source of truth. */
(function (APB) {
  'use strict';

  function kw(t) { return '<span class="kw">' + t + '</span>'; }
  function agent(t) { return '<code class="agent-name">' + t + '</code>'; }
  function flow(steps) {
    return '<ol class="pipe">' + steps.map(function (s, i) { return '<li><span class="pipe-n">' + (i + 1) + '</span>' + s + '</li>'; }).join('') + '</ol>';
  }
  function steps(list) { return '<ol class="ag-steps">' + list.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'; }
  function bullets(list) { return '<ul class="ag-list">' + list.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>'; }

  /* "How to choose" decision chart (redrawn from the Mermaid flowchart). */
  function chooser() {
    function box(x, y, w, h, lines, cls) {
      const cy = y + h / 2 - (lines.length - 1) * 9;
      return '<g class="' + cls + '"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12"/>' +
        lines.map(function (l, i) { return '<text x="' + (x + w / 2) + '" y="' + (cy + i * 18) + '">' + l + '</text>'; }).join('') + '</g>';
    }
    function diamond(cx, cy, w, h, label) {
      return '<g class="fc-q"><polygon points="' + cx + ',' + (cy - h / 2) + ' ' + (cx + w / 2) + ',' + cy + ' ' + cx + ',' + (cy + h / 2) + ' ' + (cx - w / 2) + ',' + cy + '"/>' +
        '<text x="' + cx + '" y="' + cy + '">' + label + '</text></g>';
    }
    function arrow(d) { return '<path class="fc-edge" d="' + d + '" marker-end="url(#fcArrow)"/>'; }
    function label(x, y, t) { return '<text class="fc-label" x="' + x + '" y="' + y + '">' + t + '</text>'; }
    return '<div class="fc-wrap"><svg class="fc" viewBox="0 0 960 470" role="img" aria-labelledby="fc-title fc-desc">' +
      '<title id="fc-title">Which agent should I use?</title>' +
      '<desc id="fc-desc">Adobe Form, SFP or ADS work: use dewa-adobeagent, graphical layout is done in Adobe LiveCycle Designer. Otherwise, if the code does not exist yet, use dewa-abap, one artifact at a time. If the code already exists, use dewa-codereview: review first, fixes require the defined confirmation flow.</desc>' +
      '<defs><marker id="fcArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z"/></marker></defs>' +
      box(330, 10, 300, 46, ['What are you working on?'], 'fc-start') +
      arrow('M480 56 V82') +
      diamond(480, 122, 320, 74, 'Adobe Form / SFP / ADS?') +
      arrow('M320 122 H180 V196') + label(250, 110, 'Yes') +
      arrow('M640 122 H700 V191') + label(672, 110, 'No') +
      box(40, 200, 280, 56, ['dewa-adobeagent'], 'fc-agent') +
      arrow('M180 256 V296') +
      box(40, 300, 280, 60, ['Graphical layout work is done', 'in Adobe LiveCycle Designer'], 'fc-note') +
      diamond(700, 232, 340, 74, 'Is the code already present?') +
      arrow('M700 269 V292 H590 V326') + label(612, 278, 'No · create new') +
      arrow('M700 292 H830 V326') + label(812, 278, 'Yes · inspect / fix') +
      box(490, 330, 200, 52, ['dewa-abap'], 'fc-agent') +
      box(730, 330, 200, 52, ['dewa-codereview'], 'fc-agent') +
      arrow('M590 382 V402') + arrow('M830 382 V402') +
      box(490, 405, 200, 52, ['One artifact at a time'], 'fc-note') +
      box(730, 405, 200, 52, ['Review first; fixes need', 'the confirmation flow'], 'fc-note') +
      '</svg></div>';
  }

  function html() {
    return '<div class="ag">' +
      '<div class="ag-head"><button type="button" class="btn btn-ghost btn-sm" data-action="close-info">← Back to the builder</button></div>' +
      '<p class="step-count">Info</p><h2 class="step-title">DEWA Agent Workflows</h2>' +
      '<p class="muted">A practical guide to choosing and working with the DEWA backend agents in VS Code. The source of truth for exact rules remains each agent file under <code>agents/</code> and the shared router in <code>AGENTS.md</code>.</p>' +

      '<nav class="ag-toc" aria-label="On this page">' + [['ag-glance', 'At a glance'], ['ag-choose', 'How to choose'], ['ag-session', 'Session pattern'], ['ag-abap', 'dewa-abap'], ['ag-review', 'dewa-codereview'], ['ag-adobe', 'dewa-adobeagent'], ['ag-vsix', 'VS Code extension'], ['ag-compare', 'Comparison'], ['ag-files', 'Source files']]
        .map(function (l) { return '<a href="#' + l[0] + '" data-action="info-jump" data-id="' + l[0] + '">' + l[1] + '</a>'; }).join('') + '</nav>' +

      '<section id="ag-glance" class="ag-sec"><h3>At a glance</h3><div class="ag-cards">' +
      card('dewa-abap', 'Build', 'Building new ABAP, CDS, RAP or CAP backend artifacts', 'One new/changed artifact at a time, with tests and validation status', 'Type ' + kw('CONFIRM ARTEFACT') + ' before the next artifact') +
      card('dewa-codereview', 'Review', 'Reviewing or safely improving existing ABAP, CDS, RAP or CAP code', 'Full review report, findings, safe fixes and optionally an as-built technical specification', 'Answer Y/N for flagged changes; type ' + kw('CONFIRM REVIEW') + ' before handoff') +
      card('dewa-adobeagent', 'Forms', 'Building or maintaining SAP Adobe Forms and their ABAP integration', 'Form interface, form object/context, data provider or driver, and validation evidence', 'One artifact at a time; no named confirmation keyword in this agent') +
      '</div><p class="ag-callout">All three agents are backend-focused and use the <strong>ADT MCP server</strong> for SAP repository operations where available. They do <strong>not</strong> replace target-system authorization, SAP activation, ATC, ABAP Unit, Basis/ADS checks, or required technical approvals.</p></section>' +

      '<section id="ag-choose" class="ag-sec"><h3>How to choose</h3>' + chooser() +
      '<p class="muted">The agents are separate entry points, not a dependency chain. A typical handoff is optional: build with ' + agent('dewa-abap') + ', then review the result with ' + agent('dewa-codereview') + '; for an Adobe Form, use ' + agent('dewa-adobeagent') + ' for ABAP/form-contract work and LiveCycle Designer for graphical layout.</p></section>' +

      '<section id="ag-session" class="ag-sec"><h3>Shared session pattern</h3>' +
      '<p>Before SAP backend changes, establish the target and inspect the local context. The exact checklist depends on the agent, but commonly includes the target system/release, package/software component, ABAP language version, existing objects, test coverage, transport context and the functional requirement. Do not guess system facts or claim checks that were not run.</p>' +
      flow(['Select the matching agent', 'Read the relevant project requirement and existing objects', 'Confirm target, package, language version and scope', 'Make the smallest in-scope change', 'Run available activation, tests and static checks', 'Report evidence and unresolved prerequisites', 'Stop at that agent\'s approval boundary']) +
      '<p class="ag-callout">In the ADT virtual workspace, repository files may be virtual. Follow the agent\'s directory-first navigation instructions and use the ADT MCP server for SAP operations. A file edit alone does not prove that an SAP object activated or passed tests/ATC.</p></section>' +

      '<section id="ag-abap" class="ag-sec ag-agent"><h3>' + agent('dewa-abap') + ' — build new backend work</h3>' +
      '<p>Use for new backend implementation: ABAP classes, CDS, RAP, CAP and related service artifacts. The agent treats <code>BUSINESS_REQUIREMENTS.md</code> as the requirement source when present and follows the project\'s target and package rules.</p>' +
      '<h4>Build flow</h4>' + steps([
        'Confirm target/release, tier, backend model, OData version, draft requirement, entity structure, package, language version and existing repository context. Use applicable DEWA defaults rather than repeatedly asking for already-confirmed defaults.',
        'For approved cloud-ready development, check the assigned <code>ZS4DEWA_CLOUD</code> software component and approved <code>ZCLOUD_ROOT</code>/module package. Otherwise follow the project package convention. Never assume package assignment without target context.',
        'Choose the implementation path: <strong>RAP</strong> for new transactional OData V4 business objects · <strong>CAP</strong> for BTP side-by-side applications · <strong>standalone OO ABAP</strong> only for suitable non-RAP business logic.',
        'For RAP, follow the declared dependency order (below).',
        'Create one artifact, validate it, and present its result before proceeding. Do not batch the generation order.',
        'Add the required unit-test stub with each handler/service. Run unit tests after source changes using the ADT MCP server where available. Activate changed development objects as part of the authorized development workflow; report failures or unavailable checks.',
        'Run the applicable target-mandated ATC/Clean Core checks in ADT. Report the actual variant and result; do not claim a pass without tool evidence.',
        'Present the artifact, changes, activation/test/ATC evidence and open items. Stop until the developer types the exact keyword ' + kw('CONFIRM ARTEFACT') + ' before creating the next artifact.'
      ]) +
      '<h4>RAP dependency order</h4>' +
      flow(['Persistence table', 'Draft table <em>(only when explicitly required)</em>', 'Interface / root / projection CDS', 'Metadata extension &amp; access control', 'Interface / projection behavior definitions', 'Behavior implementation &amp; tests', 'Service definition', 'Service binding']) +
      '<h4>Important boundaries</h4>' + bullets([
        'No unrequested RAP draft behavior.',
        'Do not use <code>COMMIT WORK</code> for RAP; use RAP transaction handling and EML as required.',
        'Use released APIs for ABAP Cloud. If release status is unknown, stop before depending on the object from Cloud code.',
        'Do not directly change production, release transports, or import transports without required explicit approval.',
        'Review for Clean Core and security evidence through the target system/ATC, not code appearance alone.'
      ]) + '</section>' +

      '<section id="ag-review" class="ag-sec ag-agent"><h3>' + agent('dewa-codereview') + ' — review existing code</h3>' +
      '<p>Use for code that already exists when the task is to inspect quality, refactor safely, modernize or optimize. It is not the primary agent for creating a new application from scratch.</p>' +
      '<h4>Review and fix flow</h4>' + steps([
        'Select one object. Read its source and tests. Review the full object before presenting findings; do not stream partial results.',
        'Analyze the object across performance (<code>PERF</code>), style (<code>STY</code>), security (<code>SEC</code>), modernization/Clean Core and performance optimization checks.',
        'Present the complete review report before changing anything. Review is read-only until the developer confirms fixes.',
        'Safe, behavior-preserving fixes may be applied according to the agent rules. Present flagged or behavior-affecting suggestions and obtain a clear <strong>Y/N</strong> decision before applying them.',
        '<strong>Never auto-fix security findings.</strong> Report them for remediation. Critical security findings block handoff; escalate the specified critical authorization concern to the security owner.',
        'After fixes, activate the object, rerun ABAP Unit tests and run ATC when available. Confirm no new violations; report anything not run.',
        'Always show the complete review report in chat; this is the guaranteed delivery path for developers working in an ADT virtual workspace.',
        'Offer an optional Desktop copy with a <code>cmd.exe</code> command, e.g. <code>notepad "%USERPROFILE%\\Desktop\\review_report_zcl_fi_invoice_processor.md"</code>. The developer runs it, copies the report from chat into Notepad and saves. Never claim the file was saved unless the developer confirms it.',
        'Stop at the review gate. The developer must type ' + kw('CONFIRM REVIEW') + ' before handoff and generation of the as-built technical specification.',
        'After confirmation, generate the technical specification from actual changes and validation evidence, show it in chat and offer a similar Desktop-save command. Do not invent test, ATC, activation or performance results.'
      ]) +
      '<p class="ag-callout">The agent must not attempt to create report files inside the ADT virtual workspace; it has no local file storage.</p>' +
      '<h4>Review output categories</h4><div class="ag-cats">' +
      cat('Auto-fixed', 'ok', 'Safe behavior-preserving changes made, with locations and rationale.') +
      cat('Flagged', 'warn', 'Changes that need a developer decision, including behavior risk.') +
      cat('Security', 'sec', 'Findings are report-only and never auto-fixed.') +
      cat('Performance', 'perf', 'Recommendations; measure uncertain/high-impact changes with approved runtime or SQL analysis rather than guessing.') +
      '</div></section>' +

      '<section id="ag-adobe" class="ag-sec ag-agent"><h3>' + agent('dewa-adobeagent') + ' — Adobe Forms and ABAP integration</h3>' +
      '<p>Use for SFP/ADS form interfaces and objects, form context, ABAP data providers/drivers, output integration and PDF-render troubleshooting. It owns the ABAP side and form contract. Graphical XDP layout changes belong in Adobe LiveCycle Designer.</p>' +
      '<h4>Form delivery flow</h4>' + steps([
        'Confirm document type, trigger, data source and keys, output channel, language/country needs, existing reusable form objects and interface type. Dictionary-based is the default for ABAP callers; ask explicitly before choosing XML Schema-based.',
        'Design the contract and objects separately: a form interface, a form object/context, a LiveCycle layout inside the form, and a caller implemented as a thin driver plus a testable data provider where applicable.',
        'Generate in order, one artifact at a time (below). Do not collapse these contracts into one artifact.',
        'Keep data selection and display formatting in the data provider. Keep the driver thin. Resolve the generated form function-module name at runtime; do not hardcode the generated name.',
        'Run the applicable data-provider ABAP Unit tests, activation, ATC, SFP preview and end-to-end render checks where the environment permits. Confirm PDF output and ADS connectivity when required. Keep <code>FP_JOB_CLOSE</code> guaranteed on errors.',
        'Report exactly which checks passed and which could not be run. Do not mark the task complete based only on ABAP activation if form binding, rendering or delivery is still unverified.',
        'Clearly identify remaining work outside the agent, such as LiveCycle Designer layout updates, ADS/Basis prerequisites or print destination setup.'
      ]) +
      '<h4>Generation order</h4>' + flow(['Form interface → activate', 'Form / context → activate', 'Driver / data provider → activate']) +
      '<h4>Form-specific boundaries</h4>' + bullets([
        'Preserve transported interface parameters; add optional parameters rather than removing or retyping contract fields.',
        'Do not put database reads or business logic in form code initialization.',
        'Format amounts, dates, units, addresses and translated display text in ABAP before the form consumes it.',
        'Treat customer, financial and tax data as sensitive. Do not use real production data in examples or committed fixtures.',
        'Do not invent ADS destinations, printers, SAP object names or render results.'
      ]) + '</section>' +

      '<section id="ag-vsix" class="ag-sec"><h3>VS Code extension distribution</h3>' +
      '<p>The VS Code extension is a delivery mechanism for the agent files; it does not create a runtime dependency between agents.</p>' +
      flow(['Source agents in <code>agents/</code>', '<code>build-kit.js</code> copies <code>*.agent.md</code>', 'Generated <code>vscode-extension/kit/</code>', 'VSIX package', 'VS Code extension activates', 'Copies agent files to the user prompts folder', 'Developer selects an agent in Chat']) +
      bullets([
        'The extension bundles <code>agents/*.agent.md</code> into <code>vscode-extension/kit/</code> during packaging.',
        'On startup, <code>extension.js</code> copies bundled agent files into <code>%APPDATA%\\Code\\User\\prompts</code> when <code>dewaAbapAgent.autoInstall</code> is enabled.',
        'Agent copies refresh when the extension version changes. The reinstall command can copy them again manually.',
        '<code>skills/</code> and the root <code>AGENTS.md</code> router belong to the repository-level kit workflow; the VS Code extension package bundles and installs agents only.',
        'Installing files makes agents available; it does not auto-select an agent, connect to SAP by itself, or validate ABAP code.'
      ]) + '</section>' +

      '<section id="ag-compare" class="ag-sec"><h3>Quick comparison</h3><div class="table-scroll"><table class="ag-table"><thead><tr><th>Concern</th><th>' + agent('dewa-abap') + '</th><th>' + agent('dewa-codereview') + '</th><th>' + agent('dewa-adobeagent') + '</th></tr></thead><tbody>' +
      row('Main task', 'Build new backend artifacts', 'Review/fix existing backend objects', 'Build/maintain Adobe Forms and ABAP integration') +
      row('Primary focus', 'RAP/CAP/CDS/ABAP implementation', 'PERF/STY/SEC and safe refactoring', 'Form contract, data provider, driver, output/render') +
      row('Work unit', 'One artifact at a time', 'One object at a time', 'One form artifact at a time') +
      row('Human gate', kw('CONFIRM ARTEFACT') + ' between artifacts', 'Y/N for flagged fixes, then ' + kw('CONFIRM REVIEW'), 'Sequential artifact workflow; no named keyword in the agent file') +
      row('Specialized manual work', 'SAP system activation/ATC/tests', 'Security owner sign-off for critical findings', 'Adobe LiveCycle Designer and possible Basis/ADS work') +
      '</tbody></table></div></section>' +

      '<section id="ag-files" class="ag-sec"><h3>Source files</h3>' + bullets([
        '<code>AGENTS.md</code> — repository-level router and shared process rules.',
        '<code>agents/dewa-abap.agent.md</code> — new backend development.',
        '<code>agents/dewa-codereview.agent.md</code> — existing-code review/refactor/optimization.',
        '<code>agents/dewa-adobeagent.agent.md</code> — Adobe Forms and ABAP-side delivery.',
        '<code>vscode-extension/extension.js</code> — agent installation into the VS Code user profile.',
        '<code>vscode-extension/scripts/build-kit.js</code> — packaging source agents into the extension bundle.'
      ]) + '</section>' +
      '<div class="nav-row"><button type="button" class="btn btn-primary" data-action="close-info">← Back to the builder</button></div>' +
      '</div>';
  }

  function card(name, tag, choose, output, gate) {
    return '<article class="ag-card"><div class="ag-card-head">' + agent(name) + '<span class="ag-tag">' + tag + '</span></div>' +
      '<dl><dt>Choose it for</dt><dd>' + choose + '</dd><dt>Main output</dt><dd>' + output + '</dd><dt>User checkpoint</dt><dd>' + gate + '</dd></dl></article>';
  }
  function cat(title, cls, text) { return '<div class="ag-cat ag-cat-' + cls + '"><strong>' + title + '</strong><span>' + text + '</span></div>'; }
  function row(h, a, b, c) { return '<tr><th scope="row">' + h + '</th><td>' + a + '</td><td>' + b + '</td><td>' + c + '</td></tr>'; }

  APB.agentsGuide = { html: html };
})(window.APB = window.APB || {});
