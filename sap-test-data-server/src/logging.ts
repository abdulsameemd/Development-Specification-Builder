/* Local log of tool calls (specification §11): tool name, plan / run identifiers, outcome, duration.
   No personal data, no field values, no secrets – only the keys listed in SAFE_KEYS are ever written. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SAFE_KEYS = ['tool', 'outcome', 'code', 'ms', 'planId', 'runId', 'kind', 'infotype', 'count', 'mock', 'requester'] as const;
export type LogEntry = Partial<Record<(typeof SAFE_KEYS)[number], string | number | boolean>>;

export class Logger {
  constructor(private readonly file: string, private readonly enabled = true) {}
  write(entry: LogEntry): void {
    if (!this.enabled) return;
    const safe: Record<string, unknown> = { at: new Date().toISOString() };
    for (const k of SAFE_KEYS) if (entry[k] !== undefined) safe[k] = entry[k];
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(safe) + '\n');
    } catch { /* logging must never break a tool call */ }
  }
}
