// Execution de scripts PowerShell (collecteurs Windows natifs).
//
// Choix techniques :
//  - on utilise -File (et non -EncodedCommand, souvent signale par les EDR) ;
//  - les parametres passent par la variable d'environnement SNG_PARAMS (JSON),
//    ce qui evite tous les problemes de quoting de la ligne de commande Windows ;
//  - les identifiants eventuels passent par SNG_USER / SNG_PASS (jamais en argument) ;
//  - le script ecrit un unique document JSON sur stdout (UTF-8).
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PS_SCRIPTS_DIR = path.resolve(here, '../../scripts/ps');

let cachedExe;

/** Trouve l'executable PowerShell : powershell.exe (Windows) ou pwsh (PowerShell 7). */
export function findPowerShell(preferred) {
  if (preferred) return preferred;
  if (cachedExe !== undefined) return cachedExe;
  const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
  cachedExe = null;
  for (const exe of candidates) {
    try {
      const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
        timeout: 15000, windowsHide: true, encoding: 'utf8',
      });
      if (r.status === 0) { cachedExe = exe; break; }
    } catch { /* suivant */ }
  }
  return cachedExe;
}

export class PowerShellError extends Error {
  constructor(message, { stderr = '', code = null } = {}) {
    super(message);
    this.name = 'PowerShellError';
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * Lance scripts/ps/<scriptName> et retourne le JSON produit.
 * @param {string} scriptName  ex. 'hyperv.ps1'
 * @param {object} params      transmis via SNG_PARAMS
 * @param {{timeoutMs?:number, credential?:{username:string,password:string}, exe?:string}} opts
 */
export function runPowerShellScript(scriptName, params = {}, opts = {}) {
  const exe = findPowerShell(opts.exe);
  if (!exe) {
    return Promise.reject(new PowerShellError('PowerShell introuvable (powershell.exe ou pwsh requis)'));
  }
  const file = path.join(PS_SCRIPTS_DIR, scriptName);
  const env = { ...process.env, SNG_PARAMS: JSON.stringify(params) };
  delete env.SNG_USER;
  delete env.SNG_PASS;
  if (opts.credential?.username) {
    env.SNG_USER = opts.credential.username;
    env.SNG_PASS = opts.credential.password ?? '';
  }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file];
  const timeoutMs = opts.timeoutMs ?? 60000;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new PowerShellError(`Impossible de lancer ${exe} : ${err.message}`));
      return;
    }
    const out = [];
    const errOut = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      killTree(child);
      reject(new PowerShellError(`${scriptName} : delai depasse (${timeoutMs} ms)`));
    }, timeoutMs);

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => errOut.push(d));
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new PowerShellError(`${scriptName} : ${err.message}`));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(errOut).toString('utf8').trim();
      try {
        resolve(parsePowerShellJson(stdout));
      } catch (err) {
        const detail = stderr || stdout.trim().slice(0, 500) || err.message;
        reject(new PowerShellError(`${scriptName} (code ${code}) : ${detail}`, { stderr, code }));
      }
    });
  });
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * Extrait le document JSON de la sortie PowerShell (tolere BOM, lignes parasites
 * avant/apres, comme des avertissements de modules).
 */
export function parsePowerShellJson(stdout) {
  const text = String(stdout).replace(/^﻿/, '').trim();
  if (!text) throw new Error('sortie vide');
  try {
    return JSON.parse(text);
  } catch { /* on tente d'isoler le JSON */ }
  const start = text.search(/[[{]/);
  const endObj = text.lastIndexOf('}');
  const endArr = text.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('sortie non JSON');
}

/**
 * ConvertTo-Json de Windows PowerShell 5.1 "deballe" les tableaux d'un seul
 * element et produit null pour les tableaux vides : on normalise.
 */
export function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Dates PowerShell 5.1 : "/Date(1700000000000)/" ou ISO. */
export function psDate(v) {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v);
  const m = String(v).match(/\/Date\((-?\d+)/);
  if (m) return new Date(Number(m[1]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
