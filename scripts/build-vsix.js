#!/usr/bin/env node
// Builds dist/dewa-sap-spec-builder-<version>.vsix: the standalone "DEWA SAP Spec Builder" VS Code extension.
//   1. builds the single-file builder (scripts/build-single.js)
//   2. stages vscode-extension/ + vscode-extension-addon/{src,agents} + the builder as media/spec-builder.html in build/vsix/
//   3. merges vscode-extension-addon/package.contributes.json into the manifest
//   4. packages with @vscode/vsce
//   5. unpacks the .vsix to dist/vscode-extension/<publisher.name-version>/ for networks that block .vsix downloads
//      (re-zipped on the user's PC with scripts/install-extension.ps1, see README) (needs npm registry access; --no-dependencies, the extension has none)
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
copy('vscode-extension-addon/agents/dewa-abap-change.agent.md', 'agents/dewa-abap-change.agent.md');
copy('vscode-extension-addon/agents/dewa-fiori.agent.md', 'agents/dewa-fiori.agent.md');
copy('vscode-extension-addon/agents/dewa-fiori-review.agent.md', 'agents/dewa-fiori-review.agent.md');
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

/* The .vsix unpacked, byte for byte (minimal zip reader: stored and deflated entries). Zipping this folder again
   gives an installable .vsix, so the extension reaches PCs whose network blocks .vsix downloads. */
const zlib = require('zlib');
function unzip(file, dir) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file: ' + file);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const target = path.join(dir, name);
    if (!target.startsWith(dir + path.sep)) throw new Error('bad entry ' + name);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + csize);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, method === 0 ? data : zlib.inflateRawSync(data));
  }
}
const unpackedRoot = path.join(root, 'dist', 'vscode-extension');
const unpacked = path.join(unpackedRoot, id + '-' + manifest.version);
fs.rmSync(unpackedRoot, { recursive: true, force: true });
unzip(out, unpacked);
console.log('wrote ' + path.relative(root, unpacked) + path.sep + ' (the .vsix unpacked)');
