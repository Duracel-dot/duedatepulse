// Collecteur de demonstration : simule une infrastructure vivante (charge,
// flux applicatifs, incidents, bascule HA, vMotion...) et la publie sous la
// forme de plusieurs sources, exactement comme le feraient les vrais
// collecteurs (inventaire, vCenter, Hyper-V, Proxmox, WinRM, SNMP, NetFlow).
// Les flux sont publies par adresse IP : la correlation IP -> VM est donc
// faite par le magasin, comme en production.
import { Collector } from './base.js';
import { buildDemoWorld, mulberry32 } from './demo-world.js';
import { inventoryToSnapshot } from '../model/inventory.js';
import { buildKeys, hostKey } from '../../shared/model.js';
import { buildIndex, findPath } from '../../shared/graph.js';

const G = 1e9;
const M = 1e6;
const DAY_S = 600;       // une "journee" simulee dure 10 minutes
const BACKUP_FROM = 0.72; // fenetre de sauvegarde (fraction de journee)
const BACKUP_TO = 0.9;

const SOURCES = [
  { id: 'demo:inventaire', name: 'inventaire', type: 'inventory', priority: 100 },
  { id: 'demo:vcenter', name: 'vcenter-par', type: 'vsphere' },
  { id: 'demo:hyperv', name: 'hyperv-par', type: 'hyperv' },
  { id: 'demo:proxmox', name: 'proxmox-lyo', type: 'proxmox' },
  { id: 'demo:windows', name: 'windows-serveurs', type: 'windows' },
  { id: 'demo:snmp', name: 'snmp-reseau', type: 'snmp' },
  { id: 'demo:netflow', name: 'netflow', type: 'netflow' },
];

class DemoCollector extends Collector {
  constructor(cfg, ctx) {
    super({ interval: 3, ...cfg }, ctx);
    this.world = buildDemoWorld(cfg.seed);
    this.rnd = mulberry32((cfg.seed || 7) + 17);
    this.t0 = Date.now();
    this.incidents = [];
    this.nextIncidentAt = Date.now() + 15000;
    this.nextDrsAt = Date.now() + 30000;
    this.migrations = [];
    this.pathCache = new Map();
    this.sourceStates = new Map();
    this.inv = inventoryToSnapshot(this.world.inventory);
    this.hostById = new Map(this.world.hosts.map((h) => [h.id, h]));
    this.vmById = new Map(this.world.vms.map((v) => [v.id, v]));
    this.netById = new Map(this.world.netDevices.map((d) => [d.id, d]));
    this.physById = new Map(this.world.physicals.map((p) => [p.id, p]));
    this.linkState = new Map(); // id lien -> {status, text}
    this.flowDefs = buildFlowDefs(this.world);
  }

  defaultInterval() { return 3; }

  async start() {
    this.publishSource('demo:inventaire', this.inv.snapshot);
    this.ctx.setInventoryNetworks?.(this.inv.networks);
    await super.start();
  }

  async poll() {
    const now = Date.now();
    this.step(now);
    return null;
  }

  status() {
    const base = super.status();
    return SOURCES.map((s) => ({
      name: s.name, type: s.type, state: base.state === 'error' ? 'error' : 'ok', simulated: true,
      lastRun: this.sourceStates.get(s.id)?.at || base.lastRun, lastError: base.lastError,
      counts: this.sourceStates.get(s.id)?.counts || null, interval: s.type === 'inventory' ? null : this.intervalMs / 1000,
    }));
  }

  publishSource(id, snapshot) {
    const src = SOURCES.find((s) => s.id === id);
    const opts = { priority: src?.priority ?? 10 };
    if (src?.type === 'inventory') opts.staleAfterMs = null;
    this.ctx.publish(id, snapshot, opts);
    this.sourceStates.set(id, {
      at: new Date().toISOString(),
      counts: { entities: snapshot.entities?.length || 0, links: snapshot.links?.length || 0, flows: snapshot.flows?.length || 0 },
    });
  }

  // ------------------------------------------------------------------------

  step(now) {
    const t = (now - this.t0) / 1000;
    const day = ((t / DAY_S) + 0.35) % 1;          // demarre en milieu de matinee
    const dayLoad = 0.5 - 0.5 * Math.cos(2 * Math.PI * Math.max(0, Math.min(1, (day - 0.25) / 0.5))); // 0 la nuit, 1 a midi
    const backup = day > BACKUP_FROM && day < BACKUP_TO;
    this.sim = { now, t, day, dayLoad, backup };

    this.updateIncidents(now);
    this.updateMigrations(now);

    const flows = this.computeFlows();
    const loads = this.routeFlows(flows);
    const vmStats = this.computeVmMetrics();
    const hostStats = this.computeHostMetrics(vmStats);

    this.publishSource('demo:vcenter', this.snapshotVirtualization('vsphere', vmStats, hostStats));
    this.publishSource('demo:hyperv', this.snapshotVirtualization('hyperv', vmStats, hostStats));
    this.publishSource('demo:proxmox', this.snapshotVirtualization('proxmox', vmStats, hostStats));
    this.publishSource('demo:windows', this.snapshotWindows(vmStats));
    this.publishSource('demo:snmp', this.snapshotSnmp(loads));
    this.publishSource('demo:netflow', { entities: [], links: [], flows: flows.map((f) => f.out) });
  }

  // ------------------------------------------------------------------ incidents

  updateIncidents(now) {
    for (const inc of [...this.incidents]) {
      if (inc.phase2At && now >= inc.phase2At && !inc.phase2Done) {
        inc.phase2Done = true;
        inc.phase2?.();
      }
      if (now >= inc.until) {
        inc.end?.();
        this.incidents.splice(this.incidents.indexOf(inc), 1);
        this.log.info(`demo : fin d'incident ${inc.kind}`);
      }
    }
    if (now >= this.nextIncidentAt && this.incidents.length < 3) {
      this.nextIncidentAt = now + 20000 + this.rnd() * 30000;
      this.startIncident(now);
    }
    if (now >= this.nextDrsAt) {
      this.nextDrsAt = now + 25000 + this.rnd() * 25000;
      this.drsBalance();
    }
  }

  startIncident(now) {
    const kinds = ['vm-cpu', 'vm-cpu', 'disk-full', 'service', 'host-down', 'link-down', 'wan-latency', 'rack-heat', 'ddos', 'storage-latency'];
    const active = new Set(this.incidents.map((i) => i.kind));
    const choices = kinds.filter((k) => !active.has(k) || k === 'vm-cpu');
    const kind = choices[Math.floor(this.rnd() * choices.length)];
    const dur = (s) => now + s * 1000 * (0.8 + this.rnd() * 0.4);
    const running = this.world.vms.filter((v) => v.powered && !v.override);
    const pick = (arr) => arr[Math.floor(this.rnd() * arr.length)];
    let inc = null;

    switch (kind) {
      case 'vm-cpu': {
        const vm = pick(running);
        if (!vm) return;
        vm.override = { cpu: 96 + this.rnd() * 3.5 };
        inc = { kind, until: dur(90), end: () => { vm.override = null; } };
        break;
      }
      case 'disk-full': {
        const vm = pick(running.filter((v) => v.windows));
        if (!vm) return;
        vm.override = { diskRamp: { from: vm.diskBase, to: 97, t0: now, dur: 60000 } };
        inc = { kind, until: dur(150), end: () => { vm.override = null; } };
        break;
      }
      case 'service': {
        const vm = pick(running.filter((v) => v.windows));
        if (!vm) return;
        const svc = pick(['Spooler', 'W32Time', 'MSSQLSERVER', 'IISADMIN', 'wuauserv', 'Netlogon']);
        vm.override = { service: svc };
        inc = { kind, until: dur(100), end: () => { vm.override = null; } };
        break;
      }
      case 'host-down': {
        const cands = this.world.hosts.filter((h) => !h.down && (h.cluster === 'CL-PROD-PAR' || h.cluster === 'HVCL-PAR') && h.vms.length);
        const host = pick(cands);
        if (!host) return;
        host.down = true;
        host.downText = pick(['Hôte injoignable (NOT_RESPONDING)', 'Écran bleu / arrêt inattendu', 'Défaut alimentation PSU1 et PSU2']);
        const orphans = [...host.vms];
        for (const id of orphans) this.vmById.get(id).orphan = true;
        this.setServerLinks(host.id, 'critical', 'Interface down (hôte hors tension)');
        this.log.info(`demo : panne de l'hote ${host.id} (${orphans.length} VM)`);
        inc = {
          kind, until: dur(110),
          phase2At: now + 15000,
          phase2: () => {
            // Redemarrage HA des VM sur les autres hotes du cluster
            const targets = this.world.hosts.filter((h) => h.cluster === host.cluster && !h.down);
            for (const id of orphans) {
              const vm = this.vmById.get(id);
              const dst = targets.reduce((b, h) => (h.vms.length < b.vms.length ? h : b), targets[0]);
              this.moveVm(vm, dst);
              vm.orphan = false;
              vm.restartedAt = Date.now();
              vm.homeHost = host.id;
            }
          },
          end: () => {
            host.down = false;
            for (const id of orphans) { const vm = this.vmById.get(id); vm.orphan = false; }
            this.setServerLinks(host.id, null);
            // retour progressif (vMotion) d'une partie des VM
            const back = this.world.vms.filter((v) => v.homeHost === host.id).slice(0, Math.max(2, Math.ceil(orphans.length / 2)));
            back.forEach((vm, i) => this.migrations.push({ vm: vm.id, to: host.id, at: Date.now() + 5000 + i * 7000 }));
            for (const vm of this.world.vms) if (vm.homeHost === host.id) vm.homeHost = null;
          },
        };
        break;
      }
      case 'link-down': {
        const host = pick(this.world.hosts.filter((h) => !h.down));
        const l = this.inv.snapshot.links.find((x) => x.b === host.id && this.linkState.get(linkId(x))?.status !== 'critical');
        if (!l) return;
        this.linkState.set(linkId(l), { status: 'critical', text: 'Interface down (perte de porteuse)' });
        this.pathCache.clear();
        inc = { kind, until: dur(75), end: () => { this.linkState.delete(linkId(l)); this.pathCache.clear(); } };
        break;
      }
      case 'wan-latency': {
        const ext = pick(['ext-agence-mrs', 'ext-agence-lil', 'ext-agence-nts']);
        this.wan = { ...(this.wan || {}), [ext]: 180 + this.rnd() * 400 };
        inc = { kind, until: dur(90), end: () => { delete this.wan[ext]; } };
        break;
      }
      case 'rack-heat': {
        const rackId = pick(['A04', 'A05', 'A06', 'B01', 'B02']);
        this.hotRack = { rack: rackId, t0: now };
        inc = { kind, until: dur(120), end: () => { this.hotRack = null; } };
        break;
      }
      case 'ddos': {
        this.ddos = { t0: now };
        inc = { kind, until: dur(60), end: () => { this.ddos = null; } };
        break;
      }
      case 'storage-latency': {
        this.slowStorage = 'stor-par-1';
        inc = { kind, until: dur(80), end: () => { this.slowStorage = null; } };
        break;
      }
      default:
        return;
    }
    this.incidents.push(inc);
    this.log.info(`demo : incident ${kind}`);
  }

  setServerLinks(serverId, status, text) {
    for (const l of this.inv.snapshot.links) {
      if (l.a !== serverId && l.b !== serverId) continue;
      if (status) this.linkState.set(linkId(l), { status, text }); else this.linkState.delete(linkId(l));
    }
    this.pathCache.clear();
  }

  moveVm(vm, dst) {
    const src = this.hostById.get(vm.host);
    if (src) src.vms = src.vms.filter((id) => id !== vm.id);
    dst.vms.push(vm.id);
    vm.host = dst.id;
  }

  drsBalance() {
    const cluster = this.world.hosts.filter((h) => h.cluster === 'CL-PROD-PAR' && !h.down);
    if (cluster.length < 2 || this.migrations.length) return;
    const sorted = [...cluster].sort((a, b) => b.vms.length - a.vms.length);
    const from = sorted[0];
    const to = sorted[sorted.length - 1];
    if (from.vms.length - to.vms.length < 2) {
      // migration occasionnelle meme si equilibre, pour la demonstration
      if (this.rnd() < 0.5) return;
    }
    const vmId = from.vms.find((id) => this.vmById.get(id).powered);
    if (vmId) this.migrations.push({ vm: vmId, to: to.id, at: Date.now() });
  }

  updateMigrations(now) {
    for (const m of [...this.migrations]) {
      const vm = this.vmById.get(m.vm);
      const to = this.hostById.get(m.to);
      if (!vm || !to || to.down) { this.migrations.splice(this.migrations.indexOf(m), 1); continue; }
      if (now < m.at) continue;
      if (!m.started) {
        m.started = now;
        m.from = vm.host;
        vm.migrating = { from: vm.host, to: to.id };
      } else if (now - m.started > 9000) {
        this.moveVm(vm, to);
        vm.migrating = null;
        this.migrations.splice(this.migrations.indexOf(m), 1);
      }
    }
  }

  // ------------------------------------------------------------------ flux

  computeFlows() {
    const { t, dayLoad, backup } = this.sim;
    const out = [];
    const powered = (name) => {
      const vm = this.vmById.get(name);
      return !vm || (vm.powered && !vm.orphan && !(this.hostById.get(vm.host)?.down));
    };
    for (const d of this.flowDefs) {
      if (!powered(d.src.name) || !powered(d.dst.name)) continue;
      let f;
      switch (d.pattern) {
        case 'backup': f = backup ? 0.7 + 0.3 * Math.sin(t / 13 + d.phase) : 0; break;
        case 'batch': f = (Math.sin(t / 45 + d.phase) > 0.6 ? 1 : 0.05); break;
        case 'steady': f = 0.85 + 0.15 * Math.sin(t / 23 + d.phase); break;
        default: f = 0.15 + 0.85 * dayLoad * (0.85 + 0.15 * Math.sin(t / 17 + d.phase));
      }
      if (this.ddos && d.internetIn) f *= 7;
      const bps = d.bps * f * (0.9 + 0.2 * this.rnd());
      if (bps < 1000) continue;
      out.push(this.makeFlow(d.src, d.dst, d.port, d.app, bps));
    }
    // vMotion en cours
    for (const vm of this.world.vms) {
      if (!vm.migrating) continue;
      const a = this.hostById.get(vm.migrating.from);
      const b = this.hostById.get(vm.migrating.to);
      out.push(this.makeFlow({ kind: 'host', name: a.id, ip: a.ip }, { kind: 'host', name: b.id, ip: b.ip }, 8000, 'vmotion', (6 + 3 * this.rnd()) * G));
    }
    return out;
  }

  makeFlow(src, dst, port, app, bps) {
    const pickIp = (ep) => (ep.ips ? ep.ips[Math.floor(this.rnd() * ep.ips.length)] : ep.ip);
    return {
      src, dst, bps,
      out: { src: { ip: pickIp(src) }, dst: { ip: pickIp(dst) }, proto: 'tcp', port, app, bps: Math.round(bps), pps: Math.round(bps / 8 / 900) },
    };
  }

  anchorOf(ep) {
    if (ep.kind === 'vm') return this.vmById.get(ep.name)?.host;
    return ep.name;
  }

  routeFlows(flows) {
    const loads = new Map(); // id lien -> {ab, ba}
    const links = this.currentLinks();
    const index = buildIndex(this.physicalEntities(), links);
    const transit = (id) => {
      const e = index.byId.get(id);
      return e && (e.type === 'switch' || e.type === 'router' || e.type === 'firewall' || e.type === 'external');
    };
    for (const f of flows) {
      const a = this.anchorOf(f.src);
      const b = this.anchorOf(f.dst);
      if (!a || !b || a === b) continue;
      const key = `${a}|${b}`;
      let paths = this.pathCache.get(key);
      if (!paths) {
        const p1 = findPath(a, b, index.adj, { transit });
        const p2 = p1 ? findPath(a, b, index.adj, { transit, avoid: new Set([p1.links[0]?.id, p1.links[p1.links.length - 1]?.id]) }) : null;
        paths = [p1, p2 && p1 && p2.links.length === p1.links.length ? p2 : null].filter(Boolean);
        this.pathCache.set(key, paths);
      }
      if (!paths.length) continue;
      const path = paths[hash(f.out.src.ip + f.out.dst.ip) % paths.length];
      let cur = a;
      for (const l of path.links) {
        const ld = loads.get(l.id) || { ab: 0, ba: 0 };
        if (l.a === cur) { ld.ab += f.bps; cur = l.b; } else { ld.ba += f.bps; cur = l.a; }
        loads.set(l.id, ld);
      }
      f.pathLen = path.links.length;
    }
    // trafic par entite (pour rx/tx des hotes et VM)
    this.entityTraffic = new Map();
    const addT = (id, rx, tx) => {
      const o = this.entityTraffic.get(id) || { rx: 0, tx: 0 };
      o.rx += rx; o.tx += tx;
      this.entityTraffic.set(id, o);
    };
    for (const f of flows) {
      addT(f.src.name, 0, f.bps);
      addT(f.dst.name, f.bps, 0);
    }
    return loads;
  }

  currentLinks() {
    return this.inv.snapshot.links.map((l) => {
      const st = this.linkState.get(linkId(l));
      return { ...l, id: linkId(l), status: st?.status || 'ok' };
    });
  }

  physicalEntities() {
    if (!this._phys) {
      this._phys = this.inv.snapshot.entities.map((e) => ({ id: e.id, type: e.type, cls: e.type === 'external' ? 'external' : 'physical', parent: e.parent }));
    }
    return this._phys;
  }

  // ------------------------------------------------------------------ metriques

  computeVmMetrics() {
    const { t, dayLoad } = this.sim;
    const stats = new Map();
    for (const vm of this.world.vms) {
      if (!vm.powered) { stats.set(vm.id, null); continue; }
      const wave = Math.sin(t / 29 + vm.phase) * 6 + Math.sin(t / 7 + vm.phase * 3) * 3;
      let cpu = vm.cpuBase * (0.45 + 0.75 * dayLoad) + wave + this.rnd() * 3;
      if (vm.app === 'Sauvegarde' && this.sim.backup) cpu = 55 + wave * 2;
      if (vm.restartedAt && Date.now() - vm.restartedAt < 30000) cpu = 70 + this.rnd() * 15; // demarrage
      let mem = vm.memBase + Math.sin(t / 200 + vm.phase) * 4;
      let disk = vm.diskBase + ((t / 60) % 5);
      const o = vm.override || {};
      if (o.cpu) cpu = o.cpu + this.rnd() * 1.5;
      if (o.diskRamp) {
        const k = Math.min(1, (Date.now() - o.diskRamp.t0) / o.diskRamp.dur);
        disk = o.diskRamp.from + (o.diskRamp.to - o.diskRamp.from) * k;
      }
      stats.set(vm.id, {
        cpu: clamp(cpu, 0.5, 100), mem: clamp(mem, 5, 99), disk: clamp(disk, 5, 99.5),
        rxBps: this.entityTraffic.get(vm.id)?.rx || 0, txBps: this.entityTraffic.get(vm.id)?.tx || 0,
      });
    }
    return stats;
  }

  computeHostMetrics(vmStats) {
    const stats = new Map();
    for (const h of this.world.hosts) {
      if (h.down) { stats.set(h.id, null); continue; }
      let cpuCores = 0;
      let memGB = 0;
      for (const id of h.vms) {
        const vm = this.vmById.get(id);
        const s = vmStats.get(id);
        if (!s) continue;
        cpuCores += (s.cpu / 100) * vm.cores;
        memGB += vm.memGB * (0.6 + 0.4 * s.mem / 100);
      }
      const cpu = clamp(3 + (cpuCores / h.cores) * 100 * 1.1, 1, 100);
      const mem = clamp(4 + (memGB / h.memGB) * 100, 1, 100);
      let temp = 38 + cpu * 0.22 + this.rnd() * 2;
      if (this.hotRack?.rack === h.rack) temp += Math.min(40, (Date.now() - this.hotRack.t0) / 1500);
      stats.set(h.id, {
        cpu, mem, temp, powerW: Math.round(280 + cpu * 6.5),
        rxBps: this.entityTraffic.get(h.id)?.rx || 0, txBps: this.entityTraffic.get(h.id)?.tx || 0,
      });
    }
    return stats;
  }

  // ------------------------------------------------------------------ snapshots

  snapshotVirtualization(platform, vmStats, hostStats) {
    const entities = [];
    const prefix = { vsphere: 'vc', hyperv: 'hv', proxmox: 'pve' }[platform];
    const hvName = { vsphere: 'VMware ESXi', hyperv: 'Hyper-V', proxmox: 'Proxmox VE' }[platform];
    for (const h of this.world.hosts.filter((x) => x.platform === platform)) {
      const hs = hostStats.get(h.id);
      const hwId = `${prefix}:${h.moid}/hw`;
      const hvId = `${prefix}:${h.moid}`;
      entities.push({
        id: hwId, type: 'server', name: h.id.toUpperCase(),
        keys: buildKeys({ hostname: h.id, serial: h.serial }),
        status: h.down ? 'critical' : 'ok', statusText: h.down ? h.downText : null,
        attrs: { vendor: h.vendor, model: h.model, serial: h.serial, cpuCores: h.cores, memGB: h.memGB, psu: h.down ? 'en défaut' : 'redondantes' },
        metrics: hs ? { temp: round1(hs.temp), powerW: hs.powerW } : {},
      });
      entities.push({
        id: hvId, type: 'hypervisor', name: platform === 'vsphere' ? `${h.id}.corp.local` : h.id.toUpperCase(), parent: hwId,
        keys: buildKeys({ hostname: h.id, ip: h.ip }),
        status: h.down ? 'critical' : 'ok', statusText: h.down ? h.downText : null,
        attrs: { hypervisor: hvName, version: h.version, cluster: h.cluster, cpuCores: h.cores, memGB: h.memGB, ip: [h.ip], vmCount: h.vms.length },
        metrics: hs ? { cpu: round1(hs.cpu), mem: round1(hs.mem), rxBps: Math.round(hs.rxBps), txBps: Math.round(hs.txBps), uptimeS: Math.round(86400 * 37 + this.sim.t) } : {},
      });
    }
    for (const vm of this.world.vms.filter((v) => v.platform === platform)) {
      const host = this.hostById.get(vm.host);
      const s = vmStats.get(vm.id);
      let status = vm.powered ? 'ok' : 'off';
      let statusText = null;
      if (vm.orphan || (host.down && vm.powered)) { status = 'critical'; statusText = 'VM injoignable (hôte en panne) – redémarrage HA en cours'; }
      entities.push({
        id: `${prefix}:${platform === 'proxmox' ? `${vm.type === 'container' ? 'lxc' : 'qemu'}/${vm.vmid}` : vm.moid}`,
        type: vm.type, name: vm.name, parent: `${prefix}:${host.moid}`,
        keys: buildKeys({ uuid: vm.uuid, hostname: vm.name, mac: vm.mac, ip: vm.ip }),
        status, statusText,
        attrs: {
          powerState: vm.powered ? 'Allumée' : 'Éteinte', os: vm.os, app: vm.app, role: vm.role, cpuCores: vm.cores, memGB: vm.memGB,
          ip: [vm.ip], mac: [vm.mac], vlan: vm.vlan, cluster: vm.cluster,
          migration: vm.migrating ? `vMotion ${vm.migrating.from} -> ${vm.migrating.to}` : undefined,
          restart: vm.restartedAt && Date.now() - vm.restartedAt < 120000 ? 'Redémarrée par HA' : undefined,
        },
        metrics: s && !vm.orphan ? { cpu: round1(s.cpu), mem: round1(s.mem), rxBps: Math.round(s.rxBps), txBps: Math.round(s.txBps) } : {},
      });
    }
    return { entities, links: [], flows: [] };
  }

  // Vue "systeme" (WinRM/CIM) : serveurs physiques Windows + OS des VM Windows
  snapshotWindows(vmStats) {
    const { t } = this.sim;
    const entities = [];
    for (const p of this.world.physicals) {
      const cpu = clamp(p.cpuBase * (0.6 + 0.6 * this.sim.dayLoad) + Math.sin(t / 19 + p.ip.length) * 4 + this.rnd() * 3, 1, 100);
      entities.push({
        id: `windows:${p.id}`, type: 'server', name: p.id.toUpperCase(),
        keys: buildKeys({ hostname: p.id, serial: p.serial, uuid: p.uuid, mac: p.mac, ip: p.ip }),
        status: 'ok',
        attrs: { os: p.os, role: p.role, vendor: p.vendor, model: p.model, cpuCores: p.cores, memGB: p.memGB, ip: [p.ip], domain: 'corp.local' },
        metrics: {
          cpu: round1(p.id === 'bkp-par-01' && this.sim.backup ? 45 + this.rnd() * 10 : cpu),
          mem: round1(p.memBase + Math.sin(t / 90) * 3), disk: round1(p.diskBase + (this.sim.backup && p.id.startsWith('bkp') ? 6 : 0)),
          uptimeS: Math.round(86400 * 64 + t),
          rxBps: Math.round(this.entityTraffic.get(p.id)?.rx || 0), txBps: Math.round(this.entityTraffic.get(p.id)?.tx || 0),
        },
      });
    }
    for (const vm of this.world.vms) {
      if (!vm.windows || !vm.powered) continue;
      const s = vmStats.get(vm.id);
      const host = this.hostById.get(vm.host);
      if (!s || vm.orphan || host.down) {
        entities.push({ id: `windows:${vm.id}`, type: 'vm', name: vm.name.toUpperCase(), keys: [hostKey(vm.name)], status: 'critical', statusText: 'WinRM : hôte injoignable' });
        continue;
      }
      const svc = vm.override?.service;
      entities.push({
        id: `windows:${vm.id}`, type: 'vm', name: vm.name.toUpperCase(),
        keys: buildKeys({ hostname: vm.name, uuid: vm.uuid, mac: vm.mac, ip: vm.ip }),
        status: svc ? 'warning' : 'ok', statusText: svc ? `Service automatique arrêté : ${svc}` : null,
        attrs: { os: vm.os, domain: 'corp.local', stoppedServices: svc ? [svc] : [] },
        metrics: { disk: round1(s.disk), uptimeS: Math.round(86400 * 12 + t) },
      });
    }
    return { entities, links: [], flows: [] };
  }

  snapshotSnmp(loads) {
    const { t } = this.sim;
    const entities = [];
    const links = [];
    const devTraffic = new Map();
    for (const l of this.inv.snapshot.links) {
      const id = linkId(l);
      const ld = loads.get(id) || { ab: 0, ba: 0 };
      const st = this.linkState.get(id);
      const speed = l.speedBps || G;
      const down = st?.status === 'critical';
      const rx = down ? 0 : ld.ba;
      const tx = down ? 0 : ld.ab;
      for (const [dev, r, x] of [[l.a, rx, tx], [l.b, tx, rx]]) {
        const o = devTraffic.get(dev) || { rx: 0, tx: 0 };
        o.rx += r; o.tx += x;
        devTraffic.set(dev, o);
      }
      links.push({
        a: l.a, aPort: l.aPort, b: l.b, bPort: l.bPort, kind: l.kind, speedBps: speed,
        status: st?.status || 'ok', statusText: st?.text || null,
        metrics: { rxBps: Math.round(rx), txBps: Math.round(tx), util: round1(Math.max(rx, tx) / speed * 100) },
      });
    }
    for (const d of this.world.netDevices) {
      const tr = devTraffic.get(d.id) || { rx: 0, tx: 0 };
      const metrics = { rxBps: Math.round(tr.rx), txBps: Math.round(tr.tx), uptimeS: Math.round(86400 * 211 + t) };
      let status = 'ok';
      let statusText = null;
      if (d.type === 'ups') {
        Object.assign(metrics, { load: round1(42 + Math.sin(t / 60) * 5), battery: 100, runtimeMin: 38 });
      } else if (d.type === 'storage') {
        const base = d.id === this.slowStorage ? 14 + this.rnd() * 12 : 0.4 + this.rnd() * 0.6 + (this.sim.backup ? 0.8 : 0);
        Object.assign(metrics, {
          latencyMs: round1(base), disk: d.id === 'stor-par-1' ? 81.5 : d.id === 'stor-par-2' ? 64.2 : 58.7,
          iops: Math.round(20000 + 60000 * this.sim.dayLoad + (this.sim.backup ? 40000 : 0)), cpu: round1(18 + 40 * this.sim.dayLoad),
        });
      } else {
        let cpu = 8 + Math.min(60, (tr.rx + tr.tx) / (4 * G) * 10) + this.rnd() * 3;
        if (this.ddos && (d.type === 'firewall' || d.type === 'router')) cpu = 86 + this.rnd() * 10;
        metrics.cpu = round1(clamp(cpu, 1, 100));
        metrics.temp = round1(42 + metrics.cpu * 0.15 + (this.hotRack?.rack === d.rack ? Math.min(35, (Date.now() - this.hotRack.t0) / 1700) : 0));
      }
      if (d.type === 'firewall' && this.ddos) statusText = 'Pic de sessions entrantes (DDoS suspecté)';
      entities.push({
        id: `snmp:${[].concat(d.ip)[0]}`, type: d.type, name: d.name,
        keys: buildKeys({ hostname: d.hostname, serial: d.serial, ip: d.ip }),
        status, statusText,
        attrs: { vendor: d.vendor, model: d.model, serial: d.serial, sysDescr: `${d.vendor} ${d.model}`, capacityTB: d.capacityTB },
        metrics,
      });
    }
    // Sondes de latence WAN vers les agences (ICMP depuis les routeurs)
    for (const ext of ['ext-agence-mrs', 'ext-agence-lil', 'ext-agence-nts', 'ext-internet', 'ext-m365']) {
      const lat = this.wan?.[ext] ?? (ext === 'ext-internet' ? 8 : ext === 'ext-m365' ? 14 : 12) + this.rnd() * 4;
      entities.push({ id: ext, type: 'external', status: 'ok', metrics: { latencyMs: round1(lat) } });
    }
    return { entities, links, flows: [] };
  }
}

// ---------------------------------------------------------------------------
// Flux applicatifs de la demonstration
// ---------------------------------------------------------------------------

function buildFlowDefs(world) {
  const rnd = mulberry32(99);
  const vm = (name) => {
    const v = world.vms.find((x) => x.name === name);
    if (!v) throw new Error(`VM de demo inconnue : ${name}`);
    return { kind: 'vm', name, ip: v.ip };
  };
  const phys = (id) => {
    const p = world.physicals.find((x) => x.id === id) || world.netDevices.find((x) => x.id === id);
    return { kind: 'phys', name: id, ip: [].concat(p.ip)[0] };
  };
  const host = (id) => {
    const h = world.hosts.find((x) => x.id === id);
    return { kind: 'host', name: id, ip: h.ip };
  };
  const ext = (id, ips) => ({ kind: 'ext', name: id, ips });
  const range = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${Math.floor(rnd() * 250) + 2 + i}`);

  const internet = ext('ext-internet', [...range('203.0.113.', 6), ...range('198.51.100.', 6)]);
  const m365 = ext('ext-m365', range('52.97.', 1).map((p) => `${p}.${Math.floor(rnd() * 250)}`).concat(['52.98.14.20', '40.99.4.33']));
  const agences = [
    ext('ext-agence-mrs', range('10.31.1.', 6)),
    ext('ext-agence-lil', range('10.32.1.', 5)),
    ext('ext-agence-nts', range('10.33.1.', 4)),
  ];
  const vpn = ext('ext-vpn', range('10.99.0.', 5));
  const lbVip = { kind: 'phys', name: 'lb-par-1', ip: '10.10.30.10' };
  const lbSnat = { kind: 'phys', name: 'lb-par-1', ip: '10.10.30.11' };
  const names = (prefix) => world.vms.filter((v) => v.name.startsWith(prefix)).map((v) => v.name);

  const defs = [];
  const F = (src, dst, port, bps, pattern = 'diurnal', extra = {}) => {
    defs.push({ src, dst, port, bps, pattern, phase: rnd() * 6.28, app: extra.app || null, internetIn: !!extra.internetIn });
  };

  // Portail clients : Internet -> LB -> web -> app -> SQL
  F(internet, lbVip, 443, 420 * M, 'diurnal', { internetIn: true });
  for (const w of names('web-portail-')) F(lbSnat, vm(w), 443, 65 * M);
  names('web-portail-').forEach((w, i) => F(vm(w), vm(names('app-portail-')[i % 4]), 8080, 38 * M));
  for (const a of names('app-portail-')) {
    F(vm(a), phys('sql-par-01'), 1433, 45 * M);
    F(vm(a), vm(names('redis-')[0]), 6379, 20 * M);
    F(vm(a), vm('mq-01'), 5672, 6 * M);
  }
  F(phys('sql-par-01'), phys('sql-par-02'), 5022, 180 * M, 'steady', { app: 'replication' });
  // ERP
  for (const ag of agences) F(ag, vm('erp-app-01'), 443, 18 * M);
  for (const a of names('erp-app-')) F(vm(a), vm('erp-db-01'), 1433, 55 * M);
  F(vm('erp-batch-01'), vm('erp-db-01'), 1433, 900 * M, 'batch');
  // Bureaux a distance
  for (const ag of [...agences, vpn]) F(ag, vm(ag === vpn ? 'rds-gw-02' : 'rds-gw-01'), 443, 22 * M);
  names('rds-sh-').forEach((s, i) => F(vm(i % 2 ? 'rds-gw-02' : 'rds-gw-01'), vm(s), 3389, 14 * M));
  for (const s of names('rds-sh-')) F(vm(s), vm(`fs-par-0${(s.length % 2) + 1}`), 445, 30 * M);
  // Fichiers depuis les agences
  for (const ag of agences) F(ag, vm('fs-par-01'), 445, 25 * M);
  F(vm('fs-par-01'), vm('fs-lyo-01'), 5722, 60 * M, 'steady', { app: 'replication' });
  // Messagerie
  for (const e of names('exch-')) F(vm(e), m365, 443, 35 * M);
  for (const ag of agences) F(ag, vm('exch-01'), 443, 6 * M);
  // Acces Internet
  for (const p of names('proxy-')) F(vm(p), internet, 443, 160 * M);
  for (const ag of agences) F(ag, vm('proxy-01'), 3128, 20 * M, 'diurnal', { app: 'http-alt' });
  // Annuaire
  const clients = world.vms.filter((v) => v.windows && v.site === 'par' && !/^dc-/.test(v.name)).map((v) => v.name);
  clients.forEach((c, i) => F(vm(c), vm(i % 2 ? 'dc-par-02' : 'dc-par-01'), i % 3 ? 88 : 389, 0.4 * M));
  for (const ag of agences) F(ag, vm('dc-par-01'), 389, 3 * M);
  F(vm('dc-par-01'), vm('dc-lyo-01'), 135, 2 * M, 'steady', { app: 'replication' });
  F(vm('dc-par-01'), vm('dc-par-02'), 135, 2 * M, 'steady', { app: 'replication' });
  // Kubernetes
  for (const w of names('k8s-worker-')) {
    F(vm(w), vm(names('k8s-master-')[w.length % 3]), 6443, 8 * M, 'steady', { app: 'https' });
    F(lbSnat, vm(w), 443, 25 * M);
    F(vm(w), vm('crm-db-01'), 5432, 6 * M);
  }
  for (const c of names('crm-app-')) F(vm(c), vm('crm-db-01'), 5432, 20 * M);
  F(vm('api-gw-01'), vm('mq-01'), 5672, 15 * M);
  F(vm('api-gw-02'), vm('mq-02'), 5672, 15 * M);
  // Stockage : hyperviseurs -> baies
  for (const h of world.hosts) {
    const stor = h.cluster === 'CL-PROD-PAR' ? 'stor-par-1' : h.cluster === 'HVCL-PAR' ? 'stor-par-2' : 'stor-lyo-1';
    F(host(h.id), phys(stor), h.platform === 'hyperv' ? 3260 : 2049, (h.cluster.includes('PROD') ? 1.4 : 0.5) * G);
  }
  F(phys('stor-par-1'), phys('stor-lyo-1'), 11104, 450 * M, 'steady', { app: 'replication' });
  // Sauvegarde (fenetre nocturne)
  for (const p of names('veeam-proxy-')) F(vm(p), phys('bkp-par-01'), 2500, 2.2 * G, 'backup', { app: 'backup' });
  F(phys('bkp-par-01'), phys('bkp-lyo-01'), 2500, 3.5 * G, 'backup', { app: 'replication' });
  F(vm('veeam-lyo-01'), phys('bkp-lyo-01'), 2500, 0.8 * G, 'backup', { app: 'backup' });
  // Supervision
  for (const d of world.netDevices.slice(0, 18)) F(vm('mon-01'), phys(d.id), 161, 0.3 * M, 'steady');
  for (const h of world.hosts.slice(0, 14)) F(vm('mon-01'), host(h.id), h.platform === 'hyperv' ? 5985 : 443, 0.6 * M, 'steady');
  for (const n of ['web-portail-01', 'app-portail-01', 'k8s-worker-01', 'k8s-worker-02', 'crm-app-01']) F(vm(n), vm('log-01'), 9200, 12 * M, 'steady', { app: 'elasticsearch' });
  // Usine logicielle (Lyon)
  for (const r of names('gitlab-runner-')) {
    F(vm(r), vm('gitlab-01'), 443, 30 * M, 'batch');
    F(vm(r), vm('harbor-01'), 443, 90 * M, 'batch');
  }
  F(vm('jenkins-01'), vm('nexus-01'), 8081, 40 * M, 'batch', { app: 'http-alt' });
  for (const d of names('dev-').slice(0, 8)) F(vm(d), vm('gitlab-01'), 22, 4 * M);
  return defs;
}

// ---------------------------------------------------------------------------

function linkId(l) {
  return `${l.a}:${l.aPort || ''}~${l.b}:${l.bPort || ''}`;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }

export default function create(cfg, ctx) {
  return new DemoCollector(cfg, ctx);
}
