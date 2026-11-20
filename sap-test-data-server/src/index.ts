#!/usr/bin/env node
/* Start-up (specification §5): read the configuration (refuse to start when a required value is missing), create the
   wrapper (real service or mock), check the connection – writes stay refused unless system, client, allow-list and
   wrapper version match – and serve the tools over standard input / output. Nothing is printed to stdout except
   the MCP protocol; messages for the developer go to stderr. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { Logger } from './logging.js';
import { SapClient, HttpWrapper } from './sapClient.js';
import { MockWrapper } from './mock/mockWrapper.js';
import { checkConnection, type Context } from './context.js';
import { createServer } from './server.js';
import { toTestDataError } from './errors.js';

async function main(): Promise<void> {
  let cfg;
  try { cfg = loadConfig(); } catch (e) {
    process.stderr.write('[sap-test-data] Not started: ' + toTestDataError(e).message + '\n');
    process.exit(1);
  }
  const wrapper = cfg.mock ? new MockWrapper() : new HttpWrapper(new SapClient(cfg));
  const ctx: Context = { cfg, wrapper, log: new Logger(cfg.logFile), lastCheck: null };
  const c = await checkConnection(ctx);
  process.stderr.write('[sap-test-data] ' + (cfg.mock ? 'MOCK MODE (fake data). ' : '') + (c.writesAllowed ? 'Connected to ' + c.status?.system + ' client ' + c.status?.client + '.' : 'Writes refused: ' + c.problems.join(' ')) + '\n');
  await createServer(ctx).connect(new StdioServerTransport());
}

main().catch((e: unknown) => { process.stderr.write('[sap-test-data] ' + toTestDataError(e).message + '\n'); process.exit(1); });
