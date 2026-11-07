#!/usr/bin/env node
// Builds dist/dewa-sap-spec-builder-<version>.vsix: the standalone "DEWA SAP Spec Builder" VS Code extension.
//   1. builds the single-file builder (scripts/build-single.js)
//   2. stages vscode-extension/ + vscode-extension-addon/{src,agents} + the builder as media/spec-builder.html in build/vsix/
//   3. merges vscode-extension-addon/package.contributes.json into the manifest
//   4. packages with @vscode/vsce (needs npm registry access; --no-dependencies, the extension has none)
// Run: node scripts/build-vsix.js            (add --stage-only to skip packaging)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const stage = path.join(root, 'build', 'vsix');
const VSCE = '@vscode/vsce@3.9.2';

execFileSync(process.execPath, [path.join(__dirname, 'build-single.js')], { stdio: 'inherit' });

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
function copy(from, to) {
  fs.mkdirSync(path.dirname(path.join(stage, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(stage, to));
}
['extension.js', 'README.md', 'CHANGELOG.md', 'icon.png', '.vscodeignore'].forEach((f) => copy('vscode-extension/' + f, f));
fs.readdirSync(path.join(root, 'vscode-extension-addon/src')).filter((f) => f.endsWith('.js')).forEach((f) => copy('vscode-extension-addon/src/' + f, 'src/' + f));
copy('vscode-extension-addon/agents/dewa-fs-discovery.agent.md', 'agents/dewa-fs-discovery.agent.md');
copy('dist/SAP-Development-Specification-Builder.html', 'media/spec-builder.html');

// manifest = base + add-on contributions
const base = JSON.parse(fs.readFileSync(path.join(root, 'vscode-extension/package.json'), 'utf8'));
const add = JSON.parse(fs.readFileSync(path.join(root, 'vscode-extension-addon/package.contributes.json'), 'utf8'));
const manifest = Object.assign({}, base);
delete manifest['//'];
manifest.activationEvents = Array.from(new Set((base.activationEvents || []).concat(add.activationEvents || [])));
const c = manifest.contributes = JSON.parse(JSON.stringify(base.contributes || {}));
const ac = add.contributes || {};
c.commands = (ac.commands || []).concat(c.commands || []);
c.languageModelTools = (c.languageModelTools || []).concat(ac.languageModelTools || []);
c.configuration = {
  title: (ac.configuration || c.configuration || {}).title,
  properties: Object.assign({}, (ac.configuration || {}).properties, (c.configuration || {}).properties)
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

// the builder's browser one-click launch must target this extension
const fsDefs = JSON.parse(fs.readFileSync(path.join(root, 'config/fs-definitions.json'), 'utf8'));
const id = manifest.publisher + '.' + manifest.name;
if (fsDefs.discovery.extensionId !== id) {
  console.error('config/fs-definitions.json discovery.extensionId is "' + fsDefs.discovery.extensionId + '", expected "' + id + '"');
  process.exit(1);
}
console.log('staged ' + path.relative(root, stage) + ' (' + id + ' ' + manifest.version + ')');

if (process.argv.includes('--stage-only')) process.exit(0);
const out = path.join(root, 'dist', manifest.name + '-' + manifest.version + '.vsix');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['--yes', VSCE, 'package', '--no-dependencies', '--skip-license', '--out', out], { cwd: stage, stdio: 'inherit' });
console.log('wrote ' + path.relative(root, out));
