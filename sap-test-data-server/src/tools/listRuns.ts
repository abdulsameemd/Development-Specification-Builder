import { z } from 'zod';
import type { ToolDef } from './common.js';

const input = {
  requester: z.string().max(60).optional().describe('Only runs started by this developer (self-reported name).'),
  status: z.enum(['running', 'done', 'failed', 'restored']).optional(),
  limit: z.number().int().min(1).max(100).default(20)
};

export const listRuns: ToolDef<typeof input> = {
  name: 'list_runs',
  title: 'List test data runs',
  description: 'Shows the test data ledger in SAP: who ran which plan, when, and with what result.',
  input,
  readOnly: true,
  async run(ctx, a) {
    const runs = await ctx.wrapper.listRuns({ requester: a.requester, status: a.status, limit: a.limit });
    return { summary: runs.length ? runs.length + ' runs.' : 'No runs in the ledger.', data: runs, log: { count: runs.length } };
  }
};
