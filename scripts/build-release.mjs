// Construit le paquet Windows autonome : dist/SupervisionNG-<version>-win-x64.zip
//
//   node scripts/build-release.mjs                 (sans Node.js embarque)
//   node scripts/build-release.mjs --with-node     (telecharge node.exe depuis nodejs.org)
//   node scripts/build-release.mjs --node-zip C:\chemin\node-v22.x-win-x64.zip
//   node scripts/build-release.mjs --node-version 22.12.0
//
// Le paquet contient l'application, ses dependances de production (node_modules)
// et, en option, node.exe : il suffit alors de le decompresser et de lancer
// SupervisionNG.cmd, sans installation ni acces Internet.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeZip, readZip } from './lib/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const withNode = args.includes('--with-node') || !!opt('--node-zip');
const nodeVersion = (opt('--node-version') || process.versions.node).replace(/^v/, '');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'stage');
const baseName = `SupervisionNG-${pkg.version}-win-x64${withNode ? '' : '-sans-node'}`;

const INCLUDE = ['server', 'shared', 'public', 'scripts', 'docs', 'config/supervisionng.example.json', 'config/inventory.example.json',
  'README.md', 'LICENSE', 'package.json', 'package-lock.json', 'SupervisionNG.cmd'];

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function walk(dir, base = dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out;
}

async function download(url) {
  console.log(`telechargement ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} pour ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) { console.warn(`absent, ignore : ${item}`); continue; }
  copy(src, path.join(stage, item));
}

console.log('installation des dependances de production...');
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
// three.js : seuls build/ et examples/jsm/ sont servis au navigateur
for (const d of ['src', 'examples/fonts', 'examples/models', 'examples/textures', 'examples/screenshots']) {
  fs.rmSync(path.join(stage, 'node_modules', 'three', d), { recursive: true, force: true });
}

if (withNode) {
  const zipPath = opt('--node-zip');
  const buf = zipPath ? fs.readFileSync(zipPath) : await download(`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`);
  const entry = readZip(buf).find((e) => /(^|\/)node\.exe$/i.test(e.name));
  if (!entry) throw new Error('node.exe introuvable dans l\'archive Node.js');
  fs.mkdirSync(path.join(stage, 'node'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'node', 'node.exe'), entry.read());
  const lic = readZip(buf).find((e) => /(^|\/)LICENSE$/.test(e.name));
  if (lic) fs.writeFileSync(path.join(stage, 'node', 'LICENSE'), lic.read());
  console.log(`node.exe ${nodeVersion} embarque`);
}

const files = walk(stage).sort();
const entries = files.map((f) => ({ name: `SupervisionNG/${f.split(path.sep).join('/')}`, data: fs.readFileSync(path.join(stage, f)) }));
const out = path.join(dist, `${baseName}.zip`);
writeZip(out, entries);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`paquet cree : ${path.relative(root, out)} (${files.length} fichiers, ${(fs.statSync(out).size / 1e6).toFixed(1)} Mo)`);
