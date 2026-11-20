import { z } from 'zod';
import type { ToolDef } from './common.js';
import { TestDataError, infotypeNo, isoDate } from './common.js';
import { checkConnection } from '../context.js';

const item = z.object({
  target: z.string().regex(/^\d{1,8}$/).describe('Employee number or organization object ID.'),
  objectType: z.enum(['P', 'O', 'S', 'C']).default('P'),
  infotype: infotypeNo,
  subtype: z.string().max(4).optional(),
  operation: z.enum(['create', 'change', 'delimit', 'delete']),
  validFrom: isoDate,
  validTo: isoDate.default('9999-12-31'),
  fields: z.record(z.string()).default({}),
  note: z.string().max(200).optional()
});
const input = {
  kind: z.enum(['change', 'restore']).default('change'),
  items: z.array(item).max(50).optional().describe('The changes (change kind).'),
  scenario: z.object({ id: z.string(), params: z.record(z.string()).default({}) }).optional().describe('Or a saved scenario with parameters.'),
  restoreRunId: z.string().optional().describe('Restore kind: the run to undo.'),
  allowPast: z.boolean().default(false).describe('Required when an item starts in the past.')
};

export const planChanges: ToolDef<typeof input> = {
  name: 'plan_changes',
  title: 'Plan test data changes (dry run)',
  description: 'Builds a dry-run plan for test data changes or for restoring an earlier run. Nothing is written. NOT AVAILABLE YET: Phase 1 of the server is read-only.',
  input,
  readOnly: true,
  async run(ctx, a) {
    if (a.kind === 'change' && !a.items?.length && !a.scenario) throw new TestDataError('INVALID_INPUT', 'Give items or a scenario.');
    if (a.kind === 'restore' && !a.restoreRunId) throw new TestDataError('INVALID_INPUT', 'Give the run to restore (restoreRunId).');
    const c = await checkConnection(ctx);
    if (!c.writesAllowed) throw new TestDataError('WRITES_REFUSED', c.problems.join(' '));
    throw new TestDataError('NOT_AVAILABLE_PHASE1');
  }
};
