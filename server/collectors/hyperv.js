// Collecteur Hyper-V : scripts/ps/hyperv.ps1 -> trois niveaux (docs/COLLECTEURS.md) :
//   hyperv:<hote>/hw   serveur physique (fusionne avec l'inventaire / le collecteur windows)
//   hyperv:<hote>      hyperviseur (parent = serveur physique)
//   hyperv:vm:<vmid>   VM (parent = hyperviseur), cles uuid (VMId + GUID BIOS), serie BIOS, mac, nom invite
//
// cfg : { type:'hyperv', hosts:['HV01','HV02'], credential?:{username,password}, interval:60,
//         timeout:120, concurrency:4, opTimeoutSec:20, vlan:true, kvp:true, precheck:true,
//         winrmPort:5985, useSsl:false }
import os from 'node:os';
import { Collector } from './base.js';
import { runPowerShellScript, asArray } from '../util/powershell.js';
import { buildKeys, uuidKey, normalizeMac, isIPv4, ipKey } from '../../shared/model.js';
import {
  collectTargets, tcpProbe, normalizeTargets, targetSlug, isLocalTarget, isVirtualMachine, serialForKey,
  uuidForKey, nicAddresses, clean, num, round, toDate, compact, memUsedPct, uptimeSeconds,
} from './windows.js';

const GB = 1024 ** 3;

// Valeurs numeriques de Microsoft.HyperV.PowerShell.VMState (si l'enum n'a pas ete converti en texte)
const NUM_STATES = {
  1: 'Other', 2: 'Running', 3: 'Off', 4: 'Stopping', 6: 'Saved', 9: 'Paused', 10: 'Starting', 11: 'Reset',
  32773: 'Saving', 32776: 'Pausing', 32777: 'Resuming', 32779: 'FastSaved', 32780: 'FastSaving',
};
const OFF_STATES_RX = /^(off|saved|fastsaved|hibernated)$/i;
// VMOperationalStatus anormaux (le texte "Status" est localise : on ne s'y fie qu'a defaut)
const BAD_OP_RX = /degraded|error|fail|lostcommunication|stressed|aborted|predictive|nonrecoverable/i;
const NORMAL_STATUS_RX = /^(operating normally|fonctionne normalement|fonctionnement normal|normal)$/i;
const BAD_REPL_STATE_RX = /^(error|suspended|resynchronizesuspended|updateerror|waitingforstartresynchronize)$/i;

const uniq = (arr) => [...new Set(arr.filter((v) => v != null && v !== ''))];

export function vmState(v) {
  const s = clean(v);
  if (!s) return 'Unknown';
  return /^\d+$/.test(s) ? (NUM_STATES[s] || s) : s;
}

/** Statut d'une VM : off si arretee/enregistree, warning si en pause, degradee ou replication en defaut. */
export function vmStatus(vm) {
  const state = vmState(vm.State);
  if (/critical$/i.test(state)) return { status: 'critical', statusText: `Etat critique : ${state}` };
  if (OFF_STATES_RX.test(state)) return { status: 'off', statusText: /^off$/i.test(state) ? 'Arretee' : `Etat : ${state}` };
  if (/^paused$/i.test(state)) return { status: 'warning', statusText: 'En pause' };

  const problems = [];
  const ops = asArray(vm.OperationalStatus).map((o) => String(o)).filter(Boolean);
  const text = clean(vm.Status);
  const degraded = ops.length ? ops.some((o) => BAD_OP_RX.test(o)) : !!text && !NORMAL_STATUS_RX.test(text);
  if (degraded) problems.push(text || ops.join(', '));
  const health = clean(vm.ReplicationHealth);
  const repl = clean(vm.ReplicationState);
  if (/^(warning|critical)$/i.test(health || '') || BAD_REPL_STATE_RX.test(repl || '')) {
    problems.push(`Replication : ${repl || '?'} (${health || '?'})`);
  }
  if (problems.length) return { status: 'warning', statusText: problems.join(' ; ') };
  if (!/^running$/i.test(state)) return { status: 'ok', statusText: `Etat : ${state}` };
  return { status: 'ok' };
}

function mapVm(vm, hv) {
  const vmid = clean(vm.VMId)?.toLowerCase();
  if (!vmid) return null;
  const state = vmState(vm.State);
  const running = /^running/i.test(state);
  const adapters = asArray(vm.Adapters).filter((a) => a && typeof a === 'object');
  const macs = uniq(adapters.map((a) => normalizeMac(a.MacAddress)));
  const ips = uniq(adapters.flatMap((a) => asArray(a.IPAddresses)).map((s) => String(s).trim())
    .filter((ip) => isIPv4(ip) && ipKey(ip)));
  const networks = uniq(adapters.map((a) => clean(a.SwitchName)));
  const vlans = uniq(adapters.map((a) => num(a.VlanId)).filter((v) => v > 0));
  const guest = vm.Guest && typeof vm.Guest === 'object' ? vm.Guest : {};
  const guestName = clean(guest.FullyQualifiedDomainName)?.toLowerCase() || null;
  const biosGuid = uuidForKey(vm.BiosGuid);
  const biosSerial = clean(vm.BiosSerial);
  // copie Hyper-V Replica : meme VMId que la VM primaire -> pas de cle, id propre a l'hote
  const replicaCopy = /^(replica|testreplica|extendedreplica)$/i.test(clean(vm.ReplicationMode) || '');
  const keys = replicaCopy ? [] : uniq([
    ...buildKeys({
      hostname: guestName, serial: serialForKey(biosSerial, true), uuid: vmid, mac: macs, ip: ips,
    }),
    uuidKey(biosGuid),
  ]);

  const assigned = num(vm.MemoryAssigned);
  const demand = num(vm.MemoryDemand);
  const startup = num(vm.MemoryStartup);
  const memBytes = running && assigned ? assigned : startup;
  const memPct = running && assigned > 0 && demand != null ? Math.min(100, round((demand / assigned) * 100, 1)) : null;
  const uptimeS = running ? num(vm.UptimeS) : null;
  const repl = clean(vm.ReplicationState);
  const { status, statusText } = vmStatus(vm);

  const ent = {
    id: replicaCopy ? `hyperv:vm:${vmid}@${hv.slug}` : `hyperv:vm:${vmid}`,
    type: 'vm',
    name: clean(vm.Name) || vmid,
    parent: hv.id,
    keys,
    status,
    attrs: compact({
      powerState: state,
      cpuCores: num(vm.ProcessorCount),
      memGB: memBytes ? round(memBytes / GB, 2) : null,
      memDemandGB: running && demand != null ? round(demand / GB, 2) : null,
      memStartupGB: startup ? round(startup / GB, 2) : null,
      dynamicMemory: typeof vm.DynamicMemoryEnabled === 'boolean' ? vm.DynamicMemoryEnabled : null,
      generation: num(vm.Generation),
      version: clean(vm.Version),
      ip: ips,
      mac: macs,
      networks,
      vlan: vlans.length ? vlans[0] : null,
      vlans: vlans.length > 1 ? vlans : null,
      replication: repl && !/^disabled$/i.test(repl) ? repl : null,
      replicationHealth: repl && !/^disabled$/i.test(repl) ? clean(vm.ReplicationHealth) : null,
      replicationMode: replicaCopy ? clean(vm.ReplicationMode) : null,
      uptimeS,
      os: clean(guest.OSName),
      osVersion: clean(guest.OSVersion),
      hostname: guestName,
      integrationServices: clean(vm.IntegrationServicesState),
      clustered: typeof vm.IsClustered === 'boolean' ? vm.IsClustered : null,
      uuid: vmid,
      biosGuid,
      serial: biosSerial,
      hypervisor: 'Hyper-V',
      host: hv.name,
    }),
    metrics: running ? compact({ cpu: num(vm.CPUUsage), mem: memPct, uptimeS }) : {},
  };
  if (statusText) ent.statusText = statusText;
  return ent;
}

function mapUnreachableHost(h, ids, opts) {
  const known = opts.known?.get(String(h.name).toLowerCase());
  const local = isLocalTarget(h.name, opts.localName);
  const name = known?.name || (local ? opts.localName : clean(h.name));
  const out = [];
  let parent;
  if (known?.hw) {
    // le serveur physique reste a sa place, statut inconnu
    out.push({ ...known.hw, status: 'unknown', statusText: 'Hote Hyper-V injoignable' });
    parent = ids.hwId;
  }
  const hv = {
    id: ids.hvId,
    type: 'hypervisor',
    name,
    keys: known?.hvKeys || buildKeys({ hostname: name }),
    status: 'critical',
    statusText: `Injoignable : ${h.error || 'erreur inconnue'}`,
    attrs: { hypervisor: 'Hyper-V', target: h.name, error: h.error || null },
  };
  if (parent) hv.parent = parent;
  out.push(hv);
  return out;
}

function mapHost(h, ids, opts) {
  const cs = h.cs || {};
  const osInfo = h.os || {};
  const name = clean(cs.Name) || clean(h.name);
  const dnsName = (clean(cs.DNSHostName) || name).toLowerCase();
  const domain = cs.PartOfDomain === false ? null : clean(cs.Domain)?.toLowerCase() || null;
  const fqdn = domain ? `${dnsName}.${domain}` : clean(h.vmhost?.FullyQualifiedDomainName)?.toLowerCase() || null;
  const vendor = clean(cs.Manufacturer);
  const model = clean(cs.Model);
  const nested = isVirtualMachine(vendor, model);
  const serial = clean(h.bios?.SerialNumber);
  const { macs, ips } = nicAddresses(h.nics);
  const memBytes = num(cs.TotalPhysicalMemory);

  const hw = {
    id: ids.hwId,
    // virtualisation imbriquee : l'hote est lui-meme une VM
    type: nested ? 'vm' : 'server',
    name,
    keys: buildKeys({
      hostname: name, fqdn, serial: serialForKey(serial, nested), uuid: uuidForKey(h.product?.UUID), mac: macs, ip: ips,
    }),
    status: 'ok',
    attrs: compact({
      vendor,
      model,
      serial,
      cpuCores: num(cs.NumberOfLogicalProcessors),
      memGB: memBytes ? round(memBytes / GB, 1) : null,
      ip: ips,
      mac: macs,
      role: 'Hote Hyper-V',
    }),
  };

  const hvRef = { id: ids.hvId, name, slug: ids.slug };
  const vms = asArray(h.vms).filter((v) => v && typeof v === 'object').map((v) => mapVm(v, hvRef)).filter(Boolean);
  const switches = asArray(h.switches).filter((s) => s && typeof s === 'object').map((s) => compact({
    name: clean(s.Name),
    type: clean(s.SwitchType),
    uplink: clean(s.NetAdapterInterfaceDescription),
  }));
  const lastBoot = toDate(osInfo.LastBootUpTime);
  const hostMem = num(h.vmhost?.MemoryCapacity) ?? memBytes;

  const hv = {
    id: ids.hvId,
    type: 'hypervisor',
    name,
    parent: ids.hwId,
    keys: buildKeys({ hostname: name, fqdn }),
    status: h.hvError ? 'warning' : 'ok',
    attrs: compact({
      hypervisor: 'Hyper-V',
      version: clean(osInfo.Version),
      os: clean(osInfo.Caption),
      cluster: clean(h.cluster),
      cpuCores: num(h.vmhost?.LogicalProcessorCount) ?? num(cs.NumberOfLogicalProcessors),
      memGB: hostMem ? round(hostMem / GB, 1) : null,
      vSwitches: switches,
      vmCount: vms.length,
      vmRunning: vms.filter((v) => /^running/i.test(v.attrs.powerState || '')).length,
      ip: ips,
      fqdn,
      lastBoot: lastBoot ? lastBoot.toISOString() : null,
      target: h.name,
      collectErrors: asArray(h.errors).length ? asArray(h.errors) : null,
    }),
    metrics: compact({
      cpu: num(h.cpuLoad),
      mem: memUsedPct(osInfo),
      uptimeS: uptimeSeconds(h.uptimeS, lastBoot),
    }),
  };
  if (h.hvError) hv.statusText = `Collecte Hyper-V impossible : ${h.hvError}`;

  opts.known?.set(String(h.name).toLowerCase(), {
    name,
    hw: { id: hw.id, type: hw.type, name: hw.name, keys: hw.keys, attrs: hw.attrs },
    hvKeys: hv.keys,
  });
  return [hw, hv, ...vms];
}

/**
 * Convertit la sortie JSON de hyperv.ps1 en snapshot.
 * @param {object} data  { targets: [...] }
 * @param {{known?:Map, localName?:string}} options  known : cache des hotes deja vus (mis a jour ici)
 */
export function hypervToSnapshot(data, options = {}) {
  const opts = { known: options.known || null, localName: options.localName || os.hostname() };
  const entities = [];
  const seen = new Set();
  for (const h of asArray(data?.targets)) {
    if (!h || typeof h !== 'object' || !clean(h.name)) continue;
    const slug = targetSlug(h.name, opts.localName);
    if (seen.has(`hyperv:${slug}`)) continue;
    const ids = { slug, hwId: `hyperv:${slug}/hw`, hvId: `hyperv:${slug}` };
    const list = h.ok ? mapHost(h, ids, opts) : mapUnreachableHost(h, ids, opts);
    for (const e of list) {
      // une VM vue deux fois (migration en cours, hote liste deux fois) : id suffixe par l'hote
      if (seen.has(e.id)) e.id = `${e.id}@${slug}`;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      entities.push(e);
    }
  }
  return { entities, links: [], flows: [] };
}

export class HyperVCollector extends Collector {
  constructor(cfg, ctx) {
    super(cfg, ctx);
    this.known = new Map();
    this.runner = runPowerShellScript; // remplacables (tests)
    this.probe = tcpProbe;
  }

  defaultInterval() { return 60; }

  async poll() {
    const hosts = normalizeTargets(this.cfg.hosts ?? this.cfg.targets);
    if (!hosts.length) return { entities: [], links: [], flows: [] };
    const data = await collectTargets(this, 'hyperv.ps1', hosts, compact({
      opTimeoutSec: num(this.cfg.opTimeoutSec),
      vlan: this.cfg.vlan !== false,
      kvp: this.cfg.kvp !== false,
      port: num(this.cfg.winrmPort),
      useSsl: this.cfg.useSsl ? true : null,
    }));
    return hypervToSnapshot(data, { known: this.known });
  }
}

export default function create(cfg, ctx) {
  return new HyperVCollector(cfg, ctx);
}
