import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import createProxmox, { parseNetConfig, parseSmbiosUuid, parseGuestInterfaces, guestRates } from '../server/collectors/proxmox.js';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
const GiB = 1024 ** 3;
const TOKEN = 'PVEAPIToken=monitor@pve!sng=11111111-2222-3333-4444-555555555555';
const TICKET = 'PVE:monitor@pve:66F0A1B2::c2lnbmF0dXJl+/=';

function fixtures() {
  return {
    '/cluster/status': [
      { type: 'cluster', id: 'cluster', name: 'pve-prod', nodes: 2, quorate: 1 },
      { type: 'node', id: 'node/pve1', name: 'pve1', ip: '10.0.0.21', online: 1, local: 1 },
      { type: 'node', id: 'node/pve2', name: 'pve2', ip: '10.0.0.22', online: 0 },
    ],
    '/cluster/resources': [
      { id: 'node/pve1', type: 'node', node: 'pve1', status: 'online', cpu: 0.25, maxcpu: 32, mem: 64 * GiB, maxmem: 256 * GiB, disk: 10 * GiB, maxdisk: 100 * GiB, uptime: 100000 },
      { id: 'node/pve2', type: 'node', node: 'pve2', status: 'offline', maxcpu: 16, maxmem: 128 * GiB },
      { id: 'qemu/100', type: 'qemu', vmid: 100, name: 'web01', node: 'pve1', status: 'running', cpu: 0.5, maxcpu: 4, mem: 2 * GiB, maxmem: 8 * GiB, disk: 0, maxdisk: 32 * GiB, uptime: 3600, template: 0, netin: 1_000_000, netout: 2_000_000 },
      { id: 'qemu/101', type: 'qemu', vmid: 101, name: 'tpl-debian', node: 'pve1', status: 'stopped', template: 1 },
      { id: 'qemu/102', type: 'qemu', vmid: 102, name: 'db01', node: 'pve1', status: 'stopped', maxcpu: 2, maxmem: 4 * GiB, template: 0 },
      { id: 'lxc/200', type: 'lxc', vmid: 200, name: 'dns01', node: 'pve1', status: 'running', cpu: 0.02, maxcpu: 1, mem: 128 * 1024 ** 2, maxmem: 512 * 1024 ** 2, disk: 2 * GiB, maxdisk: 8 * GiB, uptime: 7200, netin: 500, netout: 800 },
      { id: 'storage/pve1/local', type: 'storage', storage: 'local', node: 'pve1', disk: 50 * GiB, maxdisk: 100 * GiB, shared: 0, status: 'available' },
      { id: 'storage/pve1/local-lvm', type: 'storage', storage: 'local-lvm', node: 'pve1', disk: 95 * GiB, maxdisk: 100 * GiB, shared: 0, status: 'available' },
      { id: 'storage/pve2/local', type: 'storage', storage: 'local', node: 'pve2', status: 'unknown' },
    ],
    '/nodes/pve1/qemu/100/config': {
      name: 'web01', agent: '1', ostype: 'l26',
      net0: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20,firewall=1',
      net1: 'e1000=BC:24:11:AA:BB:DD,bridge=vmbr1',
      smbios1: 'uuid=6B6F7A4E-1C3A-4F0E-9D5B-0A1B2C3D4E5F,manufacturer=UVZF',
    },
    '/nodes/pve1/qemu/102/config': { name: 'db01', agent: '0', net0: 'virtio=BC:24:11:00:00:02,bridge=vmbr0' },
    '/nodes/pve1/lxc/200/config': { hostname: 'dns01', ostype: 'debian', net0: 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:11:22:33,ip=10.0.20.53/24,tag=20,type=veth' },
    '/nodes/pve1/qemu/100/agent/network-get-interfaces': {
      result: [
        { name: 'lo', 'hardware-address': '00:00:00:00:00:00', 'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4', prefix: 8 }] },
        { name: 'eth0', 'hardware-address': 'bc:24:11:aa:bb:cc', 'ip-addresses': [{ 'ip-address': '10.0.20.10', 'ip-address-type': 'ipv4', prefix: 24 }, { 'ip-address': 'fe80::be24:11ff:feaa:bbcc', 'ip-address-type': 'ipv6', prefix: 64 }] },
      ],
    },
    '/nodes/pve1/lxc/200/interfaces': [
      { name: 'lo', hwaddr: '00:00:00:00:00:00', inet: '127.0.0.1/8' },
      { name: 'eth0', hwaddr: 'bc:24:11:11:22:33', inet: '10.0.20.53/24' },
    ],
  };
}

function startMock({ ticketAuth = false } = {}) {
  const state = { hits: [], logins: 0, tickets: new Set(), data: fixtures() };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/^\/api2\/json/, '');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && p === '/access/ticket') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        if (f.get('username') !== 'monitor@pve' || f.get('password') !== 'pw') return send(401, { data: null });
        state.logins++;
        const t = `${TICKET}${state.logins}`;
        state.tickets.add(t);
        send(200, { data: { ticket: t, CSRFPreventionToken: 'csrf', username: 'monitor@pve' } });
      });
      return undefined;
    }
    state.hits.push(p);
    const cookie = /PVEAuthCookie=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const ok = ticketAuth ? state.tickets.has(cookie) : req.headers.authorization === TOKEN;
    if (!ok) return send(401, { data: null });
    if (p in state.data) return send(200, { data: state.data[p] });
    if (p.includes('/agent/')) return send(500, { data: null, message: 'QEMU guest agent is not running' });
    return send(404, { data: null });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const byId = (snap, id) => snap.entities.find((e) => e.id === id);

test('Proxmox (jeton d\'API) : noeuds, hyperviseurs, VM et conteneurs', async () => {
  const { server, state, url } = await startMock();
  try {
    const col = createProxmox({
      type: 'proxmox', name: 'pve', url: `${url}/`, tokenId: 'monitor@pve!sng', tokenSecret: '11111111-2222-3333-4444-555555555555', guestAgent: true,
    }, { logger: silent, publish() {} });
    const snap = await col.poll();
    assert.deepEqual(snap.links, []);
    assert.deepEqual(snap.flows, []);

    const hw = byId(snap, 'proxmox:pve:pve1/hw');
    assert.equal(hw.type, 'server');
    assert.deepEqual(hw.keys.sort(), ['host:pve1', 'ip:10.0.0.21']);
    assert.equal(hw.status, 'ok');

    const hv = byId(snap, 'proxmox:pve:pve1');
    assert.equal(hv.type, 'hypervisor');
    assert.equal(hv.parent, 'proxmox:pve:pve1/hw');
    assert.equal(hv.attrs.hypervisor, 'Proxmox VE');
    assert.equal(hv.attrs.cluster, 'pve-prod');
    assert.equal(hv.attrs.cpuCores, 32);
    assert.equal(hv.attrs.memGB, 256);
    assert.deepEqual(hv.attrs.storages, [{ name: 'local', usedPct: 50, shared: false }, { name: 'local-lvm', usedPct: 95, shared: false }]);
    assert.deepEqual(hv.metrics, { cpu: 25, mem: 25, disk: 10, uptimeS: 100000 });
    assert.equal(hv.status, 'warning'); // local-lvm > 90 %
    assert.match(hv.statusText, /local-lvm \(95 %\)/);

    const hv2 = byId(snap, 'proxmox:pve:pve2');
    assert.equal(hv2.status, 'critical');
    assert.deepEqual(hv2.metrics, {});
    assert.deepEqual(hv2.attrs.storages, []);
    assert.equal(byId(snap, 'proxmox:pve:pve2/hw').status, 'unknown');

    const vm = byId(snap, 'proxmox:pve:qemu/100');
    assert.equal(vm.type, 'vm');
    assert.equal(vm.name, 'web01');
    assert.equal(vm.parent, 'proxmox:pve:pve1');
    assert.equal(vm.status, 'ok');
    assert.deepEqual(vm.keys.sort(), [
      'host:web01', 'ip:10.0.20.10', 'mac:bc:24:11:aa:bb:cc', 'mac:bc:24:11:aa:bb:dd', 'uuid:6b6f7a4e-1c3a-4f0e-9d5b-0a1b2c3d4e5f',
    ]);
    assert.equal(vm.attrs.vmid, 100);
    assert.equal(vm.attrs.powerState, 'running');
    assert.equal(vm.attrs.cpuCores, 4);
    assert.equal(vm.attrs.memGB, 8);
    assert.equal(vm.attrs.vlan, 20);
    assert.deepEqual(vm.attrs.networks, [
      { name: 'net0', mac: 'bc:24:11:aa:bb:cc', bridge: 'vmbr0', vlan: 20, model: 'virtio' },
      { name: 'net1', mac: 'bc:24:11:aa:bb:dd', bridge: 'vmbr1', vlan: null, model: 'e1000' },
    ]);
    assert.deepEqual(vm.attrs.ip, ['10.0.20.10']);
    assert.deepEqual(vm.metrics, { cpu: 50, mem: 25, uptimeS: 3600 });

    // modele ignore, VM arretee publiee sans metriques
    assert.equal(byId(snap, 'proxmox:pve:qemu/101'), undefined);
    const off = byId(snap, 'proxmox:pve:qemu/102');
    assert.equal(off.status, 'off');
    assert.deepEqual(off.metrics, {});
    assert.deepEqual(off.attrs.mac, ['bc:24:11:00:00:02']);

    const ct = byId(snap, 'proxmox:pve:lxc/200');
    assert.equal(ct.type, 'container');
    assert.equal(ct.parent, 'proxmox:pve:pve1');
    assert.deepEqual(ct.keys.sort(), ['host:dns01', 'ip:10.0.20.53', 'mac:bc:24:11:11:22:33']);
    assert.equal(ct.attrs.vlan, 20);
    assert.equal(ct.metrics.disk, 25);
    assert.equal(ct.metrics.cpu, 2);

    // agent qemu interroge seulement pour les VM en marche avec agent declare
    assert.ok(state.hits.includes('/nodes/pve1/qemu/100/agent/network-get-interfaces'));
    assert.ok(!state.hits.some((h) => h.includes('/qemu/102/agent')));
    assert.ok(!state.hits.some((h) => h.includes('/qemu/101/')));

    // 2e releve : configuration en cache, debits reseau calcules
    state.data['/cluster/resources'][2].netin += 10_000_000;
    const before = state.hits.length;
    await new Promise((r) => setTimeout(r, 20));
    const snap2 = await col.poll();
    assert.ok(!state.hits.slice(before).some((h) => h.endsWith('/config')));
    const vm2 = byId(snap2, 'proxmox:pve:qemu/100');
    assert.ok(vm2.metrics.rxBps > 0);
    assert.equal(vm2.metrics.txBps, 0);
  } finally {
    server.close();
  }
});

test('Proxmox (identifiant / mot de passe) : ticket et renouvellement', async () => {
  const { server, state, url } = await startMock({ ticketAuth: true });
  try {
    const col = createProxmox({ type: 'proxmox', name: 'pve', url, username: 'monitor@pve', password: 'pw', vmConfig: false }, { logger: silent, publish() {} });
    const snap = await col.poll();
    assert.equal(state.logins, 1);
    assert.ok(byId(snap, 'proxmox:pve:qemu/100'));
    // pas de configuration lue : pas de cle mac/uuid
    assert.deepEqual(byId(snap, 'proxmox:pve:qemu/100').keys, ['host:web01']);
    // ticket invalide cote serveur : nouvelle authentification
    state.tickets.clear();
    await col.poll();
    assert.equal(state.logins, 2);

    const bad = createProxmox({ type: 'proxmox', url, username: 'monitor@pve', password: 'nope' }, { logger: silent, publish() {} });
    await assert.rejects(bad.poll(), /HTTP 401/);
    const none = createProxmox({ type: 'proxmox', url }, { logger: silent, publish() {} });
    await assert.rejects(none.poll(), /tokenId/);
  } finally {
    server.close();
  }
});

test('parseNetConfig / parseSmbiosUuid / parseGuestInterfaces / guestRates', () => {
  assert.deepEqual(parseNetConfig('virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20,firewall=1'),
    { mac: 'bc:24:11:aa:bb:cc', model: 'virtio', bridge: 'vmbr0', vlan: 20, ip: null, ip6: null, ifname: null });
  assert.deepEqual(parseNetConfig('name=eth0,bridge=vmbr0,hwaddr=BC:24:11:11:22:33,ip=dhcp,ip6=fd00::5/64,type=veth'),
    { mac: 'bc:24:11:11:22:33', model: null, bridge: 'vmbr0', vlan: null, ip: null, ip6: 'fd00::5', ifname: 'eth0' });
  assert.equal(parseNetConfig('virtio,bridge=vmbr0').model, 'virtio');
  assert.equal(parseNetConfig('').mac, null);
  assert.equal(parseSmbiosUuid('uuid=6B6F7A4E-1C3A-4F0E-9D5B-0A1B2C3D4E5F'), '6b6f7a4e-1c3a-4f0e-9d5b-0a1b2c3d4e5f');
  assert.equal(parseSmbiosUuid('base64=1,manufacturer=QUJD'), null);
  assert.deepEqual(parseGuestInterfaces([{ name: 'eth0', hwaddr: 'aa:bb:cc:00:11:22', inet: '10.0.0.5/24', inet6: 'fe80::1/64' }]),
    [{ name: 'eth0', mac: 'aa:bb:cc:00:11:22', ips: ['10.0.0.5'] }]);
  const r = guestRates({ 'qemu/1': { netin: 1000, netout: 5000, uptime: 10 }, 'qemu/2': { netin: 1, netout: 1, uptime: 100 } },
    { 'qemu/1': { netin: 8500, netout: 5000, uptime: 40 }, 'qemu/2': { netin: 0, netout: 0, uptime: 5 }, 'qemu/3': { netin: 1, netout: 1, uptime: 1 } }, 30);
  assert.deepEqual(r, { 'qemu/1': { rxBps: 2000, txBps: 0 } });
});
