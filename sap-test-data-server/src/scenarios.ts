/* Scenario templates (specification §10): versioned JSON files in src/scenarios/ – parameters, steps, checks.
   The build copies them to dist/scenarios/. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ScenarioParam { name: string; description: string; required: boolean; default?: string }
export interface Scenario { id: string; version: number; title: string; goal: string; kind: 'employee' | 'organization'; parameters: ScenarioParam[]; steps: Record<string, unknown>[]; checks: string[] }

function dir(): string {
  for (const rel of ['./scenarios/', '../src/scenarios/']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  throw new Error('Scenario folder not found.');
}

export function loadScenarios(): Scenario[] {
  const d = dir();
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(d + f, 'utf8')) as Scenario);
}
