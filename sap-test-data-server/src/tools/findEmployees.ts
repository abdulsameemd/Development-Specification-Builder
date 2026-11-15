import { z } from 'zod';
import type { ToolDef } from './common.js';
import { infotypeNo, isoDate } from './common.js';

const input = {
  personnelArea: z.string().max(4).optional().describe('Personnel area, e.g. 1000.'),
  personnelSubarea: z.string().max(4).optional(),
  employeeGroup: z.string().max(1).optional().describe('Employee group, e.g. 1 (active).'),
  employeeSubgroup: z.string().max(2).optional(),
  companyCode: z.string().max(4).optional(),
  orgUnit: z.string().regex(/^\d{8}$/).optional().describe('Organizational unit (8 digits).'),
  hasRecord: z.object({
    infotype: infotypeNo,
    subtype: z.string().max(4).optional(),
    present: z.boolean().describe('true = must have an active record; false = must NOT have one (e.g. no work e-mail yet).'),
    onDate: isoDate.optional()
  }).optional().describe('Filter on an infotype record, e.g. { infotype: "0105", subtype: "0010", present: false }.'),
  limit: z.number().int().min(1).max(50).default(10).describe('How many employees to return (max 50).')
};

export const findEmployees: ToolDef<typeof input> = {
  name: 'find_employees',
  title: 'Find eligible test employees',
  description: 'Finds employees in the SAP test client that match criteria (personnel area, groups, organizational unit, has / has no active record of an infotype). Returns employee numbers and why each matched – names are never returned.',
  input,
  readOnly: true,
  async run(ctx, a) {
    const { limit, ...criteria } = a;
    const r = await ctx.wrapper.searchEmployees(criteria, limit);
    // output reduction: employee number and match reasons only, whatever the wrapper sent
    const employees = r.employees.map((e) => ({ employee: e.employee, reasons: e.reasons }));
    const summary = employees.length + ' eligible employee' + (employees.length === 1 ? '' : 's') + ' found' + (employees.length ? ': ' + employees.map((e) => e.employee).join(', ') : '') +
      ' (' + r.scanned + ' scanned' + (r.capReached ? ', scan cap reached – narrow the criteria' : '') + ').';
    return { summary, data: { employees, scanned: r.scanned, capReached: r.capReached }, log: { count: employees.length } };
  }
};
