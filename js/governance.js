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
    'ai-start': 'AI job started', 'ai-input': 'AI input', 'ai-end': 'AI job finished', review: 'AI result reviewed', approved: 'Approved',
    'approval-requested': 'Approval requested', 'gate-blocked': 'Gate blocked', 'gate-override': 'Gate overridden', handoff: 'Handed over', 'created-from': 'Created from',
    export: 'Exported', uploaded: 'Uploaded', 'example-loaded': 'Example loaded', trimmed: 'Older entries summarised', masked: 'Personal data masked', 'guard-flag': 'Guardrail warning'
  };
  function detail(e) {
    const d = e.data || {};
    return Object.keys(d).filter(function (k) { return d[k] !== '' && d[k] !== null && d[k] !== undefined; }).map(function (k) {
      const v = Array.isArray(d[k]) ? d[k].join(', ') : typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k]);
      return k + ': ' + v;
    }).join('; ').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 300);
  }
  function auditMd(s) {
    const list = (s && s.audit) || [];
    if (!list.length) return '';
    return '| Time (UTC) | By | Event | Details |\n|---|---|---|---|\n' + list.map(function (e) {
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
    audit: { add: add, md: auditMd, normalize: normalizeAudit, LABELS: LABELS }, normalizeApproval: normalizeApproval, approvalMd: approvalMd
  };
})(window.APB = window.APB || {});
