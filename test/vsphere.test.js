import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import createVsphere, { buildVsphereSnapshot, hostStatus, serviceTag } from '../server/collectors/vsphere.js';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
const BASIC = `Basic ${Buffer.from('admin@vsphere.local:secret').toString('base64')}`;
const GiB = 1024 ** 3;

// --- donnees simulees -------------------------------------------------------------

const CLUSTERS = [{ cluster: 'domain-c1', name: 'Prod', drs_enabled: true, ha_enabled: true }];
const HOSTS = [
  { host: 'host-10', name: 'esx01.corp.local', connection_state: 'CONNECTED', power_state: 'POWERED_ON' },
  { host: 'host-11', name: '10.0.0.12', connection_state: 'NOT_RESPONDING' },
  { host: 'host-12', name: 'esx03.corp.local', connection_state: 'CONNECTED', power_state: 'POWERED_ON' },
];
const VMS = {
  'host-10': [
    { vm: 'vm-100', name: 'WEB01', power_state: 'POWERED_ON', cpu_count: 4, memory_size_MiB: 8192 },
    { vm: 'vm-101', name: 'old-app', power_state: 'POWERED_OFF', cpu_count: 2, memory_size_MiB: 2048 },
  ],
  'host-11': [{ vm: 'vm-110', name: 'batch', power_state: 'SUSPENDED', cpu_count: 1, memory_size_MiB: 1024 }],
  'host-12': [],
};
const HOST_SUMMARY = {
  'host-10': {
    _typeName: 'HostListSummary',
    hardware: {
      vendor: 'Dell Inc.', model: 'PowerEdge R750', uuid: '4C4C4544-0042-3510-8052-B4C04F4E4E32',
      cpuModel: 'Intel(R) Xeon(R) Gold 6338', cpuMhz: 2000, numCpuPkgs: 2, numCpuCores: 32, memorySize: 512 * GiB,
      otherIdentifyingInfo: [
        { identifierValue: ' ', identifierType: { key: 'AssetTag' } },
        { identifierValue: 'ABC1234', identifierType: { key: 'ServiceTag' } },
      ],
    },
    runtime: { inMaintenanceMode: false },
    config: { product: { fullName: 'VMware ESXi 8.0.1 build-21495797' } },
    quickStats: { overallCpuUsage: 16000, overallMemoryUsage: 131072, uptime: 86400 },
    overallStatus: 'green',
  },
  'host-12': {
    hardware: { vendor: 'HPE', model: 'ProLiant DL380 Gen10', cpuMhz: 2400, numCpuCores: 16, memorySize: 256 * GiB, otherIdentifyingInfo: [{ identifierValue: 'CZJ0001', identifierType: { key: 'SerialNumberTag' } }] },
    runtime: { inMaintenanceMode: true },
    quickStats: { overallCpuUsage: 100, overallMemoryUsage: 1024, uptime: 100 },
    overallStatus: 'yellow',
  },
};
const VM_SUMMARY = {
  'vm-100': {
    config: { uuid: '4230AAAA-BBBB-CCCC-DDDD-EEEEFFFF0001', instanceUuid: '5030aaaa-0000-0000-0000-000000000001', memorySizeMB: 8192, guestFullName: 'Microsoft Windows Server 2022 (64-bit)', template: false },
    quickStats: { overallCpuUsage: 2000, guestMemoryUsage: 2048, uptimeSeconds: 3600 },
    runtime: { maxCpuUsage: 8000 },
    guest: { ipAddress: '10.1.0.10', hostName: 'web01.corp.local' },
    overallStatus: 'red',
  },
  'vm-101': { config: { uuid: '4230aaaa-bbbb-cccc-dddd-eeeeffff0002', memorySizeMB: 2048 }, quickStats: {}, runtime: {}, guest: {} },
  'vm-110': { config: { uuid: '4230aaaa-bbbb-cccc-dddd-eeeeffff0003', template: true } },
};
const IDENTITY = {
  'vm-100': { full_name: { default_message: 'Microsoft Windows Server 2022 (64-bit)' }, name: 'WINDOWS_SERVER_2021', ip_address: '10.1.0.10', family: 'WINDOWS', host_name: 'web01.corp.local' },
};
const DETAILS = {
  'vm-100': {
    identity: { bios_uuid: '4230aaaa-bbbb-cccc-dddd-eeeeffff0001', instance_uuid: '5030aaaa-0000-0000-0000-000000000001' },
    nics: { 4000: { mac_address: '00:50:56:AA:00:01', backing: { network_name: 'VLAN20-Prod' } } },
    guest_OS: 'WINDOWS_SERVER_2021',
  },
  'vm-101': { identity: { bios_uuid: '4230aaaa-bbbb-cccc-dddd-eeeeffff0002' }, nics: { 4000: { mac_address: '00:50:56:aa:00:02', backing: { network_name: 'VM Network' } } } },
};

// --- serveur vCenter simule ------------------------------------------------------------

function startMock({ legacy = false, viJson = true } = {}) {
  const state = { tokens: new Set(), logins: 0, hits: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    state.hits.push(`${req.method} ${p}${u.search}`);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const wrap = (v) => (legacy ? { value: v } : v);
    const login = (fmt) => {
      if (req.headers.authorization !== BASIC) return send(401, { error_type: 'UNAUTHENTICATED' });
      const tok = `tok-${++state.logins}`;
      state.tokens.add(tok);
      return send(200, fmt(tok));
    };
    if (req.method === 'POST' && p === '/api/session') return legacy ? send(404, {}) : login((t) => t);
    if (req.method === 'POST' && p === '/rest/com/vmware/cis/session') return legacy ? login((t) => ({ value: t })) : send(404, {});
    if (!state.tokens.has(req.headers['vmware-api-session-id'])) return send(401, { error_type: 'UNAUTHENTICATED' });
    if (req.method === 'DELETE') { state.tokens.delete(req.headers['vmware-api-session-id']); return send(204); }

    const root = legacy ? '/rest/vcenter' : '/api/vcenter';
    const f = (k) => u.searchParams.get(legacy ? `filter.${k}` : k);
    if (p.startsWith('/sdk/vim25/8.0.1.0/')) {
      if (!viJson) return send(404, {});
      const [, type, moid, prop] = p.slice('/sdk/vim25/8.0.1.0'.length).split('/');
      const src = type === 'HostSystem' ? HOST_SUMMARY : VM_SUMMARY;
      return prop === 'summary' && src[moid] ? send(200, src[moid]) : send(404, {});
    }
    if (p === `${root}/cluster`) return send(200, wrap(CLUSTERS));
    if (p === `${root}/host`) {
      const cl = f('clusters');
      return send(200, wrap(cl ? (cl === 'domain-c1' ? [HOSTS[0], HOSTS[2]] : []) : HOSTS));
    }
    if (p === `${root}/vm`) return send(200, wrap(VMS[f('hosts')] || []));
    let m = p.match(new RegExp(`^${root}/vm/([^/]+)/guest/identity$`));
    if (m) return IDENTITY[m[1]] ? send(200, wrap(IDENTITY[m[1]])) : send(503, { error_type: 'SERVICE_UNAVAILABLE' });
    m = p.match(new RegExp(`^${root}/vm/([^/]+)$`));
    if (m && DETAILS[m[1]]) {
      const d = DETAILS[m[1]];
      // ancienne API : les tables associatives sont des listes {key, value}
      return send(200, wrap(legacy ? { ...d, nics: Object.entries(d.nics).map(([key, value]) => ({ key, value })) } : d));
    }
    return send(404, {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function collector(url, extra = {}) {
  return createVsphere({ type: 'vsphere', name: 'vc1', url, username: 'admin@vsphere.local', password: 'secret', ...extra }, { logger: silent, publish() {} });
}

const byId = (snap, id) => snap.entities.find((e) => e.id === id);

// --- tests --------------------------------------------------------------------------------

test('vSphere (API /api + VI/JSON) : serveurs, hyperviseurs et VM', async () => {
  const { server, state, url } = await startMock();
  try {
    const col = collector(url);
    const snap = await col.poll();
    assert.deepEqual(snap.links, []);
    assert.deepEqual(snap.flows, []);

    const hw = byId(snap, 'vsphere:vc1:host-10/hw');
    assert.equal(hw.type, 'server');
    assert.equal(hw.name, 'esx01.corp.local');
    assert.deepEqual(hw.keys.sort(), ['fqdn:esx01.corp.local', 'host:esx01', 'serial:ABC1234', 'uuid:4c4c4544-0042-3510-8052-b4c04f4e4e32']);
    assert.equal(hw.attrs.vendor, 'Dell Inc.');
    assert.equal(hw.attrs.model, 'PowerEdge R750');
    assert.equal(hw.attrs.serial, 'ABC1234');

    const hv = byId(snap, 'vsphere:vc1:host-10');
    assert.equal(hv.type, 'hypervisor');
    assert.equal(hv.parent, 'vsphere:vc1:host-10/hw');
    assert.equal(hv.status, 'ok');
    assert.equal(hv.attrs.hypervisor, 'VMware ESXi');
    assert.equal(hv.attrs.cluster, 'Prod');
    assert.equal(hv.attrs.connectionState, 'CONNECTED');
    assert.equal(hv.attrs.cpuCores, 32);
    assert.equal(hv.attrs.memGB, 512);
    assert.equal(hv.metrics.cpu, 25);   // 16000 / (2000 * 32)
    assert.equal(hv.metrics.mem, 25);   // 128 Gio / 512 Gio
    assert.equal(hv.metrics.uptimeS, 86400);

    // hote enregistre par IP, ne repond pas
    const hw11 = byId(snap, 'vsphere:vc1:host-11/hw');
    assert.deepEqual(hw11.keys, ['ip:10.0.0.12']);
    const hv11 = byId(snap, 'vsphere:vc1:host-11');
    assert.equal(hv11.status, 'critical');
    assert.equal(hv11.attrs.cluster, null);
    // maintenance
    const hv12 = byId(snap, 'vsphere:vc1:host-12');
    assert.equal(hv12.status, 'warning');
    assert.match(hv12.statusText, /maintenance/i);
    assert.equal(byId(snap, 'vsphere:vc1:host-12/hw').attrs.serial, 'CZJ0001');

    const vm = byId(snap, 'vsphere:vc1:vm-100');
    assert.equal(vm.type, 'vm');
    assert.equal(vm.name, 'WEB01');
    assert.equal(vm.parent, 'vsphere:vc1:host-10');
    assert.deepEqual(vm.keys.sort(), ['fqdn:web01.corp.local', 'host:web01', 'ip:10.1.0.10', 'mac:00:50:56:aa:00:01', 'uuid:4230aaaa-bbbb-cccc-dddd-eeeeffff0001']);
    assert.equal(vm.attrs.powerState, 'POWERED_ON');
    assert.equal(vm.attrs.cpuCores, 4);
    assert.equal(vm.attrs.memGB, 8);
    assert.equal(vm.attrs.guestOS, 'Microsoft Windows Server 2022 (64-bit)');
    assert.deepEqual(vm.attrs.ip, ['10.1.0.10']);
    assert.deepEqual(vm.attrs.networks, [{ mac: '00:50:56:aa:00:01', network: 'VLAN20-Prod' }]);
    assert.equal(vm.attrs.cluster, 'Prod');
    assert.equal(vm.metrics.cpu, 25);   // 2000 / 8000
    assert.equal(vm.metrics.mem, 25);   // 2048 / 8192
    assert.equal(vm.metrics.uptimeS, 3600);
    assert.equal(vm.status, 'critical'); // alarme vCenter rouge
    assert.match(vm.statusText, /Alarme/);

    const off = byId(snap, 'vsphere:vc1:vm-101');
    assert.equal(off.status, 'off');
    assert.deepEqual(off.metrics, {});
    assert.ok(off.keys.includes('uuid:4230aaaa-bbbb-cccc-dddd-eeeeffff0002'));
    // modele (template) ignore
    assert.equal(byId(snap, 'vsphere:vc1:vm-110'), undefined);
    // identite invite demandee seulement pour les VM allumees
    assert.ok(!state.hits.some((h) => h.includes('vm-101/guest')));
    assert.equal(col.status().viJson, 'ok');
    assert.equal(col.status().api, 'api');

    // 2e releve : session reutilisee, details VM en cache
    const hits = state.hits.length;
    await col.poll();
    assert.equal(state.logins, 1);
    assert.ok(!state.hits.slice(hits).some((h) => /\/vm\/vm-10[01]$/.test(h)));

    // session expiree cote vCenter : reconnexion transparente
    state.tokens.clear();
    const snap3 = await col.poll();
    assert.equal(state.logins, 2);
    assert.equal(byId(snap3, 'vsphere:vc1:host-10').metrics.cpu, 25);
    await col.stop();
  } finally {
    server.close();
  }
});

test('vSphere : repli sur l\'ancienne API /rest et VI/JSON indisponible', async () => {
  const { server, state, url } = await startMock({ legacy: true, viJson: false });
  try {
    const col = collector(url);
    const snap = await col.poll();
    assert.equal(col.status().api, 'rest');
    assert.equal(col.status().viJson, 'disabled');
    assert.ok(state.hits.includes('GET /rest/vcenter/host?filter.clusters=domain-c1'));
    const hv = byId(snap, 'vsphere:vc1:host-10');
    assert.equal(hv.attrs.cluster, 'Prod');
    assert.deepEqual(hv.metrics, {});
    const vm = byId(snap, 'vsphere:vc1:vm-100');
    // uuid BIOS et MAC issus des details de la VM (ancienne API : {key, value})
    assert.ok(vm.keys.includes('uuid:4230aaaa-bbbb-cccc-dddd-eeeeffff0001'));
    assert.ok(vm.keys.includes('mac:00:50:56:aa:00:01'));
    assert.ok(vm.keys.includes('host:web01'));
    // la VM suspendue n'a pas de resume VI/JSON : elle reste publiee
    assert.equal(byId(snap, 'vsphere:vc1:vm-110').status, 'off');
    // VI/JSON sonde une seule fois puis desactive
    const viHits = state.hits.filter((h) => h.includes('/sdk/')).length;
    await col.poll();
    assert.equal(state.hits.filter((h) => h.includes('/sdk/')).length, viHits);
    assert.ok(viHits <= 2); // sonde + eventuelle ouverture de session VI/JSON
  } finally {
    server.close();
  }
});

test('vSphere : identifiants refuses', async () => {
  const { server, url } = await startMock();
  try {
    const col = createVsphere({ type: 'vsphere', url, username: 'x', password: 'y' }, { logger: silent, publish() {} });
    await assert.rejects(col.poll(), /HTTP 401/);
  } finally {
    server.close();
  }
});

test('hostStatus / serviceTag / buildVsphereSnapshot', () => {
  assert.equal(hostStatus('CONNECTED', 'POWERED_ON', false).status, 'ok');
  assert.equal(hostStatus('DISCONNECTED').status, 'critical');
  assert.equal(hostStatus('CONNECTED', 'STANDBY').status, 'off');
  assert.equal(hostStatus('CONNECTED', 'POWERED_ON', true).status, 'warning');
  assert.equal(serviceTag([{ identifierValue: 'X1', identifierType: { key: 'ServiceTag' } }]), 'X1');
  assert.equal(serviceTag(undefined), null);
  const snap = buildVsphereSnapshot('vc', {
    hosts: [{ host: 'host-1', name: 'esx1', connection_state: 'CONNECTED', power_state: 'POWERED_ON' }],
    vms: [{ vm: 'vm-1', name: 'a', power_state: 'POWERED_ON', hostId: 'host-1' }],
  });
  assert.equal(snap.entities.length, 3);
  assert.equal(snap.entities[2].parent, 'vsphere:vc:host-1');
  assert.deepEqual(snap.entities[2].keys, []);
});
