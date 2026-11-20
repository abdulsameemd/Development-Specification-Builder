/* Fake test client data for mock mode. Everything is invented: employee numbers 0900xxxx, no real names; personal
   values exist only to prove that masking removes them. */
import type { InfotypeInfo, InfotypeRecord } from '../wrapper.js';

export interface MockEmployee { pernr: string; personnelArea: string; personnelSubarea: string; employeeGroup: string; employeeSubgroup: string; companyCode: string; orgUnit: string; records: InfotypeRecord[] }

const OPEN = '9999-12-31';
const r = (infotype: string, subtype: string, validFrom: string, validTo: string, fields: Record<string, string>): InfotypeRecord => ({ infotype, subtype, validFrom, validTo, fields });

function employee(pernr: string, area: string, group: string, sub: string, org: string, extra: InfotypeRecord[]): MockEmployee {
  return {
    pernr, personnelArea: area, personnelSubarea: '0001', employeeGroup: group, employeeSubgroup: sub, companyCode: '1000', orgUnit: org,
    records: [
      r('0001', '', '2020-01-01', OPEN, { BUKRS: '1000', WERKS: area, BTRTL: '0001', PERSG: group, PERSK: sub, ORGEH: org, PLANS: '50000200', STELL: '50000300' }),
      r('0002', '', '1985-05-01', OPEN, { NACHN: 'Testperson ' + pernr.slice(-2), VORNA: 'Mock', GBDAT: '1985-05-01', GESCH: '1' }),
      ...extra
    ]
  };
}

export const EMPLOYEES: MockEmployee[] = [
  employee('09000001', '1000', '1', 'U1', '50000100', [
    r('0006', '1', '2021-03-01', OPEN, { STRAS: 'Fake Street 1', ORT01: 'Testcity', PSTLZ: '00001', LAND1: 'AE' }),
    r('0105', '0010', '2021-03-01', OPEN, { USRTY: '0010', USRID_LONG: 'mock.person01@example.invalid' }),
    r('2006', '01', '2026-01-01', '2026-12-31', { KTART: '01', ANZHL: '30.00', KVERB: '4.00' })
  ]),
  employee('09000002', '1000', '1', 'U1', '50000100', [
    r('0006', '1', '2022-07-01', OPEN, { STRAS: 'Fake Street 2', ORT01: 'Testcity', PSTLZ: '00002', LAND1: 'AE' })
  ]),
  employee('09000003', '1000', '1', 'U2', '50000101', [
    r('0006', '1', '2019-01-01', OPEN, { STRAS: 'Fake Street 3', ORT01: 'Othercity', PSTLZ: '00003', LAND1: 'AE' }),
    r('2001', '0100', '2026-11-02', '2026-11-04', { AWART: '0100', ABWTG: '3.00' }),
    r('0008', '0', '2026-01-01', OPEN, { TRFGR: 'G5', BETRG01: '12000.00', WAERS: 'AED' }),
    r('0009', '0', '2020-01-01', OPEN, { BANKL: 'MOCKBANK', BANKN: '000123456789', IBAN: 'AE070331234567890123456' })
  ]),
  employee('09000004', '2000', '2', 'U3', '50000102', []),
  employee('09000005', '1000', '1', 'U1', '50000100', [
    r('0105', '0010', '2023-01-01', OPEN, { USRTY: '0010', USRID_LONG: 'mock.person05@example.invalid' })
  ]),
  // on the exclusion list (never touched, never returned by searches)
  employee('09009999', '1000', '1', 'U0', '50000100', [])
];

export const EXCLUDED = new Set(['09009999']);

export const ORG_OBJECTS: { type: string; id: string; records: InfotypeRecord[] }[] = [
  { type: 'O', id: '50000100', records: [r('1000', '', '2020-01-01', OPEN, { SHORT: 'HR-PAY', STEXT: 'Payroll team (mock)' }), r('1001', 'B002', '2020-01-01', OPEN, { SCLAS: 'O', SOBID: '50000099' })] },
  { type: 'S', id: '50000200', records: [r('1000', '', '2020-01-01', OPEN, { SHORT: 'PAY-SPEC', STEXT: 'Payroll specialist (mock)' }), r('1001', 'A003', '2020-01-01', OPEN, { SCLAS: 'O', SOBID: '50000100' })] }
];

const f = (name: string, label: string, type: string, length: number, mandatory = false) => ({ name, label, type, length, mandatory, masked: false });

/** Infotypes the mock knows, with their policy (enabled / masked fields) – as the wrapper's policy table would say. */
export const INFOTYPES: InfotypeInfo[] = [
  { infotype: '0001', kind: 'employee', name: 'Organizational Assignment', timeConstraint: '1', subtypes: [], fields: [f('BUKRS', 'Company code', 'CHAR', 4, true), f('WERKS', 'Personnel area', 'CHAR', 4, true), f('PERSG', 'Employee group', 'CHAR', 1, true), f('PERSK', 'Employee subgroup', 'CHAR', 2, true), f('ORGEH', 'Organizational unit', 'NUMC', 8), f('PLANS', 'Position', 'NUMC', 8)], policy: { enabled: true, writable: true, maskedFields: [] } },
  { infotype: '0002', kind: 'employee', name: 'Personal Data', timeConstraint: '1', subtypes: [], fields: [f('NACHN', 'Last name', 'CHAR', 40, true), f('VORNA', 'First name', 'CHAR', 40), f('GBDAT', 'Date of birth', 'DATS', 8, true), f('GESCH', 'Gender', 'CHAR', 1)], policy: { enabled: true, writable: true, maskedFields: ['NACHN', 'VORNA', 'GBDAT'] } },
  { infotype: '0006', kind: 'employee', name: 'Addresses', timeConstraint: '2', subtypes: [{ subtype: '1', text: 'Permanent residence' }, { subtype: '2', text: 'Temporary residence' }], fields: [f('STRAS', 'Street', 'CHAR', 60, true), f('ORT01', 'City', 'CHAR', 40, true), f('PSTLZ', 'Postal code', 'CHAR', 10), f('LAND1', 'Country', 'CHAR', 3, true)], policy: { enabled: true, writable: true, maskedFields: ['STRAS', 'PSTLZ'] } },
  { infotype: '0008', kind: 'employee', name: 'Basic Pay', timeConstraint: '1', subtypes: [{ subtype: '0', text: 'Basic contract' }], fields: [f('TRFGR', 'Pay scale group', 'CHAR', 8), f('BETRG01', 'Amount (wage type 1)', 'CURR', 13), f('WAERS', 'Currency', 'CUKY', 5)], policy: { enabled: true, writable: true, maskedFields: ['BETRG01', 'TRFGR'] } },
  { infotype: '0009', kind: 'employee', name: 'Bank Details', timeConstraint: '2', subtypes: [{ subtype: '0', text: 'Main bank' }], fields: [f('BANKL', 'Bank key', 'CHAR', 15, true), f('BANKN', 'Account number', 'CHAR', 18, true), f('IBAN', 'IBAN', 'CHAR', 34)], policy: { enabled: true, writable: true, maskedFields: ['BANKL', 'BANKN', 'IBAN'] } },
  { infotype: '0021', kind: 'employee', name: 'Family Member/Dependents', timeConstraint: '3', subtypes: [], fields: [f('FAMSA', 'Type of family record', 'CHAR', 4, true)], policy: { enabled: false, writable: false, maskedFields: [] } },
  { infotype: '0105', kind: 'employee', name: 'Communication', timeConstraint: '2', subtypes: [{ subtype: '0001', text: 'System user name' }, { subtype: '0010', text: 'E-mail' }], fields: [f('USRTY', 'Communication type', 'CHAR', 4, true), f('USRID_LONG', 'Communication ID', 'CHAR', 241, true)], policy: { enabled: true, writable: true, maskedFields: ['USRID_LONG'] } },
  { infotype: '2001', kind: 'employee', name: 'Absences', timeConstraint: 'T', subtypes: [{ subtype: '0100', text: 'Leave' }, { subtype: '0200', text: 'Sickness' }], fields: [f('AWART', 'Absence type', 'CHAR', 4, true), f('ABWTG', 'Absence days', 'DEC', 6)], policy: { enabled: true, writable: true, maskedFields: [] } },
  { infotype: '2006', kind: 'employee', name: 'Absence Quotas', timeConstraint: 'T', subtypes: [{ subtype: '01', text: 'Annual leave' }], fields: [f('KTART', 'Quota type', 'NUMC', 2, true), f('ANZHL', 'Entitlement', 'DEC', 10), f('KVERB', 'Deduction', 'DEC', 10)], policy: { enabled: true, writable: true, maskedFields: [] } },
  { infotype: '9001', kind: 'employee', name: 'Custom: DEWA allowance (mock Z infotype)', timeConstraint: '2', subtypes: [], fields: [f('ZZALLOW', 'Allowance type', 'CHAR', 4, true), f('ZZAMOUNT', 'Amount', 'CURR', 13)], policy: { enabled: true, writable: true, maskedFields: ['ZZAMOUNT'] } },
  { infotype: '1000', kind: 'organization', name: 'Object', timeConstraint: '1', subtypes: [], fields: [f('SHORT', 'Abbreviation', 'CHAR', 12, true), f('STEXT', 'Name', 'CHAR', 40)], policy: { enabled: true, writable: true, maskedFields: [] } },
  { infotype: '1001', kind: 'organization', name: 'Relationships', timeConstraint: '3', subtypes: [{ subtype: 'A003', text: 'Belongs to' }, { subtype: 'B002', text: 'Is line supervisor of' }, { subtype: 'B012', text: 'Is managed by' }], fields: [f('SCLAS', 'Type of related object', 'CHAR', 2, true), f('SOBID', 'ID of related object', 'CHAR', 45, true)], policy: { enabled: true, writable: true, maskedFields: [] } }
];
