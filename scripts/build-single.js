#!/usr/bin/env node
// Builds dist/ABAP-Copilot-Prompt-Builder.html: one self-contained file (CSS, JS and logo inlined)
// that can be e-mailed or dropped on a share. Run: node scripts/build-single.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };

require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-config.js')], { stdio: 'inherit' });

let html = read('index.html');
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets/morohub-logo.png')).toString('base64');
html = html.split('assets/morohub-logo.png').join(logo);
html = html.replace('<link rel="stylesheet" href="css/styles.css">', function () { return '<style>\n' + read('css/styles.css') + '\n</style>'; });
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, function (_, src) {
  return '<script>\n' + read(src).replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'ABAP-Copilot-Prompt-Builder.html');
fs.writeFileSync(out, html);
console.log('wrote ' + path.relative(root, out) + ' (' + Math.round(html.length / 1024) + ' KB)');
