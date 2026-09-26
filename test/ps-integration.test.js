// Scripts PowerShell : encodage (toutes plateformes) et execution reelle (Windows uniquement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPowerShellScript, asArray, parsePowerShellJson, powershellEnv } from '../server/util/powershell.js';
import { windowsToSnapshot } from '../server/collectors/windows.js';
import { hypervToSnapshot } from '../server/collectors/hyperv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'logs']);

// PowerShell pour les tests avec cmdlets simulees : Windows PowerShell 5.1 sous Windows,
// sinon pwsh s'il est installe (ou SNG_TEST_PWSH=/chemin/vers/pwsh).
function findTestPowerShell() {
  const candidates = [process.env.SNG_TEST_PWSH, isWindows ? 'powershell.exe' : 'pwsh'].filter(Boolean);
  for (const exe of candidates) {
    try {
      const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
        encoding: 'utf8', windowsHide: true, timeout: 30000,
      });
      if (r.status === 0) return exe;
    } catch { /* suivant */ }
  }
  return null;
}
const psExe = findTestPowerShell();

/** Execute un script de scripts/ps avec les cmdlets CIM / Hyper-V simulees (test/fixtures/ps-mocks.ps1). */
function runMocked(script, params, extraEnv = {}) {
  const mocks = path.join(root, 'test', 'fixtures', 'ps-mocks.ps1');
  const file = path.join(root, 'scripts', 'ps', script);
  const env = { ...powershellEnv(psExe), SNG_PARAMS: JSON.stringify(params), ...extraEnv };
  if (!extraEnv.SNG_USER) { delete env.SNG_USER; delete env.SNG_PASS; }
  const r = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `. '${mocks}'; & '${file}'`], {
    env, encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  assert.equal(r.error, undefined, String(r.error));
  return parsePowerShellJson(r.stdout || r.stderr);
}

function findFiles(dir, ext, recursive = true, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      if (recursive && !SKIP_DIRS.has(d.name)) findFiles(path.join(dir, d.name), ext, recursive, out);
    } else if (d.name.toLowerCase().endsWith(ext)) {
      out.push(path.join(dir, d.name));
    }
  }
  return out;
}

test('scripts .ps1 en ASCII pur (Windows PowerShell 5.1 lit les fichiers sans BOM en ANSI)', () => {
  const files = findFiles(root, '.ps1');
  assert.ok(files.length > 0, 'aucun script .ps1 trouve');
  const bad = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const i = buf.findIndex((b) => b > 0x7f);
    if (i >= 0) {
      const line = buf.subarray(0, i).toString('latin1').split('\n').length;
      bad.push(`${path.relative(root, f)}:${line} (octet 0x${buf[i].toString(16)})`);
    }
  }
  assert.deepEqual(bad, [], `caracteres non ASCII :\n${bad.join('\n')}`);
});

test('scripts .ps1 : aucune erreur de syntaxe (analyseur PowerShell)', { skip: !psExe && 'PowerShell absent' }, () => {
  const files = [
    ...findFiles(path.join(root, 'scripts', 'ps'), '.ps1', false),
    ...findFiles(path.join(root, 'scripts'), '.ps1', false),
    ...findFiles(path.join(root, 'test', 'fixtures'), '.ps1', false),
  ];
  assert.ok(files.length > 0);
  const script = [
    '$ErrorActionPreference = \'Stop\'',
    '$files = $env:SNG_FILES | ConvertFrom-Json',
    '$out = @()',
    'foreach ($f in $files) { $tokens = $null; $errs = $null; ' +
      '[void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errs); ' +
      'foreach ($e in $errs) { $out += (\'{0}:{1}: {2}\' -f $f, $e.Extent.StartLineNumber, $e.Message) } }',
    '[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress))',
  ].join('; ');
  const r = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, SNG_FILES: JSON.stringify(files) }, encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  assert.equal(r.status, 0, r.stderr);
  const errors = asArray(parsePowerShellJson(r.stdout));
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('windows.ps1 sur la machine locale', { skip: !isWindows && 'Windows uniquement', timeout: 240000 }, async () => {
  const data = await runPowerShellScript('windows.ps1', {
    targets: ['localhost', 'sng-cible-inexistante.invalid'], flows: true, opTimeoutSec: 30,
  }, { timeoutMs: 230000 });
  const rows = asArray(data.targets);
  assert.equal(rows.length, 2);
  const local = rows.find((t) => t.name === 'localhost');
  assert.equal(local.ok, true, local.error);
  const missing = rows.find((t) => t.name !== 'localhost');
  assert.equal(missing.ok, false);
  assert.equal(typeof missing.error, 'string');

  const snap = windowsToSnapshot(data);
  const e = snap.entities.find((x) => x.status !== 'critical');
  assert.ok(e, JSON.stringify(snap.entities));
  assert.ok(['server', 'vm'].includes(e.type), e.type);
  assert.equal(typeof e.metrics.cpu, 'number', JSON.stringify(e.metrics));
  assert.equal(typeof e.metrics.mem, 'number');
  assert.ok(e.keys.some((k) => k.startsWith('host:')));
  assert.ok(e.attrs.os);
  assert.ok(Array.isArray(snap.flows));
  assert.equal(snap.entities.find((x) => x !== e).status, 'critical');
});

test('hyperv.ps1 sur la machine locale (JSON valide meme sans Hyper-V)', { skip: !isWindows && 'Windows uniquement', timeout: 240000 }, async () => {
  const data = await runPowerShellScript('hyperv.ps1', { targets: ['localhost'] }, { timeoutMs: 230000 });
  const [row] = asArray(data.targets);
  assert.equal(row.ok, true, row.error);
  const snap = hypervToSnapshot(data);
  const hv = snap.entities.find((e) => e.type === 'hypervisor');
  assert.ok(hv);
  assert.equal(hv.parent, `${hv.id}/hw`);
  assert.ok(['ok', 'warning'].includes(hv.status), hv.statusText);
});

test('windows.ps1 avec cmdlets simulees : JSON complet et conversion', { skip: !psExe && 'PowerShell absent', timeout: 180000 }, () => {
  const data = runMocked('windows.ps1', {
    targets: ['srv01', 'down01'], flows: true, serviceExclude: ['MonService'],
  }, { SNG_USER: 'CORP\\svc-supervision', SNG_PASS: 'p@ss' });
  const rows = asArray(data.targets);
  assert.equal(rows.length, 2, JSON.stringify(data).slice(0, 500));
  const down = rows.find((t) => t.name === 'down01');
  assert.equal(down.ok, false);
  assert.match(down.error, /opération sur down01/);

  const snap = windowsToSnapshot(data, { localName: 'SUPERV01' });
  const e = snap.entities.find((x) => x.id === 'windows:srv01');
  assert.equal(e.type, 'server');
  assert.equal(e.status, 'warning');
  // exclus : liste par defaut (sppsvc), service par utilisateur, demarrage differe termine, configuration
  assert.deepEqual(e.attrs.stoppedServices, ['W32Time']);
  assert.deepEqual(e.metrics, { cpu: 25.5, mem: 75, disk: 95, uptimeS: 7200 });
  assert.equal(e.attrs.lastBoot, '2025-09-20T06:00:00.000Z');
  assert.equal(e.attrs.disks[0].label, 'Système');
  assert.deepEqual(e.attrs.ip, ['10.0.0.5']);
  assert.ok(e.keys.includes('serial:ABC1234'));
  assert.deepEqual(snap.flows.map((f) => [f.src.ip, f.dst.ip, f.port, f.app]).sort(), [
    ['10.0.0.5', '10.0.0.1', 389, 'ldap'],
    ['10.0.0.9', '10.0.0.5', 1433, 'mssql'],
  ]);
  assert.equal(snap.entities.find((x) => x.id === 'windows:down01').status, 'critical');

  // WinRM en HTTPS : option de session -UseSsl et port transmis a New-CimSession
  const ssl = runMocked('windows.ps1', { targets: ['srv01'], port: 5986, useSsl: true }, { SNG_MOCK_EXPECT_SSL: '1' });
  assert.equal(asArray(ssl.targets)[0].ok, true, asArray(ssl.targets)[0].error);
  const hvSsl = runMocked('hyperv.ps1', { targets: ['hv01'], port: 5986, useSsl: true }, { SNG_MOCK_EXPECT_SSL: '1' });
  assert.equal(asArray(hvSsl.targets)[0].ok, true, asArray(hvSsl.targets)[0].error);
});

test('hyperv.ps1 avec cmdlets simulees : hote, VM, KVP, GUID BIOS', { skip: !psExe && 'PowerShell absent', timeout: 180000 }, () => {
  const data = runMocked('hyperv.ps1', { targets: ['hv01', 'down02'] });
  const snap = hypervToSnapshot(data, { localName: 'SUPERV01' });
  assert.deepEqual(snap.entities.map((x) => x.id), [
    'hyperv:hv01/hw',
    'hyperv:hv01',
    'hyperv:vm:b3a1c9d2-7e4f-4a6b-8c1d-2e3f4a5b6c7d',
    'hyperv:vm:c4d5e6f7-0a1b-4c2d-9e3f-405162738495',
    'hyperv:down02',
  ]);
  const hv = snap.entities[1];
  assert.equal(hv.attrs.cluster, 'CL01');
  assert.equal(hv.attrs.memGB, 512);
  assert.deepEqual(hv.attrs.vSwitches, [{ name: 'vSwitch-LAN', type: 'External', uplink: 'NIC' }]);
  const web = snap.entities[2];
  assert.equal(web.status, 'ok');
  for (const k of ['uuid:b3a1c9d2-7e4f-4a6b-8c1d-2e3f4a5b6c7d', 'uuid:d5b6f8e2-1c3a-4e5b-9a7d-2f4e6c8a0b1d',
    'serial:5175-2891-3316-8812-9460-3517-24', 'host:srv-web01', 'fqdn:srv-web01.corp.local', 'mac:00:15:5d:0a:1b:01', 'ip:10.10.30.21']) {
    assert.ok(web.keys.includes(k), `${k} absent de ${web.keys}`);
  }
  assert.equal(web.attrs.os, 'Windows Server 2022 Datacenter');
  assert.equal(web.attrs.vlan, 30);
  assert.deepEqual(web.metrics, { cpu: 7, mem: 75, uptimeS: 518400 });
  const app = snap.entities[3];
  assert.equal(app.status, 'off');
  assert.equal(app.attrs.vlan, undefined);
  assert.deepEqual(app.attrs.mac, ['00:15:5d:0a:1b:02']);
  assert.equal(snap.entities[4].status, 'critical');

  const noModule = hypervToSnapshot(runMocked('hyperv.ps1', { targets: ['hv01'] }, { SNG_MOCK_NO_HYPERV: '1' }));
  const hv2 = noModule.entities.find((x) => x.type === 'hypervisor');
  assert.equal(hv2.status, 'warning');
  assert.match(hv2.statusText, /Module PowerShell Hyper-V indisponible/);
});
