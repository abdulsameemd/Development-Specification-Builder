/* What every tool shares: configuration, the wrapper (real or mock), the logger, and the connection check that
   decides whether write tools may run at all (specification §5 rule 2): the answering system and client must equal
   the configured ones, they must be on SAP's allow-list, and the wrapper version must be supported. */
import type { Config } from './config.js';
import type { Wrapper, Status } from './wrapper.js';
import { SUPPORTED_WRAPPER_MAJOR } from './wrapper.js';
import type { Logger } from './logging.js';
import { toTestDataError } from './errors.js';

export interface ConnectionCheck {
  reachable: boolean;
  status: Status | null;
  writesAllowed: boolean;
  problems: string[];   // why writes are refused (plain language)
  warnings: string[];
}

export interface Context {
  cfg: Config;
  wrapper: Wrapper;
  log: Logger;
  lastCheck: ConnectionCheck | null;
}

export function evaluate(cfg: Config, status: Status): ConnectionCheck {
  const problems: string[] = [];
  if (String(status.system).toUpperCase() !== cfg.expectedSystem) problems.push('Connected to system ' + status.system + ', expected ' + cfg.expectedSystem + '.');
  if (String(status.client) !== cfg.client) problems.push('Connected to client ' + status.client + ', expected ' + cfg.client + '.');
  if (!status.allowListed) problems.push('System ' + status.system + ' client ' + status.client + ' is not on the test data allow-list in SAP.');
  const major = Number(String(status.wrapperVersion || '').split('.')[0]);
  if (major !== SUPPORTED_WRAPPER_MAJOR) problems.push('ABAP wrapper version ' + (status.wrapperVersion || 'unknown') + ' is not supported (expected ' + SUPPORTED_WRAPPER_MAJOR + '.x).');
  return { reachable: true, status, writesAllowed: problems.length === 0, problems, warnings: (status.warnings || []).slice() };
}

export async function checkConnection(ctx: Context): Promise<ConnectionCheck> {
  try {
    ctx.lastCheck = evaluate(ctx.cfg, await ctx.wrapper.status());
  } catch (e) {
    const err = toTestDataError(e);
    ctx.lastCheck = { reachable: false, status: null, writesAllowed: false, problems: [err.message], warnings: [] };
  }
  return ctx.lastCheck;
}
