import { z } from 'zod';
import type { ToolDef } from './common.js';
import { infotypeNo, isoDate, kind } from './common.js';
import { MASK } from '../mock/mockWrapper.js';

const input = {
  kind,
  objectId: z.string().regex(/^\d{1,8}$/).describe('Employee number, or the 8-digit ID of an organization object.'),
  objectType: z.enum(['O', 'S', 'C']).optional().describe('Organization objects only: O = organizational unit, S = position, C = job.'),
  infotype: infotypeNo,
  subtype: z.string().max(4).optional(),
  from: isoDate.optional().describe('Records valid on or after this date (default: all).'),
  to: isoDate.optional()
};

export const readInfotype: ToolDef<typeof input> = {
  name: 'read_infotype',
  title: 'Read infotype records',
  description: 'Reads the records of one infotype for one employee or organization object. Sensitive fields (names, addresses, pay, bank, IDs) are masked by the SAP policy and shown as ***.',
  input,
  readOnly: true,
  async run(ctx, a) {
    const objectId = a.objectId.padStart(8, '0');
    const r = await ctx.wrapper.readInfotype({ kind: a.kind, objectId, objectType: a.objectType, infotype: a.infotype, subtype: a.subtype, from: a.from, to: a.to });
    // defence in depth: masking is enforced in SAP; the server masks the listed fields again in case a value slipped through
    const masked = new Set(r.maskedFields);
    const records = r.records.map((rec) => ({ ...rec, fields: Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, masked.has(k) ? MASK : v])) }));
    const summary = records.length + ' record' + (records.length === 1 ? '' : 's') + ' of infotype ' + a.infotype + (a.subtype ? '/' + a.subtype : '') + ' for ' + (a.kind === 'employee' ? 'employee ' : 'object ' + (a.objectType || '') + ' ') + objectId +
      (records.length ? ': ' + records.map((x) => x.validFrom + '…' + x.validTo + (x.subtype ? ' (' + x.subtype + ')' : '')).join(', ') : '') + (r.maskedFields.length ? '. Masked: ' + r.maskedFields.join(', ') : '') + '.';
    return { summary, data: { records, maskedFields: r.maskedFields }, log: { infotype: a.infotype, count: records.length } };
  }
};
