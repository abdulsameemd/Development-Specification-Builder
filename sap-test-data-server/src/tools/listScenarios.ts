import type { ToolDef } from './common.js';
import { loadScenarios } from '../scenarios.js';

export const listScenarios: ToolDef<{}> = {
  name: 'list_scenarios',
  title: 'List test data scenarios',
  description: 'Lists the saved test data scenario templates (e.g. future-dated address change, open absence, absence with quota) with the parameters each needs.',
  input: {},
  readOnly: true,
  async run() {
    const list = loadScenarios();
    return { summary: list.length + ' scenarios: ' + list.map((s) => s.id).join(', ') + '.', data: list, log: { count: list.length } };
  }
};
