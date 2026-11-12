/* Governance: approval gates and the audit trail (mandatory, on by default).
   - Policy: comes from VS Code settings through the extension (dewaSpecBuilder.approvers.functional / .technical,
     dewaSpecBuilder.gates "enforce" | "warn", dewaSpecBuilder.gates.requireSapCheck); IT can set and lock them.
     In a plain browser there is no signed-in identity: nobody can approve and the gates only warn.
   - Approval: { by, at, version, hash }. hash is a fingerprint of the spec content, so any change after approval makes
     the approval invalid and closes the gate again.
   - Gates: G1 FS approved → Technical specs can be created; G2 TS approved → dewa-abap may build from it.
   - Audit: append-only entries { at, by, type, data } kept with the spec, shown in the document and (VS Code)
     written to .dewa/audit/<spec-id>.jsonl in the workspace.
   Limit: approvals live in the user's local storage; they are recorded, not tamper-proof (see SECURITY.md). */
(function (APB) {
  'use strict';
  const H = APB.host;
  const MAX_AUDIT = 500;
  const pol = { gates: 'enforce', requireSapCheck: true, approvers: { functional: [], technical: [] } };
  const who = { account: '', signedIn: false, known: false };

  function setFromAuth(m) {
    who.account = String((m && m.account) || '');
    who.signedIn = !!(m && m.signedIn);
    who.known = true;
    const p = (m && m.policy) || {};
    pol.gates = p.gates === 'warn' ? 'warn' : 'enforce';
    if (APB.guard) APB.guard.setPolicy(p);
    pol.requireSapCheck = p.requireSapCheck !== false;
    ['functional', 'technical'].forEach(function (k) {
      const list = p.approvers && Array.isArray(p.approvers[k]) ? p.approvers[k] : [];
      pol.approvers[k] = list.map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 100);
    });
  }

  function kindOf(s) { return s && s.kind === 'fs' ? 'functional' : 'technical'; }
  function mode() { return H.isVscode ? pol.gates : 'warn'; }
  function account() { return who.signedIn ? who.account : ''; }
  function approvers(kind) { return pol.approvers[kind].slice(); }
  function canApprove(kind) {
    if (!H.isVscode || !who.signedIn || !who.account) return false;
    const me = who.account.toLowerCase();
    return pol.approvers[kind].some(function (a) { return a.toLowerCase() === me; });
  }

  /* ------------------------------------------------------------- fingerprint */
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function fnv(str) {
    // two FNV-1a 32-bit hashes with different seeds → 16 hex characters (change detection, not cryptography)
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
      b ^= c; b = Math.imul(b, 0x01000193 + 2) >>> 0;
    }
    return ('0000000' + a.toString(16)).slice(-8) + ('0000000' + b.toString(16)).slice(-8);
  }
  /* Content only: identity, timestamps, approval, audit and the FS's own approval bookkeeping are left out. */
  function contentOf(s) {
    const c = JSON.parse(JSON.stringify(s || {}));
    ['id', 'key', 'meta', 'approval', 'audit', 'source'].forEach(function (k) { delete c[k]; });
    if (c.control) { delete c.control.status; delete c.control.approvals; }
    return c;
  }
  function fingerprint(s) { return fnv(canonical(contentOf(s))); }

  /* ------------------------------------------------------------- approval */
  /* → { state: 'none' | 'approved' | 'changed', approval } */
  function status(s) {
    const a = s && s.approval;
    if (!a || !a.hash) return { state: 'none', approval: null };
    return { state: a.hash === fingerprint(s) ? 'approved' : 'changed', approval: a };
  }

  /* TS only: what still blocks an approval (the SAP check must have run, without unresolved ✗). */
  function approvalBlockers(s) {
    if (kindOf(s) !== 'technical' || !pol.requireSapCheck) return [];
    if (!s.sapCheck) return ['Run Check & read in SAP (step 3) first.'];
    const q = APB.devSap ? APB.devSap.questions(s) : [];
    return q.length ? ['Resolve the SAP check findings first: ' + q[0] + (q.length > 1 ? ' (+' + (q.length - 1) + ' more)' : '')] : [];
  }

  /* Returns the approved copy of s (does not change s). */
  function approve(s) {
    // normalise first: the state is migrated again when it is stored, and the fingerprint must survive that
    const copy = JSON.parse(JSON.stringify(s));
    const mig = copy.kind === 'fs' ? APB.fs && APB.fs.model && APB.fs.model.migrate : APB.state && APB.state.migrate;
    const next = mig ? mig(copy) : copy;
    const kind = kindOf(next);
    const at = new Date().toISOString();
    if (kind === 'functional') {
      next.control = next.control || {};
      next.control.status = 'approved';
      next.control.approvals = (next.control.approvals || []).concat([{ role: 'Approver', name: account(), date: at.slice(0, 10), decision: 'Approved' }]);
    }
    next.approval = { by: account(), at: at, version: (next.control && next.control.version) || '', hash: '' };
    next.approval.hash = fingerprint(next);
    return next;
  }

  /* The open approval request: the last 'approval-requested' entry with no approval after it, while not approved. */
  function requestOf(s) {
    if (!s || status(s).state === 'approved') return null;
    const list = Array.isArray(s.audit) ? s.audit : [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === 'approved') return null;
      if (list[i].type === 'approval-requested') return list[i];
    }
    return null;
  }

  /* gate: 'G1' (FS → Technical specs) | 'G2' (TS → dewa-abap) → { open, reason } */
  function gate(name, s) {
    const st = status(s);
    if (st.state === 'approved') return { open: true, reason: '' };
    const what = name === 'G1' ? 'The functional spec' : 'The technical spec';
    return { open: false, reason: st.state === 'changed' ? what + ' changed after it was approved – it needs approval again.' : what + ' is not approved yet.' };
  }

  /* ------------------------------------------------------------- audit */
  function add(s, type, data) {
    if (!s) return null;
    const e = { at: new Date().toISOString(), by: account() || (H.isVscode ? 'not signed in' : 'browser'), type: String(type), data: data || {} };
    s.audit = Array.isArray(s.audit) ? s.audit : [];
    s.audit.push(e);
    if (s.audit.length > MAX_AUDIT) {
      const cut = s.audit.length - MAX_AUDIT + 1;
      const dropped = s.audit.splice(0, cut);
      s.audit.unshift({ at: dropped[dropped.length - 1].at, by: 'system', type: 'trimmed', data: { entries: cut, from: dropped[0].at } });
    }
    if (APB.guard) APB.guard.record(e);
    if (H.isVscode) H.post({ type: 'audit', specId: String(s.id || ''), kind: kindOf(s), title: specName(s), entry: e });
    return e;
  }
  function specName(s) {
    if (!s) return '';
    if (s.kind === 'fs') return String((s.context && (s.context.title || s.context.requirement)) || '').split('\n')[0].slice(0, 80);
    return String((s.project && s.project.name) || (s.requirement && s.requirement.text) || '').split('\n')[0].slice(0, 80);
  }
  function normalizeAudit(list) {
    return (Array.isArray(list) ? list : []).filter(function (e) { return e && typeof e === 'object' && e.at && e.type; }).slice(-MAX_AUDIT).map(function (e) {
      return { at: String(e.at).slice(0, 40), by: String(e.by || '').slice(0, 100), type: String(e.type).slice(0, 40), data: e.data && typeof e.data === 'object' ? JSON.parse(JSON.stringify(e.data)) : {} };
    });
  }
  function normalizeApproval(a) {
    if (!a || typeof a !== 'object' || !a.hash) return null;
    return { by: String(a.by || '').slice(0, 100), at: String(a.at || '').slice(0, 40), version: String(a.version || '').slice(0, 20), hash: String(a.hash).slice(0, 32) };
  }

  /* Markdown table of the trail (newest last), for the documents. */
  const LABELS = {
    'ai-start': 'AI job started', 'ai-input': 'AI input', 'ai-end': 'AI job finished', 'ai-finish-now': 'Finish now pressed', review: 'AI result reviewed', approved: 'Approved',
    'approval-requested': 'Approval requested', 'gate-blocked': 'Gate blocked', 'gate-override': 'Gate overridden', handoff: 'Handed over', 'created-from': 'Created from',
    export: 'Exported', uploaded: 'Uploaded', 'example-loaded': 'Example loaded', trimmed: 'Older entries summarised', masked: 'Personal data masked', 'guard-flag': 'Guardrail warning'
  };
  /* Readable details per event (the raw data stays in the spec and in .dewa/audit/*.jsonl). */
  const JOBS = { docs: 'Read BRD / solution document', program: 'Read existing objects', asis: 'AS-IS process', tobe: 'TO-BE process',
    draft: 'Generate FS', discovery: 'System discovery', devctx: 'Check & read in SAP', clipboard: 'Prompt copied',
    // message types of the prompts (masking happens when a prompt is sent)
    'read-program': 'Copilot job reading SAP', 'read-dev': 'Check & read in SAP', discover: 'System discovery', 'open-chat': 'Copilot Chat' };
  const OUTCOMES = { result: 'result received', error: 'failed', stopped: 'stopped by the user', reset: 'cancelled (new spec opened)', replaced: 'replaced by another job', closed: 'closed' };
  function num(v) { return Number(v || 0).toLocaleString('en'); }
  function list(v) { return Array.isArray(v) ? v.join(', ') : String(v || ''); }
  function job(d) { return JOBS[d.job] || String(d.job || ''); }
  /* review part ids (frs, rules, objects …) → the names shown in the review dialog */
  function parts(ids) {
    const P = (APB.fsDraft && APB.fsDraft.PARTS) || [];
    return [].concat(ids || []).map(function (id) {
      const p = P.filter(function (x) { return x.id === id; })[0];
      return p ? p.label.replace(/\s*\(.*\)$/, '') : String(id);
    });
  }
  function tokens(d) {
    const i = Number(d.tokensIn || 0), o = Number(d.tokensOut || 0);
    return i + o ? (d.tokensEstimated ? '≈ ' : '') + num(i + o) + ' tokens (' + num(i) + ' in / ' + num(o) + ' out)' : '';
  }
  const DETAIL = {
    'ai-start': function (d) { return [job(d), d.mode, d.sapRead === 'read-only' ? 'reads SAP read-only' : ''].filter(Boolean).join(' · '); },
    'ai-end': function (d) {
      return [job(d) + ': ' + (OUTCOMES[d.outcome] || d.outcome || ''), d.seconds !== undefined ? d.seconds + ' s' : '', d.model ? 'model ' + d.model : '',
        d.modelCalls ? d.modelCalls + ' model call' + (d.modelCalls == 1 ? '' : 's') : '', tokens(d),
        d.sapSearches ? d.sapSearches + ' SAP search' + (d.sapSearches == 1 ? '' : 'es') : '',
        d.artifactsRead ? d.artifactsRead + ' ABAP artifact' + (d.artifactsRead == 1 ? '' : 's') + ' read' + (d.artifacts ? ': ' + d.artifacts : '') : '',
        d.sapBlocked ? 'SAP refused: ' + d.sapBlocked : ''].filter(Boolean).join(' · ');
    },
    'ai-input': function (d) { return [job(d), d.documents ? 'documents: ' + list(d.documents) : '', d.promptChars ? 'prompt ' + num(d.promptChars) + ' characters' : ''].filter(Boolean).join(' · '); },
    'ai-finish-now': function (d) { return job(d) + ': no more SAP calls, answer from what was read'; },
    review: function (d) {
      const acc = parts(d.accepted), dec = parts(d.declined);
      return [job(d), acc.length ? 'taken: ' + acc.join(', ') : 'nothing taken', dec.length ? 'declined: ' + dec.join(', ') : '',
        d.added && [].concat(d.added).length ? 'added ' + list(d.added) : '',
        d.candidatesOffered ? 'candidates ' + d.candidatesTaken.split(',').filter(Boolean).length + ' of ' + d.candidatesOffered + ' taken' + (d.candidatesTaken ? ' (' + d.candidatesTaken + ')' : '') : '',
        d.grounded || d.unverified ? num(d.grounded) + ' SAP names verified, ' + num(d.unverified) + ' not verified' + (d.unverifiedNames && [].concat(d.unverifiedNames).length ? ' (' + list(d.unverifiedNames) + ')' : '') : '',
        d.guardFlags ? d.guardFlags + ' guardrail warning' + (d.guardFlags == 1 ? '' : 's') : ''].filter(Boolean).join(' · ');
    },
    masked: function (d) { return num(d.items) + ' personal data item' + (d.items == 1 ? '' : 's') + ' masked' + (d.kinds ? ' (' + d.kinds + ')' : '') + (d.job ? ' · ' + (JOBS[d.job] || d.job) : ''); },
    'guard-flag': function (d) { return num(d.flags) + ' instruction-like text' + (d.flags == 1 ? '' : 's') + ' in ' + (d.where || 'the input') + ', treated as data' + (d.first ? ': “' + d.first + '”' : ''); },
    approved: function (d) { return [d.gate ? 'gate ' + d.gate : '', d.version ? 'version ' + d.version : '', d.fingerprint ? 'fingerprint ' + d.fingerprint : ''].filter(Boolean).join(' · '); },
    'approval-requested': function (d) { return 'from ' + (list(d.to) || 'the approvers'); },
    'gate-blocked': function (d) { return 'gate ' + d.gate + ': ' + d.reason; },
    'gate-override': function (d) { return 'gate ' + d.gate + ' – continued without approval: ' + d.reason; },
    export: function (d) { return [d.to, d.file, d.approval ? 'approval: ' + d.approval : ''].filter(Boolean).join(' · '); },
    uploaded: function (d) { return [d.file, d.mode === 'exact' ? 'restored exactly' : d.mode === 'partial' ? 'read best-effort' : '', d.replaced ? 'replaced the ' + d.replaced : '', d.approval ? 'approval: ' + d.approval : ''].filter(Boolean).join(' · '); }
  };
  function generic(d) {
    return Object.keys(d).filter(function (k) { return d[k] !== '' && d[k] !== null && d[k] !== undefined; }).map(function (k) {
      const v = Array.isArray(d[k]) ? d[k].join(', ') : typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k]);
      return k + ': ' + v;
    }).join('; ');
  }
  function detail(e) {
    const d = e.data || {};
    let t = '';
    try { t = DETAIL[e.type] ? DETAIL[e.type](d) : generic(d); } catch (err) { t = generic(d); }
    return String(t).replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  /* Totals of the AI jobs in this spec's trail (finished jobs only). */
  function usageSummary(listE) {
    const by = {}, order = [];
    listE.forEach(function (e) {
      if (e.type !== 'ai-end') return;
      const d = e.data || {}, k = d.job || 'other';
      if (!by[k]) { by[k] = { runs: 0, ok: 0, seconds: 0, calls: 0, tin: 0, tout: 0, est: false, searches: 0, art: 0 }; order.push(k); }
      const b = by[k];
      b.runs++; if (d.outcome === 'result') b.ok++;
      b.seconds += Number(d.seconds || 0); b.calls += Number(d.modelCalls || 0); b.tin += Number(d.tokensIn || 0); b.tout += Number(d.tokensOut || 0);
      b.est = b.est || !!d.tokensEstimated; b.searches += Number(d.sapSearches || 0); b.art += Number(d.artifactsRead || 0);
    });
    if (!order.length) return '';
    const t = { runs: 0, ok: 0, seconds: 0, calls: 0, tin: 0, tout: 0, est: false, searches: 0, art: 0 };
    const row = function (name, b) {
      return '| ' + name + ' | ' + b.runs + ' (' + b.ok + ' with result) | ' + num(b.seconds) + ' s | ' + num(b.calls) + ' | ' + (b.tin + b.tout ? (b.est ? '≈ ' : '') + num(b.tin + b.tout) + ' (' + num(b.tin) + ' / ' + num(b.tout) + ')' : '–') + ' | ' + num(b.searches) + ' | ' + num(b.art) + ' |';
    };
    const rows = order.map(function (k) { const b = by[k]; Object.keys(t).forEach(function (f) { t[f] = f === 'est' ? t.est || b.est : t[f] + b[f]; }); return row(JOBS[k] || k, b); });
    if (order.length > 1) rows.push(row('**Total**', t));
    return '**AI usage**\n\n| AI job | Runs | Time | Model calls | Tokens (in / out) | SAP searches | ABAP artifacts read |\n|---|---|---|---|---|---|---|\n' + rows.join('\n');
  }
  function auditMd(s) {
    const list = (s && s.audit) || [];
    if (!list.length) return '';
    const sum = usageSummary(list);
    return (sum ? sum + '\n\n**Events**\n\n' : '') + '| Time (UTC) | By | Event | Details |\n|---|---|---|---|\n' + list.map(function (e) {
      return '| ' + e.at.replace('T', ' ').slice(0, 19) + ' | ' + (e.by || '–').replace(/\|/g, '/') + ' | ' + (LABELS[e.type] || e.type) + ' | ' + (detail(e) || '–') + ' |';
    }).join('\n');
  }
  function approvalMd(s) {
    const st = status(s);
    if (st.state === 'none') return '- **Approval:** not approved yet';
    const a = st.approval;
    return '- **Approval:** ' + (st.state === 'approved' ? 'approved' : 'CHANGED AFTER APPROVAL – needs approval again') + ' · by ' + (a.by || '–') + ' · ' + a.at.replace('T', ' ').slice(0, 16) + ' UTC' + (a.version ? ' · version ' + a.version : '') + ' · fingerprint `' + a.hash + '`';
  }

  APB.gov = {
    setFromAuth: setFromAuth, policy: function () { return JSON.parse(JSON.stringify(pol)); }, account: account, mode: mode,
    kindOf: kindOf, approvers: approvers, canApprove: canApprove, fingerprint: fingerprint, status: status,
    approvalBlockers: approvalBlockers, approve: approve, gate: gate, requestOf: requestOf,
    audit: { add: add, md: auditMd, detail: detail, usageSummary: usageSummary, normalize: normalizeAudit, LABELS: LABELS }, normalizeApproval: normalizeApproval, approvalMd: approvalMd
  };
})(window.APB = window.APB || {});
