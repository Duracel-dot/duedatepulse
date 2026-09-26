// Chargement de la configuration (config/supervisionng.json, format JSONC).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsoncFile } from './util/jsonc.js';
import { resolveSecret, resolveSecrets } from './util/secrets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');

export const DEFAULTS = {
  server: {
    host: '127.0.0.1',
    port: 8080,
    https: null,        // { pfx, passphrase } ou { cert, key }
    auth: null,         // { username, password } -> authentification HTTP Basic
    ingestToken: null,  // jeton exige par POST /api/ingest/:source
    openBrowser: false, // ouvre la vue au demarrage (Edge en mode application sous Windows)
  },
  inventory: 'config/inventory.json',
  collectors: [],
  thresholds: {},
  networks: [],
  flows: { maxFlows: 600 },
  history: { size: 360, stepSeconds: 10 },
  log: { level: 'info', file: 'logs/supervisionng.log' },
  ui: { title: 'SupervisionNG' },
};

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { demo: false, config: null, port: null, host: null, open: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') args.demo = true;
    else if (a === '--config' || a === '-c') args.config = argv[++i];
    else if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--open') args.open = true;
    else if (a === '--no-open') args.open = false;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

/**
 * @returns {{config:object, configFile:string|null, demo:boolean, warnings:string[]}}
 */
export function loadConfig(args = parseArgs()) {
  const warnings = [];
  const configFile = path.resolve(ROOT_DIR, args.config || process.env.SNG_CONFIG || 'config/supervisionng.json');
  let user = {};
  let found = false;
  if (fs.existsSync(configFile)) {
    user = readJsoncFile(configFile);
    found = true;
  } else if (args.config || process.env.SNG_CONFIG) {
    throw new Error(`fichier de configuration introuvable : ${configFile}`);
  }

  const config = deepMerge(structuredClone(DEFAULTS), user);
  if (args.port) config.server.port = args.port;
  if (args.host) config.server.host = args.host;
  if (args.open != null) config.server.openBrowser = args.open;
  if (process.env.SNG_PORT) config.server.port = Number(process.env.SNG_PORT);
  if (process.env.SNG_HOST) config.server.host = process.env.SNG_HOST;

  // Sans configuration, ou avec --demo : infrastructure simulee.
  const demo = args.demo || !found;
  if (demo) {
    if (!found) warnings.push(`aucune configuration (${path.relative(ROOT_DIR, configFile)}) : demarrage en mode demonstration`);
    config.collectors = [{ type: 'demo', name: 'demo' }];
    config.inventory = null;
  }

  config.collectors = (config.collectors || [])
    .filter((c) => c && c.enabled !== false)
    .map((c, i) => ({ ...c, name: c.name || (config.collectors.filter((x) => x.type === c.type).length > 1 ? `${c.type}-${i + 1}` : c.type) }));

  if (config.inventory) config.inventory = path.resolve(ROOT_DIR, config.inventory);
  if (config.log?.file) config.log.file = path.resolve(ROOT_DIR, config.log.file);

  // Secrets (env:, dpapi:, file:) resolus au dernier moment, collecteur par collecteur,
  // pour qu'un secret manquant ne desactive que le collecteur concerne.
  config.collectors = config.collectors.map((c) => {
    try {
      return resolveSecrets(c);
    } catch (err) {
      warnings.push(`collecteur ${c.name} desactive : ${err.message}`);
      return null;
    }
  }).filter(Boolean);
  // Jeton d'ingestion absent : on continue (ingestion limitee a la machine locale).
  if (config.server.ingestToken) {
    try {
      config.server.ingestToken = resolveSecret(config.server.ingestToken);
    } catch (err) {
      warnings.push(`server.ingestToken ignore (${err.message}) : ingestion acceptee uniquement en local`);
      config.server.ingestToken = null;
    }
  }
  try {
    config.server = resolveSecrets(config.server);
  } catch (err) {
    throw new Error(`configuration serveur : ${err.message}`);
  }

  const names = new Set();
  for (const c of config.collectors) {
    if (names.has(c.name)) throw new Error(`deux collecteurs portent le nom "${c.name}" : ajoutez un champ "name" distinct`);
    names.add(c.name);
  }
  return { config, configFile: found ? configFile : null, demo, warnings };
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
