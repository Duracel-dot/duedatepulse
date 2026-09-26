// Journalisation minimale : console + fichier optionnel (logs/supervisionng.log).
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS.info;
let fileStream = null;

export function configureLogger({ level = 'info', file = null } = {}) {
  minLevel = LEVELS[level] ?? LEVELS.info;
  if (fileStream) { fileStream.end(); fileStream = null; }
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file);
    fileStream = fs.createWriteStream(file, { flags: 'a' });
  }
}

function rotate(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 10 * 1024 * 1024) fs.renameSync(file, `${file}.1`);
  } catch { /* fichier absent */ }
}

function write(level, scope, msg, extra) {
  if (LEVELS[level] < minLevel) return;
  const ts = new Date().toISOString();
  let line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    line += ' ' + (extra instanceof Error ? (extra.stack || extra.message) : safeJson(extra));
  }
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  if (fileStream) fileStream.write(line + '\n');
}

function safeJson(v) {
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
}

export function createLogger(scope) {
  return {
    debug: (m, e) => write('debug', scope, m, e),
    info: (m, e) => write('info', scope, m, e),
    warn: (m, e) => write('warn', scope, m, e),
    error: (m, e) => write('error', scope, m, e),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}
