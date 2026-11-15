/* The MCP server: registers the eight tools of specification §6 with plain-language descriptions. Read tools are
   marked read-only (Copilot may run them without asking); execute_plan is marked destructive so Copilot always asks
   the developer to confirm. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Context } from './context.js';
import { TOOLS } from './tools/index.js';
import { invoke } from './tools/common.js';

export const SERVER_NAME = 'sap-test-data';
export const SERVER_VERSION = '0.1.0';

export function createServer(ctx: Context): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, {
    instructions: 'SAP HR test data for the SAP test client only. Start with get_connection_status. Read tools: describe_infotype, find_employees, read_infotype, list_scenarios, list_runs. ' +
      'Changes are always planned first (plan_changes, a dry run) and executed only with execute_plan after the developer confirms. Personal fields come back masked (***). Phase 1: read-only.'
  });
  for (const def of TOOLS) {
    server.registerTool(def.name, {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: !!def.destructive, idempotentHint: def.readOnly, openWorldHint: false }
    }, (args: unknown) => invoke(ctx, def as never, args as never));
  }
  return server;
}
