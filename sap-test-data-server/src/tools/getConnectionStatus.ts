import type { ToolDef } from './common.js';
import { checkConnection } from '../context.js';
import { publicConfig } from '../config.js';

export const getConnectionStatus: ToolDef<{}> = {
  name: 'get_connection_status',
  title: 'Connection status',
  description: 'Shows which SAP test system and client the test data server is connected to, whether they are on the allow-list, the wrapper version, and whether writes are allowed. Call this first.',
  input: {},
  readOnly: true,
  async run(ctx) {
    const c = await checkConnection(ctx);
    const s = c.status;
    const summary = !c.reachable
      ? 'SAP test data service not reachable. Writes are refused. ' + c.problems.join(' ')
      : 'Connected to ' + s!.system + ' client ' + s!.client + ' as ' + s!.user + ' (wrapper ' + s!.wrapperVersion + (ctx.cfg.mock ? ', MOCK MODE – fake data' : '') + '). ' +
        (c.writesAllowed ? 'Writes would be allowed (Phase 1 is read-only).' : 'Writes are refused: ' + c.problems.join(' '));
    return { summary, data: { config: publicConfig(ctx.cfg), status: s, writesAllowed: c.writesAllowed, problems: c.problems, warnings: c.warnings, phase: 1 } };
  }
};
