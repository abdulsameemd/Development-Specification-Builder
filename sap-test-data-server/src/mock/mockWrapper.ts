/* Mock wrapper: behaves like the ABAP wrapper for the read operations, including its safety rules (allow-list
   hard block, enabled infotypes, exclusion list, masking, search cap), so tools and negative tests run without SAP.
   Options let tests simulate a wrong system / client or an empty allow-list. */
import { TestDataError } from '../errors.js';
import type { Wrapper, Status, InfotypeInfo, SearchCriteria, SearchResult, ReadRequest, ReadResult, RunInfo, ObjectKind, InfotypeRecord } from '../wrapper.js';
import { EMPLOYEES, EXCLUDED, INFOTYPES, ORG_OBJECTS } from './data.js';

export interface MockOptions { system?: string; client?: string; allowListed?: boolean; wrapperVersion?: string; scanCap?: number; warnings?: string[] }

export const MASK = '***';

export class MockWrapper implements Wrapper {
  private readonly opt: Required<MockOptions>;
  constructor(opt: MockOptions = {}) {
    this.opt = { system: 'T01', client: '300', allowListed: true, wrapperVersion: '1.0.0-mock', scanCap: 500, warnings: [], ...opt };
  }

  /** Rule 1: nothing but the status answers unless system and client are on the allow-list. */
  private guard(): void {
    if (!this.opt.allowListed) throw new TestDataError('CLIENT_NOT_ALLOWED', 'System ' + this.opt.system + ' client ' + this.opt.client + ' is not on the allow-list (mock).');
  }

  async status(): Promise<Status> {
    return { system: this.opt.system, client: this.opt.client, allowListed: this.opt.allowListed, user: 'ZHR_TESTDATA_FU', wrapperVersion: this.opt.wrapperVersion, release: 'S/4HANA 2023 (mock)', warnings: this.opt.warnings.slice() };
  }

  private info(infotype: string, kind: ObjectKind): InfotypeInfo {
    const it = INFOTYPES.find((i) => i.infotype === infotype && i.kind === kind);
    if (!it) throw new TestDataError('INFOTYPE_NOT_ALLOWED', 'Infotype ' + infotype + ' (' + kind + ') is not known to the policy (mock).');
    return it;
  }

  async describeInfotype(infotype: string, kind: ObjectKind): Promise<InfotypeInfo> {
    this.guard();
    const it = this.info(infotype, kind);
    const masked = new Set(it.policy.maskedFields);
    return { ...it, fields: it.fields.map((f) => ({ ...f, masked: masked.has(f.name) })), subtypes: it.subtypes.slice(), policy: { ...it.policy, maskedFields: it.policy.maskedFields.slice() } };
  }

  private static activeOn(rec: InfotypeRecord, day: string): boolean { return rec.validFrom <= day && rec.validTo >= day; }

  async searchEmployees(c: SearchCriteria, limit: number): Promise<SearchResult> {
    this.guard();
    if (c.hasRecord) {
      const it = this.info(c.hasRecord.infotype, 'employee');
      if (!it.policy.enabled) throw new TestDataError('INFOTYPE_NOT_ALLOWED', 'Infotype ' + it.infotype + ' is not enabled.');
    }
    const day = c.hasRecord?.onDate || new Date().toISOString().slice(0, 10);
    const hits: SearchResult['employees'] = [];
    let scanned = 0;
    for (const e of EMPLOYEES) {
      if (scanned >= this.opt.scanCap) break;
      scanned++;
      if (EXCLUDED.has(e.pernr)) continue;
      const reasons: string[] = [];
      const want: [keyof typeof c, string, string][] = [['personnelArea', e.personnelArea, 'personnel area'], ['personnelSubarea', e.personnelSubarea, 'personnel subarea'], ['employeeGroup', e.employeeGroup, 'employee group'], ['employeeSubgroup', e.employeeSubgroup, 'employee subgroup'], ['companyCode', e.companyCode, 'company code'], ['orgUnit', e.orgUnit, 'organizational unit']];
      let ok = true;
      for (const [k, v, label] of want) {
        const w = c[k];
        if (w === undefined || w === '') continue;
        if (String(w) !== v) { ok = false; break; }
        reasons.push(label + ' ' + v);
      }
      if (!ok) continue;
      if (c.hasRecord) {
        const h = c.hasRecord;
        const has = e.records.some((rec) => rec.infotype === h.infotype && (!h.subtype || rec.subtype === h.subtype) && MockWrapper.activeOn(rec, day));
        if (has !== h.present) continue;
        reasons.push((h.present ? 'has' : 'has no') + ' active ' + h.infotype + (h.subtype ? '/' + h.subtype : '') + ' on ' + day);
      }
      hits.push({ employee: e.pernr, reasons });
      if (hits.length >= limit) break;
    }
    return { employees: hits, scanned, capReached: scanned >= this.opt.scanCap && scanned < EMPLOYEES.length };
  }

  async readInfotype(req: ReadRequest): Promise<ReadResult> {
    this.guard();
    const it = this.info(req.infotype, req.kind);
    if (!it.policy.enabled) throw new TestDataError('INFOTYPE_NOT_ALLOWED', 'Infotype ' + req.infotype + ' is not enabled for test data.');
    let records: InfotypeRecord[];
    if (req.kind === 'employee') {
      const e = EMPLOYEES.find((x) => x.pernr === req.objectId);
      if (!e || EXCLUDED.has(req.objectId)) throw new TestDataError('EMPLOYEE_NOT_ELIGIBLE', 'Employee ' + req.objectId + ' is not eligible (mock).');
      records = e.records;
    } else {
      const o = ORG_OBJECTS.find((x) => x.id === req.objectId && (!req.objectType || x.type === req.objectType));
      if (!o) throw new TestDataError('EMPLOYEE_NOT_ELIGIBLE', 'Organization object ' + (req.objectType || '') + ' ' + req.objectId + ' not found (mock).');
      records = o.records;
    }
    const from = req.from || '1900-01-01', to = req.to || '9999-12-31';
    const masked = new Set(it.policy.maskedFields);
    const out = records
      .filter((rec) => rec.infotype === req.infotype && (!req.subtype || rec.subtype === req.subtype) && rec.validFrom <= to && rec.validTo >= from)
      .map((rec) => ({ ...rec, fields: Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, masked.has(k) ? MASK : v])) }));
    return { records: out, maskedFields: it.policy.maskedFields.slice() };
  }

  async listRuns(): Promise<RunInfo[]> {
    this.guard();
    return []; // Phase 1: nothing is ever written, so the ledger is empty
  }
}
