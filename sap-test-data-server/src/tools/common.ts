/* Shared pieces for the tools: input formats, the result / error shapes Copilot reads, and the call wrapper that
   times and logs every call (no values, no personal data). */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Context } from '../context.js';
import { toTestDataError, TestDataError } from '../errors.js';

export const infotypeNo = z.string().regex(/^\d{4}$/, 'Four digits, e.g. 0006 or 2001.');
export const employeeNo = z.string().regex(/^\d{1,8}$/, 'Employee number (up to 8 digits).').transform((v) => v.padStart(8, '0'));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date as YYYY-MM-DD (9999-12-31 = open-ended).');
export const kind = z.enum(['employee', 'organization']).default('employee');

export interface ToolDef<S extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly: boolean;
  destructive?: boolean;
  run: (ctx: Context, args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<{ summary: string; data?: unknown; log?: { infotype?: string; count?: number; planId?: string; runId?: string } }>;
}

export function ok(summary: string, data?: unknown): CallToolResult {
  return { content: [{ type: 'text', text: summary + (data === undefined ? '' : '\n\n' + JSON.stringify(data, null, 1)) }] };
}

export function fail(e: unknown): CallToolResult {
  const err = toTestDataError(e);
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.sapMessages.length) body.sapMessages = err.sapMessages;
  return { isError: true, content: [{ type: 'text', text: err.code + ': ' + err.message + (err.sapMessages.length ? '\nSAP: ' + err.sapMessages.join(' | ') : '') + '\n\n' + JSON.stringify(body) }] };
}

export async function invoke<S extends z.ZodRawShape>(ctx: Context, def: ToolDef<S>, args: z.objectOutputType<S, z.ZodTypeAny>): Promise<CallToolResult> {
  const t0 = Date.now();
  try {
    const r = await def.run(ctx, args);
    ctx.log.write({ tool: def.name, outcome: 'ok', ms: Date.now() - t0, mock: ctx.cfg.mock, requester: ctx.cfg.requester, ...(r.log || {}) });
    return ok(r.summary, r.data);
  } catch (e) {
    const err = toTestDataError(e);
    ctx.log.write({ tool: def.name, outcome: 'error', code: err.code, ms: Date.now() - t0, mock: ctx.cfg.mock, requester: ctx.cfg.requester });
    return fail(err);
  }
}

export { TestDataError };
