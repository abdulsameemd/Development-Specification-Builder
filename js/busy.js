/* Busy overlay while Copilot works or the DEWA SAP system is read: what is happening (per job), a rotating line of
   what the agent does, the latest step reported by the tool loop, elapsed time, Stop and "Keep working" (hides the
   overlay into a small pill that reopens it). Only one job runs at a time (the panel refuses a second one). */
(function (APB) {
  'use strict';

  /* kind → title and what the agent does, shown in turn */
  const JOBS = {
    tsdraft: { title: 'AI is completing the Technical spec', sap: false, lines: [
      'Reading the functional spec extract, the requirement and the SAP facts…',
      'Filling the empty designer fields: logic, selection screen, output, parameters…',
      'Writing error handling, messages and test scenarios…',
      'Marking every SAP name it cannot find in the sources as [TO BE CONFIRMED]…'] },
    docs: { title: 'AI is reading your BRD and solution document', sap: true, lines: [
      'Extracting requirements, business rules and process steps…',
      'Reading the DEWA SAP system: checking the ABAP artifacts named in the documents (read-only)…',
      'Searching the DEWA SAP system by process: custom objects of the module, transactions, Fiori apps (read-only)…',
      'Reading the logic of existing programs, classes and function modules…',
      'Classifying the change: new development, enhancement or as-built…',
      'Drafting the functional specification and the RICEFW items…'] },
    program: { title: 'AI is reading DEWA SAP ABAP artifacts', sap: true, lines: [
      'Reading program source, includes and selection screen (read-only)…',
      'Following the function modules, classes, BAdIs and CDS views it calls…',
      'Collecting the tables it reads and writes and its authority checks…',
      'Describing the current logic in business words…'] },
    asis: { title: 'AI is building the AS-IS process from the DEWA SAP system', sap: true, lines: [
      'Reading the existing objects in the DEWA SAP system (read-only)…',
      'Finding the transactions, apps, jobs and interfaces around them…',
      'Ordering the business steps and roles…',
      'Marking the manual work and pain points…'] },
    tobe: { title: 'AI is designing the TO-BE process', sap: false, lines: [
      'Reviewing the AS-IS steps and their pain points…',
      'Applying the business requirement and scope…',
      'Marking each step as unchanged, changed, new or automated…',
      'Drawing the proposed flow…'] },
    draft: { title: 'AI is writing the functional specification', sap: false, lines: [
      'Reading your business requirement…',
      'Drafting objectives, scope and the process…',
      'Writing functional requirements with acceptance criteria…',
      'Adding business rules, data, test scenarios and risks…'] },
    discovery: { title: 'Discovering the DEWA SAP system', sap: true, lines: [
      'Searching transactions and Fiori apps for the process (read-only)…',
      'Checking the tables, CDS views and classes named in the spec…',
      'Comparing proposed new names with the system…',
      'Building the SAP context pack…'] },
    devctx: { title: 'AI is checking objects in the DEWA SAP system', sap: true, lines: [
      'Checking every object name in the system (read-only)…',
      'Reading table fields and keys, CDS elements and method signatures…',
      'Collecting where-used and the current logic…',
      'Preparing the reference check for your review…'] }
  };

  let el = null, pill = null, job = null, rot = null, tick = null, steps = 0, started = 0, lineIdx = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mmss(ms) { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'busy';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'busy-title');
    el.hidden = true;
    el.innerHTML = '<div class="busy-card"><div class="busy-orb" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '<div class="busy-body"><p class="busy-kicker"></p><h2 id="busy-title"></h2>' +
      '<p class="busy-line" aria-live="polite"></p><p class="busy-step"></p>' +
      '<div class="busy-meta"><span class="busy-time">0:00</span><span class="busy-count"></span></div>' +
      '<div class="busy-actions"><button type="button" class="btn btn-ghost btn-sm" data-busy="hide">Keep working</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-busy="finish" title="No more SAP calls – Copilot writes the answer from what it has read so far">Finish now</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-busy="stop">Stop</button></div></div></div>';
    document.body.appendChild(el);
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'busy-pill';
    pill.hidden = true;
    pill.innerHTML = '<span class="busy-dot" aria-hidden="true"></span><span class="busy-pill-text"></span>';
    document.body.appendChild(pill);
    el.addEventListener('click', function (e) {
      const b = e.target.closest('[data-busy]');
      if (!b || !job) return;
      if (b.dataset.busy === 'hide') minimize();
      if (b.dataset.busy === 'finish' && !job.finishing) {
        // the extension stops calling SAP tools; the job then writes its answer from what was read
        job.finishing = true;
        if (APB.host && APB.host.post) APB.host.post({ type: 'finish-now' });
        audit('ai-finish-now', { job: job.kind });
        job.last = 'Finishing with what was read so far…';
        render();
      }
      if (b.dataset.busy === 'stop') { const stop = job.onStop; done('stopped'); if (stop) stop(); }
    });
    pill.addEventListener('click', function () { if (job) { pill.hidden = true; el.hidden = false; } });
  }

  function minimize() { el.hidden = true; pill.hidden = false; }

  function render() {
    if (!job) return;
    const cfg = job.cfg;
    el.querySelector('.busy-kicker').textContent = job.chat ? 'Copilot Chat' : cfg.sap ? 'GitHub Copilot · DEWA SAP system (read-only)' : 'GitHub Copilot';
    el.querySelector('#busy-title').textContent = job.chat ? cfg.title.replace(/^AI is/, 'Copilot Chat is') : cfg.title;
    el.querySelector('.busy-line').textContent = job.chat ? 'Follow it in Copilot Chat – the result comes back here for your review.' : cfg.lines[lineIdx % cfg.lines.length];
    el.querySelector('.busy-step').innerHTML = job.last ? '<span aria-hidden="true">›</span> ' + esc(job.last) : '';
    el.querySelector('.busy-count').textContent = steps ? steps + ' step' + (steps > 1 ? 's' : '') : '';
    el.querySelector('[data-busy="stop"]').textContent = job.chat ? 'Stop waiting' : 'Stop';
    const fin = el.querySelector('[data-busy="finish"]');
    fin.hidden = job.chat || !cfg.sap || !(APB.host && APB.host.isVscode); // only automatic jobs that read SAP in VS Code
    fin.disabled = !!job.finishing;
    pill.querySelector('.busy-pill-text').textContent = cfg.title.replace(/^AI is /, '').replace(/^\w/, function (c) { return c.toUpperCase(); }) + '…';
  }

  /* kind: a JOBS key · mode: 'auto' | 'chat' · onStop: what Stop does (the job's own stop action) */
  function start(kind, mode, onStop) {
    build();
    const cfg = JOBS[kind] || JOBS.draft;
    if (job) done('replaced');
    job = { kind: kind, cfg: cfg, chat: mode === 'chat', onStop: onStop, last: '', model: '' };
    audit('ai-start', { job: kind, mode: mode === 'chat' ? 'Copilot Chat' : 'automatic', sapRead: cfg.sap ? 'read-only' : 'no' });
    steps = 0; lineIdx = 0; started = Date.now();
    clearInterval(rot); clearInterval(tick);
    rot = setInterval(function () { lineIdx++; render(); }, 3800);
    tick = setInterval(function () { el.querySelector('.busy-time').textContent = mmss(Date.now() - started); }, 1000);
    el.querySelector('.busy-time').textContent = '0:00';
    el.hidden = false; pill.hidden = true;
    el.classList.toggle('busy-chat', job.chat);
    render();
  }

  /* a progress line from the tool loop (tool calls, model, info) */
  function progress(text, status) {
    if (!job || !text) return;
    job.last = String(text).slice(0, 160);
    if (/^Model /.test(job.last)) job.model = job.last.replace(/^Model /, '').split(' · ')[0];
    if (status === 'done' || status === 'running') steps = Math.max(steps, status === 'running' ? steps + 1 : steps);
    render();
  }

  /* outcome: result | error | stopped | reset | replaced (recorded in the audit trail) */
  /* extra: token / artifact usage of the job (APB.guard.usageAudit) */
  function done(outcome, extra) {
    if (job) audit('ai-end', Object.assign({ job: job.kind, outcome: outcome || 'closed', seconds: Math.round((Date.now() - started) / 1000), steps: steps, model: job.model }, extra || {}));
    job = null;
    clearInterval(rot); clearInterval(tick);
    if (el) el.hidden = true;
    if (pill) pill.hidden = true;
  }

  function audit(type, data) { if (APB.ui && APB.ui.auditAdd) APB.ui.auditAdd(type, data); }

  APB.busy = { start: start, progress: progress, done: done, isOpen: function () { return !!job; }, JOBS: JOBS };
})(window.APB = window.APB || {});
