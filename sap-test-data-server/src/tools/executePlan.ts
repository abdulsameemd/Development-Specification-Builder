import { z } from 'zod';
import type { ToolDef } from './common.js';
import { TestDataError } from './common.js';
import { checkConnection } from '../context.js';

const input = { planId: z.string().min(1).max(64).describe('The plan identifier returned by plan_changes. Nothing else can be changed here.') };

export const executePlan: ToolDef<typeof input> = {
  name: 'execute_plan',
  title: 'Execute a test data plan (writes to SAP)',
  description: 'WRITES test data to the SAP test client by executing a stored plan exactly as planned. Always ask the developer to confirm first. NOT AVAILABLE YET: Phase 1 of the server is read-only.',
  input,
  readOnly: false,
  destructive: true,
  async run(ctx) {
    const c = await checkConnection(ctx);
    if (!c.writesAllowed) throw new TestDataError('WRITES_REFUSED', c.problems.join(' '));
    throw new TestDataError('NOT_AVAILABLE_PHASE1');
  }
};
