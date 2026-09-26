// Point d'entree de SupervisionNG.
//   node server/index.js [--config fichier] [--demo] [--port 8080] [--host 0.0.0.0] [--open]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, parseArgs, ROOT_DIR } from './config.js';
import { configureLogger, createLogger } from './util/logger.js';
import { TopologyStore } from './model/store.js';
import { createCollector } from './collectors/index.js';
import { createHttpServer } from './http/app.js';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const args = parseArgs();

if (args.help) {
  console.log(`SupervisionNG ${pkg.version}
Usage : node server/index.js [options]
  --config, -c <fichier>  configuration (defaut : config/supervisionng.json)
  --demo                  infrastructure de demonstration simulee
  --port, -p <port>       port HTTP (defaut 8080)
  --host <adresse>        adresse d'ecoute (defaut 127.0.0.1, 0.0.0.0 pour tout le reseau)
  --open / --no-open      ouvrir la vue dans le navigateur au demarrage`);
  process.exit(0);
}

let loaded;
try {
  loaded = loadConfig(args);
} catch (err) {
  console.error(`Configuration invalide : ${err.message}`);
  process.exit(1);
}
const { config, demo, configFile } = loaded;
configureLogger(config.log);
const log = createLogger('main');
log.info(`SupervisionNG ${pkg.version} (Node.js ${process.version}, ${process.platform})`);
if (configFile) log.info(`configuration : ${configFile}`);
for (const w of loaded.warnings) log.warn(w);

const store = new TopologyStore({
  thresholds: config.thresholds,
  networks: config.networks,
  maxFlows: config.flows?.maxFlows,
  history: { size: config.history?.size, stepMs: (config.history?.stepSeconds ?? 10) * 1000 },
  logger: createLogger('store'),
});

let inventoryNetworks = [];
const info = { version: pkg.version, demo, ingestSources: new Map() };
const collectors = [];

const ctx = {
  config,
  logger: createLogger('collector'),
  store,
  publish: (sourceId, snapshot, opts = {}) => store.publish(sourceId, snapshot, opts),
  setInventoryNetworks: (nets) => {
    inventoryNetworks = nets || [];
    store.setNetworks([...(config.networks || []), ...inventoryNetworks]);
  },
};

async function startCollectors() {
  const list = [...config.collectors];
  if (config.inventory && !list.some((c) => c.type === 'inventory')) {
    list.unshift({ type: 'inventory', name: 'inventaire', file: config.inventory });
  }
  for (const cfg of list) {
    try {
      const c = await createCollector(cfg, ctx);
      // Donnees considerees obsoletes apres 3 intervalles sans collecte reussie.
      const staleAfterMs = cfg.type === 'inventory' ? null : c.intervalMs * 3 + 60000;
      const publish = ctx.publish;
      c.ctx = { ...ctx, publish: (sid, snap, opts) => publish(sid, snap, { staleAfterMs, ...opts }) };
      collectors.push(c);
      await c.start();
      log.info(`collecteur demarre : ${c.name} (${cfg.type}, toutes les ${c.intervalMs / 1000} s)`);
    } catch (err) {
      log.error(`collecteur ${cfg.name} (${cfg.type}) non demarre : ${err.message}`);
      collectors.push({ name: cfg.name, status: () => ({ name: cfg.name, type: cfg.type, state: 'error', lastError: err.message }), stop: async () => {} });
    }
  }
}

function collectorStatuses() {
  return [...collectors.flatMap((c) => c.status()), ...info.ingestSources.values()];
}

const server = createHttpServer({ config, store, collectors: collectorStatuses, logger: createLogger('main'), info });

// Reconstruction periodique : detection des donnees obsoletes meme sans nouvelle collecte.
const staleTimer = setInterval(() => store.scheduleRebuild(), 15000);
staleTimer.unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') log.error(`le port ${config.server.port} est deja utilise (option --port pour en choisir un autre)`);
  else if (err.code === 'EACCES') log.error(`acces refuse au port ${config.server.port}`);
  else log.error('erreur serveur', err);
  process.exit(1);
});

server.listen(config.server.port, config.server.host, async () => {
  const proto = config.server.https ? 'https' : 'http';
  const shownHost = ['0.0.0.0', '::'].includes(config.server.host) ? 'localhost' : config.server.host;
  const url = `${proto}://${shownHost}:${server.address().port}/`;
  log.info(`vue 3D disponible sur ${url}${demo ? '  (MODE DEMONSTRATION)' : ''}`);
  await startCollectors();
  if (config.server.openBrowser) openBrowser(url);
});

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // Edge en mode application (fenetre sans barre d'adresse) si disponible, sinon navigateur par defaut.
      const edge = [
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ].find((p) => p && fs.existsSync(p));
      if (edge) spawn(edge, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
      else spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    }
  } catch (err) {
    log.warn(`ouverture du navigateur impossible : ${err.message}`);
  }
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`arret (${signal})...`);
  await Promise.allSettled(collectors.map((c) => c.stop?.()));
  server.closeSse?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => shutdown(sig));
process.on('unhandledRejection', (err) => log.error('promesse rejetee non geree', err));
