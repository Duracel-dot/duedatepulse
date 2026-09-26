// Tests du collecteur Hyper-V (conversion JSON PowerShell -> snapshot, sans PowerShell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import create, { hypervToSnapshot, vmStatus, vmState, HyperVCollector } from '../server/collectors/hyperv.js';
import { windowsToSnapshot } from '../server/collectors/windows.js';
import { MERGE_KEY_KINDS, keyKind } from '../shared/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const fixture = () => load('hyperv-sample.json');
const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
const makeCtx = () => ({ logger: silent, publish() {}, store: { getEntities: () => [] } });
const byId = (snap, id) => snap.entities.find((e) => e.id === id);
const byName = (snap, name) => snap.entities.find((e) => e.name === name && e.type === 'vm');

test('hyperv : trois niveaux serveur physique / hyperviseur / VM', () => {
  const snap = hypervToSnapshot(fixture(), { localName: 'SUPERV01' });
  assert.deepEqual(snap.entities.map((e) => e.id), [
    'hyperv:hv01/hw',
    'hyperv:hv01',
    'hyperv:vm:b3a1c9d2-7e4f-4a6b-8c1d-2e3f4a5b6c7d',
    'hyperv:vm:c4d5e6f7-0a1b-4c2d-9e3f-405162738495',
    'hyperv:vm:d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6',
    'hyperv:vm:e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7@hv01',
    'hyperv:vm:f0e1d2c3-b4a5-4968-8778-695a4b3c2d1e',
    'hyperv:hv02',
    'hyperv:hv03/hw',
    'hyperv:hv03',
  ]);
  assert.deepEqual(snap.links, []);
  assert.deepEqual(snap.flows, []);

  const hw = byId(snap, 'hyperv:hv01/hw');
  assert.equal(hw.type, 'server');
  assert.equal(hw.name, 'HV01');
  assert.equal(hw.status, 'ok');
  assert.deepEqual([...hw.keys].sort(), [
    'fqdn:hv01.corp.local',
    'host:hv01',
    'ip:10.10.1.11',
    'ip:10.10.2.11',
    'mac:00:15:5d:01:0a:00',
    'mac:98:f2:b3:11:22:33',
    'serial:CZJ9120ABC',
    'uuid:37393150-3636-5a43-4a39-313230414243',
  ]);
  assert.equal(hw.attrs.vendor, 'HPE');
  assert.equal(hw.attrs.model, 'ProLiant DL380 Gen10');
  assert.equal(hw.attrs.serial, 'CZJ9120ABC');

  const hv = byId(snap, 'hyperv:hv01');
  assert.equal(hv.type, 'hypervisor');
  assert.equal(hv.parent, 'hyperv:hv01/hw');
  assert.deepEqual(hv.keys, ['host:hv01', 'fqdn:hv01.corp.local']);
  assert.equal(hv.status, 'ok');
  assert.equal(hv.attrs.hypervisor, 'Hyper-V');
  assert.equal(hv.attrs.version, '10.0.17763');
  assert.equal(hv.attrs.cluster, 'CL-HV01');
  assert.equal(hv.attrs.cpuCores, 64);
  assert.equal(hv.attrs.memGB, 512);
  assert.deepEqual(hv.attrs.vSwitches, [
    { name: 'vSwitch-LAN', type: 'External', uplink: 'HPE Ethernet 10/25Gb 2-port 640FLR-SFP28 Adapter' },
    { name: 'Interne', type: 'Internal' },
  ]);
  assert.equal(hv.attrs.vmCount, 5);
  assert.equal(hv.attrs.vmRunning, 2);
  assert.deepEqual(hv.metrics, { cpu: 23.5, mem: 75, uptimeS: 2000000 });
});

test('hyperv : VM en marche (cles uuid VMId + GUID BIOS, KVP, VLAN)', () => {
  const snap = hypervToSnapshot(fixture(), { localName: 'SUPERV01' });
  const vm = byName(snap, 'SRV-WEB01');
  assert.equal(vm.parent, 'hyperv:hv01');
  assert.equal(vm.status, 'ok', 'Status localise "Fonctionne normalement" ne doit pas declencher d\'alerte');
  assert.deepEqual([...vm.keys].sort(), [
    'fqdn:srv-web01.corp.local',
    'host:srv-web01',
    'ip:10.10.30.21',
    'mac:00:15:5d:0a:1b:01',
    'serial:5175-2891-3316-8812-9460-3517-24',
    'uuid:b3a1c9d2-7e4f-4a6b-8c1d-2e3f4a5b6c7d',
    'uuid:d5b6f8e2-1c3a-4e5b-9a7d-2f4e6c8a0b1d',
  ]);
  assert.equal(vm.attrs.powerState, 'Running');
  assert.equal(vm.attrs.cpuCores, 4);
  assert.equal(vm.attrs.memGB, 8);
  assert.equal(vm.attrs.memDemandGB, 6);
  assert.equal(vm.attrs.generation, 2);
  assert.deepEqual(vm.attrs.ip, ['10.10.30.21']);
  assert.deepEqual(vm.attrs.mac, ['00:15:5d:0a:1b:01']);
  assert.deepEqual(vm.attrs.networks, ['vSwitch-LAN']);
  assert.equal(vm.attrs.vlan, 30);
  assert.equal(vm.attrs.replication, undefined);
  assert.equal(vm.attrs.uptimeS, 518400);
  assert.equal(vm.attrs.os, 'Windows Server 2022 Datacenter');
  assert.equal(vm.attrs.integrationServices, 'À jour');
  assert.deepEqual(vm.metrics, { cpu: 7, mem: 75, uptimeS: 518400 });
});

test('hyperv : la VM correle avec le collecteur windows (cles de fusion communes)', () => {
  const hv = byName(hypervToSnapshot(fixture(), { localName: 'SUPERV01' }), 'SRV-WEB01');
  const win = windowsToSnapshot(load('windows-sample.json'), { localName: 'SUPERV01' })
    .entities.find((e) => e.id === 'windows:srv-web01');
  assert.equal(win.type, 'vm');
  const common = hv.keys.filter((k) => win.keys.includes(k) && MERGE_KEY_KINDS.has(keyKind(k)));
  assert.ok(common.includes('uuid:d5b6f8e2-1c3a-4e5b-9a7d-2f4e6c8a0b1d'));
  assert.ok(common.includes('serial:5175-2891-3316-8812-9460-3517-24'));
  assert.ok(common.includes('mac:00:15:5d:0a:1b:01'));
});

test('hyperv : VM arretee, replication en alerte, copie Replica, pause', () => {
  const snap = hypervToSnapshot(fixture(), { localName: 'SUPERV01' });

  const off = byName(snap, 'SRV-APP02');
  assert.equal(off.status, 'off');
  assert.equal(off.statusText, 'Arretee');
  assert.deepEqual(off.metrics, {});
  assert.equal(off.attrs.memGB, 4);
  assert.deepEqual(off.attrs.mac, ['00:15:5d:0a:1b:02'], 'carte unique deballee (PS 5.1)');

  const file = byName(snap, 'SRV-FILE03');
  assert.equal(file.status, 'warning');
  assert.match(file.statusText, /Replication : Replicating \(Warning\)/);
  assert.equal(file.metrics.mem, 100, 'demande > memoire affectee : plafonne a 100 %');
  assert.deepEqual(file.attrs.ip, ['10.10.30.40', '10.10.50.40']);
  assert.equal(file.attrs.vlan, 30);
  assert.deepEqual(file.attrs.vlans, [30, 50]);
  assert.equal(file.attrs.replication, 'Replicating');
  assert.equal(file.attrs.replicationHealth, 'Warning');

  const replica = byName(snap, 'SRV-DR04');
  assert.equal(replica.id, 'hyperv:vm:e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7@hv01');
  assert.deepEqual(replica.keys, [], 'une copie Replica ne doit pas fusionner avec la VM primaire');
  assert.equal(replica.status, 'off');
  assert.equal(replica.attrs.replicationMode, 'Replica');

  const paused = byName(snap, 'SRV-TEST05');
  assert.equal(paused.status, 'warning');
  assert.equal(paused.statusText, 'En pause');
});

test('hyperv : hote injoignable -> hyperviseur critique sans VM ; module Hyper-V absent -> warning', () => {
  const snap = hypervToSnapshot(fixture(), { localName: 'SUPERV01' });
  const down = byId(snap, 'hyperv:hv02');
  assert.equal(down.type, 'hypervisor');
  assert.equal(down.status, 'critical');
  assert.equal(down.statusText, 'Injoignable : Accès refusé.');
  assert.deepEqual(down.keys, ['host:hv02']);
  assert.equal(down.parent, undefined);
  assert.equal(snap.entities.filter((e) => e.parent === 'hyperv:hv02').length, 0);

  const hw3 = byId(snap, 'hyperv:hv03/hw');
  assert.ok(hw3.keys.includes('mac:b0:26:28:aa:bb:cc'), 'carte unique deballee (PS 5.1)');
  const hv3 = byId(snap, 'hyperv:hv03');
  assert.equal(hv3.status, 'warning');
  assert.match(hv3.statusText, /^Collecte Hyper-V impossible : Module PowerShell Hyper-V indisponible/);
  assert.equal(hv3.attrs.vmCount, 0);
  assert.equal(hv3.attrs.cpuCores, 48);
});

test('hyperv : hote devenu injoignable -> serveur physique conserve (statut inconnu)', () => {
  const known = new Map();
  hypervToSnapshot(fixture(), { known, localName: 'SUPERV01' });
  const snap = hypervToSnapshot({ targets: [{ name: 'HV01', ok: false, error: 'delai depasse' }] },
    { known, localName: 'SUPERV01' });
  assert.equal(snap.entities.length, 2);
  const [hw, hv] = snap.entities;
  assert.equal(hw.id, 'hyperv:hv01/hw');
  assert.equal(hw.status, 'unknown');
  assert.ok(hw.keys.includes('serial:CZJ9120ABC'));
  assert.equal(hv.id, 'hyperv:hv01');
  assert.equal(hv.parent, 'hyperv:hv01/hw');
  assert.equal(hv.status, 'critical');
  assert.deepEqual(hv.keys, ['host:hv01', 'fqdn:hv01.corp.local']);
});

test('hyperv : statut des VM', () => {
  assert.equal(vmState(2), 'Running');
  assert.equal(vmState('3'), 'Off');
  assert.equal(vmState(null), 'Unknown');
  assert.equal(vmStatus({ State: 'RunningCritical' }).status, 'critical');
  assert.equal(vmStatus({ State: 3 }).status, 'off');
  assert.equal(vmStatus({ State: 'Saved' }).status, 'off');
  assert.equal(vmStatus({ State: 'Running', OperationalStatus: ['Degraded'], Status: 'Degrade' }).status, 'warning');
  assert.deepEqual(vmStatus({ State: 'Running', Status: 'Operating normally' }), { status: 'ok' });
  assert.equal(vmStatus({ State: 'Running', Status: 'Lost communication' }).status, 'warning');
  assert.equal(vmStatus({ State: 'Running', OperationalStatus: 'Ok', ReplicationHealth: 'Critical' }).status, 'warning');
  assert.equal(vmStatus({ State: 'Running', OperationalStatus: 'Ok', ReplicationState: 'Error' }).status, 'warning');
  assert.deepEqual(vmStatus({ State: 'Starting', OperationalStatus: ['Ok'] }), { status: 'ok', statusText: 'Etat : Starting' });
});

test('hyperv : collecteur (PowerShell simule)', async () => {
  const col = create({ type: 'hyperv', name: 'hv', hosts: ['HV01', 'hv02', 'hv03.corp.local'], vlan: false }, makeCtx());
  assert.ok(col instanceof HyperVCollector);
  assert.equal(col.intervalMs, 60000);
  const seen = [];
  col.probe = async () => ({ ok: true });
  col.runner = async (script, params) => {
    assert.equal(script, 'hyperv.ps1');
    assert.equal(params.vlan, false);
    assert.equal(params.kvp, true);
    seen.push(...params.targets);
    return { targets: fixture().targets.filter((t) => params.targets.includes(t.name)) };
  };
  const snap = await col.poll();
  assert.deepEqual(seen.sort(), ['HV01', 'hv02', 'hv03.corp.local']);
  assert.equal(snap.entities.length, 10);
  assert.equal(col.known.size, 2);

  col.runner = async () => { throw new Error('PowerShell introuvable'); };
  await assert.rejects(() => col.poll(), /PowerShell introuvable/);
});
