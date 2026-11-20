import type { ToolDef } from './common.js';
import { infotypeNo, kind } from './common.js';

const input = { infotype: infotypeNo.describe('Infotype number, e.g. 0006 (addresses), 2001 (absences), 1001 (relationships), or a custom 9xxx infotype.'), kind: kind.describe('employee (Personnel Administration / Time Management) or organization (Organizational Management).') };

export const describeInfotype: ToolDef<typeof input> = {
  name: 'describe_infotype',
  title: 'Describe an infotype',
  description: 'Explains an SAP HR infotype: its fields, mandatory fields, subtypes, time constraint, and whether the test data policy allows it (and which fields are masked). Works for custom Z infotypes too.',
  input,
  readOnly: true,
  async run(ctx, a) {
    const it = await ctx.wrapper.describeInfotype(a.infotype, a.kind);
    const mand = it.fields.filter((f) => f.mandatory).map((f) => f.name);
    const summary = 'Infotype ' + it.infotype + ' ' + it.name + ' (' + it.kind + ', time constraint ' + it.timeConstraint + '): ' + it.fields.length + ' fields' + (mand.length ? ', mandatory ' + mand.join(', ') : '') +
      (it.subtypes.length ? '; subtypes ' + it.subtypes.map((s) => s.subtype + ' ' + s.text).join(', ') : '') + '. Policy: ' + (it.policy.enabled ? 'enabled' + (it.policy.maskedFields.length ? ', masked on read: ' + it.policy.maskedFields.join(', ') : '') : 'NOT enabled for test data') + '.';
    return { summary, data: it, log: { infotype: it.infotype } };
  }
};
