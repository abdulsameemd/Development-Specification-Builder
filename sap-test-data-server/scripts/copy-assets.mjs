// Copies the scenario templates next to the compiled code (dist/scenarios).
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/scenarios', { recursive: true });
cpSync('src/scenarios', 'dist/scenarios', { recursive: true });
