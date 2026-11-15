/* Clean core gate (specification §4.5): every SAP-delivered object used by the ABAP wrapper copies in abap/ must be
   "released" or "classicAPI" on SAP's published lists for the release. Unlisted, deprecated and noAPI objects fail,
   and so does any direct SELECT from a table that is not our own (customer namespace).

   Source of truth: github.com/SAP/abap-atc-cr-cv-s4hc, folder src:
     - objectReleaseInfo_PCE2023_3.json   (release file for S/4HANA 2023 FPS03 – change with --release-file)
     - objectClassifications_SAP.json     (classic APIs)
   The files are read from --lists <dir> (default: .api-lists/). With --download they are fetched first.

   Usage: tsx scripts/check-api-state.ts <abap dir> [--lists dir] [--release-file name] [--download] [--json]
   Exit code 0 = zero findings, 1 = findings, 2 = lists missing / usage error. */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

export type ApiState = 'released' | 'classicAPI' | 'noAPI' | 'deprecated' | string;
export interface ListEntry { objectType: string; objectKey: string; state: ApiState; successors?: unknown[] }
export interface UsedObject { type: 'CLAS' | 'INTF' | 'FUNC' | 'TABL'; name: string; file: string; line: number; how: string }
export interface Finding { object: UsedObject; problem: string }

const RAW = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/';
export const DEFAULT_RELEASE_FILE = 'objectReleaseInfo_PCE2023_3.json';
export const CLASSIFICATION_FILE = 'objectClassifications_SAP.json';

/** Our own objects: customer namespace (Z*, Y*) and registered customer namespaces given with --own. */
export function isOwn(name: string, ownNamespaces: string[] = []): boolean {
  const n = name.toUpperCase();
  return /^[ZY]/.test(n) || /^(LCL|LIF|LCX|LTC)_/.test(n) || ownNamespaces.some((ns) => n.startsWith(ns.toUpperCase()));
}

/** ABAP source without comments: full-line * comments and " to end of line (outside string literals). */
export function stripComments(src: string): string[] {
  return src.split(/\r?\n/).map((line) => {
    if (/^\*/.test(line)) return '';
    let out = '';
    let inStr: string | null = null;
    for (const ch of line) {
      if (inStr) { out += ch; if (ch === inStr) inStr = null; continue; }
      if (ch === "'" || ch === '`' || ch === '|') { inStr = ch; out += ch; continue; }
      if (ch === '"') break;
      out += ch;
    }
    return out;
  });
}

/** SAP object names an ABAP source uses: classes / interfaces (TYPE REF TO, =>, NEW, CAST, INHERITING, INTERFACES,
    CATCH, RAISING), function modules (CALL FUNCTION 'X') and tables in SELECT … FROM / JOIN. */
export function extractUsedObjects(src: string, file: string): UsedObject[] {
  const found: UsedObject[] = [];
  const lines = stripComments(src);
  const add = (type: UsedObject['type'], name: string, line: number, how: string) => {
    const n = name.toUpperCase().replace(/^\\/, '');
    if (!found.some((f) => f.type === type && f.name === n && f.file === file)) found.push({ type, name: n, file, line, how });
  };
  const classRe = /(?:TYPE\s+REF\s+TO|INHERITING\s+FROM|INTERFACES|CATCH|RAISING|NEW|CAST|CREATE\s+OBJECT\s+\S+\s+TYPE)\s+(\/?[A-Z0-9_]+\/?[A-Z0-9_]*)/gi;
  const staticRe = /(\/?[A-Z][A-Z0-9_]*\/?[A-Z0-9_]*)=>/gi;
  const funcRe = /CALL\s+FUNCTION\s+'([^']+)'/gi;
  const selectRe = /\b(?:FROM|JOIN)\s+(\/?[A-Z][A-Z0-9_]*\/?[A-Z0-9_]*)/gi;
  const ABAP_WORDS = new Set(['ME', 'SUPER', 'TABLE', 'DATA', 'VALUE', 'STRING', 'I', 'C', 'N', 'D', 'T', 'P', 'X', 'XSTRING', 'TYPE', 'REF', 'TO']);
  // statements may span lines: work on whole statements (up to the period)
  const text = lines.join('\n');
  const lineOf = (idx: number) => text.slice(0, idx).split('\n').length;
  for (const m of text.matchAll(classRe)) {
    const n = m[1]!;
    if (ABAP_WORDS.has(n.toUpperCase()) || /^#$/.test(n)) continue;
    const t = /^\/?[A-Z0-9_]*\/?(IF|ZIF|YIF)_/i.test(n) || /INTERFACES/i.test(m[0]) ? 'INTF' : 'CLAS';
    add(t, n, lineOf(m.index ?? 0), m[0].split(/\s+/)[0]!.toUpperCase());
  }
  for (const m of text.matchAll(staticRe)) {
    const n = m[1]!;
    if (ABAP_WORDS.has(n.toUpperCase())) continue;
    add(/^\/?[A-Z0-9_]*\/?IF_/i.test(n) ? 'INTF' : 'CLAS', n, lineOf(m.index ?? 0), '=>');
  }
  for (const m of text.matchAll(funcRe)) add('FUNC', m[1]!, lineOf(m.index ?? 0), 'CALL FUNCTION');
  // SELECT … FROM <table>: only inside SELECT statements
  for (const stmt of text.matchAll(/\bSELECT\b[\s\S]*?\./gi)) {
    for (const m of stmt[0].matchAll(selectRe)) {
      const n = m[1]!;
      if (/^@/.test(n)) continue;
      add('TABL', n, lineOf((stmt.index ?? 0) + (m.index ?? 0)), 'SELECT FROM');
    }
  }
  return found;
}

/** Index of the SAP lists: name → state (and type). Accepts the list files' shapes (array under any key). */
export function indexLists(...files: unknown[]): Map<string, ListEntry> {
  const idx = new Map<string, ListEntry>();
  const take = (e: Record<string, unknown>) => {
    const key = String(e.objectKey ?? e.tadirObjName ?? '').toUpperCase();
    const type = String(e.objectType ?? e.tadirObject ?? '').toUpperCase();
    const state = String(e.state ?? '');
    if (!key || !state) return;
    const prev = idx.get(type + ':' + key);
    // a "released" statement wins over "classicAPI", which wins over anything else
    const rank = (s: string) => (s === 'released' ? 3 : s === 'classicAPI' ? 2 : 1);
    if (!prev || rank(state) > rank(prev.state)) idx.set(type + ':' + key, { objectType: type, objectKey: key, state, successors: e.successors as unknown[] });
  };
  for (const f of files) {
    if (Array.isArray(f)) f.forEach((e) => take(e as Record<string, unknown>));
    else if (f && typeof f === 'object') Object.values(f).forEach((v) => { if (Array.isArray(v)) v.forEach((e) => take(e as Record<string, unknown>)); });
  }
  return idx;
}

const TYPE_ALIASES: Record<UsedObject['type'], string[]> = { CLAS: ['CLAS'], INTF: ['INTF'], FUNC: ['FUNC'], TABL: ['TABL', 'VIEW', 'DDLS'] };

export function check(used: UsedObject[], idx: Map<string, ListEntry>, own: string[] = []): Finding[] {
  const findings: Finding[] = [];
  for (const o of used) {
    if (isOwn(o.name, own)) continue;
    if (o.type === 'TABL') { findings.push({ object: o, problem: 'direct SELECT from SAP table ' + o.name + ' – not allowed (use a classic API)' }); continue; }
    const entry = TYPE_ALIASES[o.type].map((t) => idx.get(t + ':' + o.name)).find(Boolean)
      ?? [...idx.values()].find((e) => e.objectKey === o.name); // type unknown in the source (e.g. interface used via =>)
    if (!entry) { findings.push({ object: o, problem: o.name + ' is not on SAP\'s lists (unlisted)' }); continue; }
    if (entry.state !== 'released' && entry.state !== 'classicAPI') {
      findings.push({ object: o, problem: o.name + ' is ' + entry.state + (entry.successors && entry.successors.length ? ' – successor: ' + JSON.stringify(entry.successors) : '') });
    }
  }
  return findings;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : ['.abap', '.txt'].includes(extname(p).toLowerCase()) || /\.(clas|intf|prog|fugr)\./i.test(n) ? [p] : [];
  });
}

async function download(dir: string, file: string): Promise<void> {
  const res = await fetch(RAW + file);
  if (!res.ok) throw new Error('Download of ' + file + ' failed: HTTP ' + res.status);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), await res.text());
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const abapDir = args.find((a, i) => !a.startsWith('--') && !['--lists', '--release-file', '--own'].includes(args[i - 1] ?? ''));
  if (!abapDir) { console.error('Usage: check-api-state <abap dir> [--lists dir] [--release-file name] [--download] [--own /NS/] [--json]'); return 2; }
  const listsDir = opt('--lists') ?? '.api-lists';
  const releaseFile = opt('--release-file') ?? DEFAULT_RELEASE_FILE;
  const own = (opt('--own') ?? '').split(',').filter(Boolean);
  if (args.includes('--download')) { await download(listsDir, releaseFile); await download(listsDir, CLASSIFICATION_FILE); }
  const paths = [join(listsDir, releaseFile), join(listsDir, CLASSIFICATION_FILE)];
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) { console.error('SAP list files missing: ' + missing.join(', ') + ' – run with --download (needs access to github.com) or copy them there.'); return 2; }
  const idx = indexLists(...paths.map((p) => JSON.parse(readFileSync(p, 'utf8'))));
  const used = walk(abapDir).flatMap((f) => extractUsedObjects(readFileSync(f, 'utf8'), f));
  const findings = check(used, idx, own);
  if (args.includes('--json')) console.log(JSON.stringify({ checked: used.length, findings }, null, 1));
  else {
    console.log('Checked ' + used.length + ' SAP object uses in ' + abapDir + ' against ' + releaseFile + ' + ' + CLASSIFICATION_FILE + '.');
    findings.forEach((f) => console.log('  ✗ ' + f.object.file + ':' + f.object.line + ' – ' + f.problem));
    console.log(findings.length ? findings.length + ' finding(s).' : 'Zero findings.');
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && /check-api-state\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv).then((code) => process.exit(code), (e: unknown) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(2); });
}
