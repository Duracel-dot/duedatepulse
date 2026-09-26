// Resolution des secrets dans la configuration.
//   "env:NOM"        -> variable d'environnement NOM
//   "dpapi:BASE64"   -> secret chiffre avec DPAPI (Windows, portee LocalMachine),
//                       produit par scripts/protect-secret.ps1
//   "file:chemin"    -> contenu d'un fichier (1re ligne)
// Toute autre valeur est retournee telle quelle.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { powershellEnv } from './powershell.js';

const SECRET_FIELDS = /^(password|pass|secret|token|tokenSecret|community|authKey|privKey|apiKey)$/i;

export function resolveSecret(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('env:')) {
    const name = value.slice(4);
    const v = process.env[name];
    if (v == null) throw new Error(`variable d'environnement ${name} absente`);
    return v;
  }
  if (value.startsWith('file:')) {
    return fs.readFileSync(value.slice(5), 'utf8').split(/\r?\n/)[0];
  }
  if (value.startsWith('dpapi:')) {
    return unprotectDpapi(value.slice(6));
  }
  return value;
}

function unprotectDpapi(b64) {
  if (process.platform !== 'win32') throw new Error('secret dpapi: uniquement disponible sous Windows');
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$b = [Convert]::FromBase64String($env:SNG_DPAPI)',
    '$p = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)',
    '[Console]::Out.Write([Convert]::ToBase64String($p))',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...powershellEnv('powershell.exe'), SNG_DPAPI: b64 }, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  if (r.status !== 0) throw new Error(`dechiffrement DPAPI impossible : ${(r.stderr || '').trim()}`);
  return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
}

/** Resout recursivement les champs "secrets" d'un objet de configuration (copie). */
export function resolveSecrets(obj) {
  if (Array.isArray(obj)) return obj.map(resolveSecrets);
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && (SECRET_FIELDS.test(k) || /^(env|dpapi|file):/.test(v) && SECRET_FIELDS.test(k))) {
      out[k] = resolveSecret(v);
    } else if (v && typeof v === 'object') {
      out[k] = resolveSecrets(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
