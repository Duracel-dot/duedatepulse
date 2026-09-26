// Construction de l'infrastructure de demonstration (deterministe).
// Deux sites : Paris (production) et Lyon (PRA), agences reliees en MPLS.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G = 1e9;
const M = 1e6;

export function buildDemoWorld(seed = 20260926) {
  const rnd = mulberry32(seed);
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  const serial = (prefix) => `${prefix}${hex(7).toUpperCase()}`;
  let macSeq = 1;
  const mac = (oui) => `${oui}:${[(macSeq >> 16) & 255, (macSeq >> 8) & 255, macSeq++ & 255].map((b) => b.toString(16).padStart(2, '0')).join(':')}`;

  const inventory = { sites: [], externals: [], links: [], networks: [] };
  const hosts = [];      // hotes de virtualisation
  const physicals = [];  // serveurs physiques Windows (hors virtualisation)
  const netDevices = []; // equipements reseau, stockage, onduleurs (vus en SNMP)
  const vms = [];
  const racks = new Map();
  const tors = new Map(); // rackId -> [tor1, tor2]
  const links = inventory.links;
  const portSeq = new Map();
  const nextPort = (dev, prefix = 'Eth1/') => {
    const n = (portSeq.get(dev) || 0) + 1;
    portSeq.set(dev, n);
    return `${prefix}${n}`;
  };
  const link = (a, aPort, b, bPort, speed, kind = 'ethernet', label) => {
    links.push({ a, aPort, b, bPort, speed, kind, label });
  };

  // ---------------------------------------------------------------- sites
  const site = (id, name, location) => {
    const s = { id, name, location, rooms: [] };
    inventory.sites.push(s);
    return s;
  };
  const room = (s, id, name) => {
    const r = { id, name, rows: [] };
    s.rooms.push(r);
    return r;
  };
  const row = (r, name, rotation = 0) => {
    const rw = { name, rotation, racks: [] };
    r.rows.push(rw);
    return rw;
  };
  const rack = (rw, id, attrs = {}) => {
    const rk = { id, name: id, units: 42, devices: [], attrs };
    rw.racks.push(rk);
    racks.set(id, rk);
    return rk;
  };
  const device = (rk, dev) => {
    rk.devices.push(dev);
    return dev;
  };

  const par = site('site-par', 'Paris – DC1 (production)', 'Paris 13e');
  const parA = room(par, 'room-par-a', 'Salle A – Production');
  const rowA = row(parA, 'A', 0);
  const rowB = row(parA, 'B', 180);
  const lyo = site('site-lyo', 'Lyon – DC2 (PRA)', 'Vénissieux');
  const lyo1 = room(lyo, 'room-lyo-1', 'Salle PRA');
  const rowL = row(lyo1, 'L', 0);

  const A = Array.from({ length: 8 }, (_, i) => rack(rowA, `A${String(i + 1).padStart(2, '0')}`));
  const B = Array.from({ length: 8 }, (_, i) => rack(rowB, `B${String(i + 1).padStart(2, '0')}`));
  const L = Array.from({ length: 6 }, (_, i) => rack(rowL, `L${String(i + 1).padStart(2, '0')}`));
  A[0].attrs.role = 'Réseau cœur'; A[1].attrs.role = 'Stockage'; A[7].attrs.role = 'Sauvegarde';
  B[2].attrs.role = 'Bases de donnees'; B[7].attrs.role = 'Énergie';
  L[0].attrs.role = 'Réseau'; L[1].attrs.role = 'Stockage'; L[5].attrs.role = 'Sauvegarde';

  // ---------------------------------------------------------------- reseau
  const net = (rk, d) => {
    const dev = device(rk, { serial: serial(d.vendor === 'Cisco' ? 'FDO' : 'SN'), ...d });
    netDevices.push({ ...dev, rack: rk.id });
    return dev;
  };
  const buildCore = (code, rk, ipBase, sizeLarge) => {
    const r1 = net(rk, { id: `rtr-${code}-1`, type: 'router', name: `RTR-${code.toUpperCase()}-1`, hostname: `rtr-${code}-1`, u: 41, height: 1, vendor: 'Cisco', model: 'ASR 1001-HX', ip: `${ipBase}.1` });
    const r2 = sizeLarge ? net(rk, { id: `rtr-${code}-2`, type: 'router', name: `RTR-${code.toUpperCase()}-2`, hostname: `rtr-${code}-2`, u: 39, height: 1, vendor: 'Cisco', model: 'ASR 1001-HX', ip: `${ipBase}.2` }) : null;
    const f1 = net(rk, { id: `fw-${code}-1`, type: 'firewall', name: `FW-${code.toUpperCase()}-1`, hostname: `fw-${code}-1`, u: 35, height: 2, vendor: 'Fortinet', model: sizeLarge ? 'FortiGate 1800F' : 'FortiGate 600F', ip: `${ipBase}.5` });
    const f2 = sizeLarge ? net(rk, { id: `fw-${code}-2`, type: 'firewall', name: `FW-${code.toUpperCase()}-2`, hostname: `fw-${code}-2`, u: 32, height: 2, vendor: 'Fortinet', model: 'FortiGate 1800F', ip: `${ipBase}.6` }) : null;
    const c1 = net(rk, { id: `core-${code}-1`, type: 'switch', name: `CORE-${code.toUpperCase()}-1`, hostname: `core-${code}-1`, u: 28, height: 1, vendor: 'Cisco', model: 'Nexus 9336C-FX2', ip: `${ipBase}.11` });
    const c2 = net(rk, { id: `core-${code}-2`, type: 'switch', name: `CORE-${code.toUpperCase()}-2`, hostname: `core-${code}-2`, u: 26, height: 1, vendor: 'Cisco', model: 'Nexus 9336C-FX2', ip: `${ipBase}.12` });
    const routers = [r1, r2].filter(Boolean);
    const fws = [f1, f2].filter(Boolean);
    for (const r of routers) for (const f of fws) link(r.id, nextPort(r.id, 'Te0/0/'), f.id, nextPort(f.id, 'port'), 10 * G);
    for (const f of fws) for (const c of [c1, c2]) link(f.id, nextPort(f.id, 'port'), c.id, nextPort(c.id), 40 * G);
    link(c1.id, 'Eth1/35', c2.id, 'Eth1/35', 100 * G, 'fiber', 'vPC peer-link');
    return { routers, fws, cores: [c1, c2] };
  };

  const parNet = buildCore('par', A[0], '10.10.0', true);
  const lb1 = net(A[0], { id: 'lb-par-1', type: 'loadbalancer', name: 'LB-PAR-1', hostname: 'lb-par-1', u: 22, height: 1, vendor: 'F5', model: 'BIG-IP i5800', ip: ['10.10.0.21', '10.10.30.10', '10.10.30.11'] });
  const lb2 = net(A[0], { id: 'lb-par-2', type: 'loadbalancer', name: 'LB-PAR-2', hostname: 'lb-par-2', u: 20, height: 1, vendor: 'F5', model: 'BIG-IP i5800', ip: '10.10.0.22' });
  for (const lb of [lb1, lb2]) for (const c of parNet.cores) link(lb.id, nextPort(lb.id, '1.'), c.id, nextPort(c.id), 25 * G);
  const lyoNet = buildCore('lyo', L[0], '10.20.0', false);
  link('core-par-1', 'Eth1/36', 'core-lyo-1', 'Eth1/36', 100 * G, 'fiber', 'DWDM Paris-Lyon (voie 1)');
  link('core-par-2', 'Eth1/36', 'core-lyo-2', 'Eth1/36', 100 * G, 'fiber', 'DWDM Paris-Lyon (voie 2)');

  // onduleur (energie)
  net(B[7], { id: 'ups-par-1', type: 'ups', name: 'UPS-PAR-1', hostname: 'ups-par-1', u: 1, height: 4, vendor: 'Eaton', model: '93PM 50kW', ip: '10.10.0.250' });
  net(B[7], { id: 'ups-par-2', type: 'ups', name: 'UPS-PAR-2', hostname: 'ups-par-2', u: 6, height: 4, vendor: 'Eaton', model: '93PM 50kW', ip: '10.10.0.251' });

  // ToR par baie de calcul
  let torIp = 100;
  const addTors = (rk, code, cores) => {
    const pair = [1, 2].map((n) => net(rk, {
      id: `tor-${rk.id.toLowerCase()}-${n}`, type: 'switch', name: `TOR-${rk.id}-${n}`, hostname: `tor-${rk.id.toLowerCase()}-${n}`,
      u: 43 - n, height: 1, vendor: 'Cisco', model: 'Nexus 93180YC-FX3', ip: `10.${code === 'par' ? 10 : 20}.0.${torIp++}`,
    }));
    pair.forEach((t, i) => {
      link(t.id, 'Eth1/49', cores[i].id, nextPort(cores[i].id), 100 * G, 'fiber');
      link(t.id, 'Eth1/50', cores[1 - i].id, nextPort(cores[1 - i].id), 100 * G, 'fiber');
    });
    tors.set(rk.id, pair);
    return pair;
  };

  // ---------------------------------------------------------------- stockage
  const storage = (rk, d, cores, speed = 100 * G) => {
    const dev = net(rk, { type: 'storage', ...d });
    for (const c of cores) link(dev.id, nextPort(dev.id, 'e0'), c.id, nextPort(c.id), speed, 'fiber');
    return dev;
  };
  storage(A[1], { id: 'stor-par-1', name: 'STOR-PAR-1', hostname: 'stor-par-1', u: 10, height: 4, vendor: 'NetApp', model: 'AFF A400', ip: '10.10.0.31', capacityTB: 184 }, parNet.cores);
  storage(A[1], { id: 'stor-par-2', name: 'STOR-PAR-2', hostname: 'stor-par-2', u: 20, height: 2, vendor: 'Dell', model: 'PowerStore 1200T', ip: '10.10.0.32', capacityTB: 96 }, parNet.cores);
  storage(L[1], { id: 'stor-lyo-1', name: 'STOR-LYO-1', hostname: 'stor-lyo-1', u: 10, height: 4, vendor: 'NetApp', model: 'FAS2750', ip: '10.20.0.31', capacityTB: 240 }, lyoNet.cores, 25 * G);

  // ---------------------------------------------------------------- hotes
  let hostSeq = 1001;
  const addHost = (rk, u, h) => {
    const [t1, t2] = tors.get(rk.id);
    const nic = h.platform === 'vsphere' ? ['vmnic0', 'vmnic1'] : h.platform === 'hyperv' ? ['NIC1', 'NIC2'] : ['eno1', 'eno2'];
    const dev = device(rk, {
      id: h.id, type: 'server', name: h.id.toUpperCase(), hostname: h.id, u, height: h.height || 2,
      vendor: h.vendor, model: h.model, serial: serial(h.vendor === 'Dell' ? '' : 'CZ'),
    });
    const speed = h.platform === 'proxmox' ? 10 * G : 25 * G;
    link(t1.id, nextPort(t1.id), dev.id, nic[0], speed);
    link(t2.id, nextPort(t2.id), dev.id, nic[1], speed);
    const host = { ...h, rack: rk.id, serial: dev.serial, moid: `host-${hostSeq++}`, vms: [] };
    hosts.push(host);
    return host;
  };

  // Paris : VMware (A03-A07), sauvegarde (A08), Hyper-V (B01-B02), SQL (B03), divers (B05)
  let hvIp = 10;
  for (const rk of A.slice(2, 8)) addTors(rk, 'par', parNet.cores);
  for (const rk of [B[0], B[1], B[2], B[4]]) addTors(rk, 'par', parNet.cores);
  let n = 1;
  for (const rk of A.slice(2, 7)) {
    for (const u of [8, 16]) {
      addHost(rk, u, {
        id: `esx-par-${String(n++).padStart(2, '0')}`, platform: 'vsphere', cluster: 'CL-PROD-PAR', vendor: 'Dell', model: 'PowerEdge R750',
        cores: 64, memGB: 1024, ip: `10.10.10.${hvIp++}`, version: 'VMware ESXi 8.0.3',
      });
    }
  }
  n = 1;
  for (const rk of [B[0], B[1]]) {
    for (const u of [8, 16]) {
      addHost(rk, u, {
        id: `hv-par-${String(n++).padStart(2, '0')}`, platform: 'hyperv', cluster: 'HVCL-PAR', vendor: 'HPE', model: 'ProLiant DL380 Gen11',
        cores: 48, memGB: 768, ip: `10.10.10.${hvIp++}`, version: 'Windows Server 2022 Datacenter (Hyper-V)',
      });
    }
  }

  // Lyon : ToR, Proxmox (L03-L04), VMware PRA (L04-L05), sauvegarde (L06)
  for (const rk of L.slice(2, 6)) addTors(rk, 'lyo', lyoNet.cores);
  hvIp = 10;
  addHost(L[2], 8, { id: 'pve-lyo-01', platform: 'proxmox', cluster: 'PVE-LYO', vendor: 'Supermicro', model: 'SYS-120U-TNR', height: 1, cores: 32, memGB: 512, ip: `10.20.10.${hvIp++}`, version: 'Proxmox VE 8.4' });
  addHost(L[2], 12, { id: 'pve-lyo-02', platform: 'proxmox', cluster: 'PVE-LYO', vendor: 'Supermicro', model: 'SYS-120U-TNR', height: 1, cores: 32, memGB: 512, ip: `10.20.10.${hvIp++}`, version: 'Proxmox VE 8.4' });
  addHost(L[3], 8, { id: 'pve-lyo-03', platform: 'proxmox', cluster: 'PVE-LYO', vendor: 'Supermicro', model: 'SYS-120U-TNR', height: 1, cores: 32, memGB: 512, ip: `10.20.10.${hvIp++}`, version: 'Proxmox VE 8.4' });
  addHost(L[3], 16, { id: 'esx-lyo-01', platform: 'vsphere', cluster: 'CL-PRA-LYO', vendor: 'Dell', model: 'PowerEdge R650', height: 1, cores: 48, memGB: 768, ip: `10.20.10.${hvIp++}`, version: 'VMware ESXi 8.0.3' });
  addHost(L[4], 8, { id: 'esx-lyo-02', platform: 'vsphere', cluster: 'CL-PRA-LYO', vendor: 'Dell', model: 'PowerEdge R650', height: 1, cores: 48, memGB: 768, ip: `10.20.10.${hvIp++}`, version: 'VMware ESXi 8.0.3' });
  addHost(L[4], 16, { id: 'esx-lyo-03', platform: 'vsphere', cluster: 'CL-PRA-LYO', vendor: 'Dell', model: 'PowerEdge R650', height: 1, cores: 48, memGB: 768, ip: `10.20.10.${hvIp++}`, version: 'VMware ESXi 8.0.3' });

  // ---------------------------------------------------------------- serveurs physiques
  const addPhysical = (rk, u, p) => {
    const [t1, t2] = tors.get(rk.id);
    const dev = device(rk, { id: p.id, type: 'server', name: p.id.toUpperCase(), hostname: p.id, u, height: p.height || 1, vendor: p.vendor, model: p.model, serial: serial('') });
    link(t1.id, nextPort(t1.id), dev.id, 'NIC1', 25 * G);
    link(t2.id, nextPort(t2.id), dev.id, 'NIC2', 25 * G);
    physicals.push({ ...p, rack: rk.id, serial: dev.serial, mac: mac('b8:ca:3a'), uuid: uuid() });
  };
  addPhysical(B[2], 10, { id: 'sql-par-01', vendor: 'Dell', model: 'PowerEdge R660', os: 'Windows Server 2022 Standard', ip: '10.10.50.11', role: 'SQL Server 2022 (Always On primaire)', cpuBase: 38, memBase: 82, diskBase: 64, cores: 32, memGB: 512 });
  addPhysical(B[2], 12, { id: 'sql-par-02', vendor: 'Dell', model: 'PowerEdge R660', os: 'Windows Server 2022 Standard', ip: '10.10.50.12', role: 'SQL Server 2022 (Always On secondaire)', cpuBase: 14, memBase: 78, diskBase: 63, cores: 32, memGB: 512 });
  addPhysical(A[7], 6, { id: 'bkp-par-01', vendor: 'Dell', model: 'PowerEdge R740xd2', height: 2, os: 'Windows Server 2022 Standard', ip: '10.10.80.10', role: 'Dépôt Veeam', cpuBase: 12, memBase: 45, diskBase: 71, cores: 24, memGB: 192 });
  addPhysical(B[4], 20, { id: 'lic-par-01', vendor: 'HPE', model: 'ProLiant DL20 Gen10', os: 'Windows Server 2019 Standard', ip: '10.10.20.40', role: 'Serveur de licences', cpuBase: 4, memBase: 35, diskBase: 40, cores: 8, memGB: 32 });
  addPhysical(L[5], 6, { id: 'bkp-lyo-01', vendor: 'Dell', model: 'PowerEdge R740xd2', height: 2, os: 'Windows Server 2022 Standard', ip: '10.20.80.10', role: 'Dépôt Veeam (copie PRA)', cpuBase: 9, memBase: 40, diskBase: 58, cores: 24, memGB: 192 });
  device(A[7], { id: 'tape-par-1', type: 'appliance', name: 'LTO-PAR-1', u: 20, height: 6, vendor: 'Quantum', model: 'Scalar i6 (LTO-9)', serial: serial('QTM') });
  link('tape-par-1', 'FC1', tors.get('A08')[0].id, nextPort(tors.get('A08')[0].id), 16 * G, 'fc');

  // ---------------------------------------------------------------- externes
  inventory.externals.push(
    { id: 'ext-internet', name: 'Internet', kind: 'internet', default: 'internet' },
    { id: 'ext-mpls', name: 'WAN MPLS opérateur', kind: 'wan' },
    { id: 'ext-m365', name: 'Microsoft 365', kind: 'cloud', cidrs: ['52.96.0.0/14', '40.96.0.0/13'] },
    { id: 'ext-agence-mrs', name: 'Agence Marseille', kind: 'site', cidrs: ['10.31.0.0/16'] },
    { id: 'ext-agence-lil', name: 'Agence Lille', kind: 'site', cidrs: ['10.32.0.0/16'] },
    { id: 'ext-agence-nts', name: 'Agence Nantes', kind: 'site', cidrs: ['10.33.0.0/16'] },
    { id: 'ext-vpn', name: 'Nomades (VPN SSL)', kind: 'users', cidrs: ['10.99.0.0/16'] },
  );
  for (const r of parNet.routers) {
    link(r.id, 'Te0/1/0', 'ext-internet', null, 10 * G, 'wan', 'Transit IP');
    link(r.id, 'Gi0/2/0', 'ext-mpls', null, 1 * G, 'wan', 'MPLS');
  }
  link('rtr-lyo-1', 'Te0/1/0', 'ext-internet', null, 1 * G, 'wan', 'Transit IP');
  link('rtr-lyo-1', 'Gi0/2/0', 'ext-mpls', null, 1 * G, 'wan', 'MPLS');
  link('ext-mpls', null, 'ext-agence-mrs', null, 500 * M, 'wan', 'Accès MPLS');
  link('ext-mpls', null, 'ext-agence-lil', null, 300 * M, 'wan', 'Accès MPLS');
  link('ext-mpls', null, 'ext-agence-nts', null, 200 * M, 'wan', 'Accès MPLS');
  link('ext-internet', null, 'ext-m365', null, 100 * G, 'wan');
  link('ext-internet', null, 'ext-vpn', null, 10 * G, 'wan');

  // ---------------------------------------------------------------- VM
  const clusterHosts = (c) => hosts.filter((h) => h.cluster === c);
  const vlanIp = new Map();
  const ipFor = (site, vlan) => {
    const k = `${site}.${vlan}`;
    const nIp = (vlanIp.get(k) || 20) + 1;
    vlanIp.set(k, nIp);
    return `10.${site === 'par' ? 10 : 20}.${vlan}.${nIp}`;
  };
  const defs = [];
  const def = (cluster, names, o) => {
    for (const name of [].concat(names)) defs.push({ cluster, name, ...o });
  };
  const seq = (prefix, count, start = 1) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + start).padStart(2, '0')}`);
  const WIN22 = 'Windows Server 2022';
  const WIN19 = 'Windows Server 2019';
  const DEB = 'Debian 12';
  const RHEL = 'Red Hat Enterprise Linux 9';
  const UBU = 'Ubuntu 24.04 LTS';

  // Cluster VMware production (Paris)
  def('CL-PROD-PAR', seq('web-portail-', 6), { os: RHEL, vlan: 30, app: 'Portail clients', role: 'Frontal web (nginx)', cores: 4, memGB: 8, cpu: 28, mem: 55 });
  def('CL-PROD-PAR', seq('app-portail-', 4), { os: RHEL, vlan: 40, app: 'Portail clients', role: 'Serveur d’application (Java)', cores: 8, memGB: 32, cpu: 42, mem: 70 });
  def('CL-PROD-PAR', seq('erp-app-', 3), { os: WIN22, vlan: 40, app: 'ERP', role: 'Serveur d’application ERP', cores: 8, memGB: 32, cpu: 35, mem: 66 });
  def('CL-PROD-PAR', 'erp-batch-01', { os: WIN22, vlan: 40, app: 'ERP', role: 'Traitements batch', cores: 8, memGB: 24, cpu: 20, mem: 50 });
  def('CL-PROD-PAR', 'erp-db-01', { os: WIN22, vlan: 50, app: 'ERP', role: 'SQL Server ERP', cores: 16, memGB: 128, cpu: 45, mem: 88 });
  def('CL-PROD-PAR', seq('rds-gw-', 2), { os: WIN22, vlan: 60, app: 'Bureaux à distance', role: 'Passerelle RDS', cores: 4, memGB: 16, cpu: 22, mem: 45 });
  def('CL-PROD-PAR', seq('rds-sh-', 8), { os: WIN22, vlan: 60, app: 'Bureaux à distance', role: 'Hôte de session RDS', cores: 16, memGB: 96, cpu: 48, mem: 72 });
  def('CL-PROD-PAR', seq('k8s-master-', 3), { os: UBU, vlan: 70, app: 'Kubernetes', role: 'Plan de contrôle', cores: 4, memGB: 16, cpu: 25, mem: 60 });
  def('CL-PROD-PAR', seq('k8s-worker-', 9), { os: UBU, vlan: 70, app: 'Kubernetes', role: 'Nœud de travail', cores: 16, memGB: 64, cpu: 52, mem: 74 });
  def('CL-PROD-PAR', seq('proxy-', 2), { os: DEB, vlan: 20, app: 'Accès Internet', role: 'Proxy web (Squid)', cores: 4, memGB: 8, cpu: 30, mem: 40 });
  def('CL-PROD-PAR', 'mon-01', { os: WIN22, vlan: 20, app: 'Supervision', role: 'SupervisionNG', cores: 8, memGB: 16, cpu: 18, mem: 52 });
  def('CL-PROD-PAR', seq('log-', 2), { os: DEB, vlan: 20, app: 'Supervision', role: 'Elasticsearch', cores: 8, memGB: 64, cpu: 35, mem: 80 });
  def('CL-PROD-PAR', ['wsus-01', 'sccm-01', 'pki-01', 'print-01'], { os: WIN22, vlan: 20, app: 'Services d’infrastructure', role: 'Service Windows', cores: 4, memGB: 16, cpu: 12, mem: 50 });
  def('CL-PROD-PAR', seq('api-gw-', 2), { os: RHEL, vlan: 40, app: 'API', role: 'Passerelle API', cores: 4, memGB: 8, cpu: 30, mem: 50 });
  def('CL-PROD-PAR', seq('mq-', 2), { os: RHEL, vlan: 40, app: 'API', role: 'RabbitMQ', cores: 4, memGB: 16, cpu: 20, mem: 55 });
  def('CL-PROD-PAR', seq('redis-', 2), { os: RHEL, vlan: 40, app: 'Portail clients', role: 'Cache Redis', cores: 4, memGB: 32, cpu: 15, mem: 75 });
  def('CL-PROD-PAR', seq('crm-app-', 2), { os: RHEL, vlan: 40, app: 'CRM', role: 'Application CRM', cores: 8, memGB: 16, cpu: 30, mem: 60 });
  def('CL-PROD-PAR', 'crm-db-01', { os: RHEL, vlan: 50, app: 'CRM', role: 'PostgreSQL', cores: 8, memGB: 64, cpu: 32, mem: 78 });
  def('CL-PROD-PAR', seq('intranet-', 2), { os: WIN22, vlan: 40, app: 'Intranet', role: 'IIS', cores: 4, memGB: 8, cpu: 15, mem: 45 });
  def('CL-PROD-PAR', seq('dev-', 16), { os: UBU, vlan: 90, app: 'Développement', role: 'Poste de dév./recette', cores: 4, memGB: 8, cpu: 10, mem: 40, offRatio: 0.35 });

  // Cluster Hyper-V (Paris)
  def('HVCL-PAR', seq('dc-par-', 2), { os: WIN22, vlan: 20, app: 'Annuaire AD/DNS', role: 'Contrôleur de domaine', cores: 4, memGB: 16, cpu: 14, mem: 48 });
  def('HVCL-PAR', seq('exch-', 2), { os: WIN19, vlan: 60, app: 'Messagerie', role: 'Exchange hybride', cores: 8, memGB: 64, cpu: 32, mem: 76 });
  def('HVCL-PAR', seq('fs-par-', 2), { os: WIN22, vlan: 60, app: 'Fichiers', role: 'Serveur de fichiers (DFS)', cores: 4, memGB: 16, cpu: 16, mem: 50, disk: 78 });
  def('HVCL-PAR', seq('veeam-proxy-', 4), { os: WIN22, vlan: 80, app: 'Sauvegarde', role: 'Proxy Veeam', cores: 8, memGB: 16, cpu: 8, mem: 35 });
  def('HVCL-PAR', seq('sql-app-', 3), { os: WIN22, vlan: 50, app: 'Métiers', role: 'SQL Server', cores: 8, memGB: 64, cpu: 28, mem: 80 });
  def('HVCL-PAR', seq('adfs-', 2), { os: WIN22, vlan: 20, app: 'Annuaire AD/DNS', role: 'ADFS', cores: 4, memGB: 8, cpu: 12, mem: 42 });
  def('HVCL-PAR', ['rh-paie-01', 'compta-01', 'compta-02', 'ged-01', 'ged-02'], { os: WIN22, vlan: 40, app: 'Métiers', role: 'Application métier', cores: 4, memGB: 16, cpu: 22, mem: 55 });
  def('HVCL-PAR', seq('test-hv-', 8), { os: WIN22, vlan: 90, app: 'Développement', role: 'Recette', cores: 2, memGB: 8, cpu: 8, mem: 38, offRatio: 0.5 });

  // Proxmox (Lyon)
  def('PVE-LYO', ['gitlab-01', 'nexus-01', 'sonar-01', 'harbor-01', 'jenkins-01'], { os: DEB, vlan: 90, app: 'Usine logicielle', role: 'Service DevOps', cores: 8, memGB: 32, cpu: 26, mem: 62, site: 'lyo' });
  def('PVE-LYO', seq('gitlab-runner-', 3), { os: DEB, vlan: 90, app: 'Usine logicielle', role: 'Runner CI', cores: 8, memGB: 16, cpu: 35, mem: 50, site: 'lyo', container: true });
  def('PVE-LYO', ['dns-lyo-01', 'dhcp-lyo-01', 'mon-lyo-01'], { os: DEB, vlan: 20, app: 'Services d’infrastructure', role: 'Service réseau', cores: 2, memGB: 4, cpu: 8, mem: 35, site: 'lyo', container: true });
  def('PVE-LYO', seq('lab-', 12), { os: UBU, vlan: 90, app: 'Laboratoire', role: 'Lab', cores: 2, memGB: 4, cpu: 12, mem: 40, site: 'lyo', offRatio: 0.4 });

  // VMware PRA (Lyon)
  def('CL-PRA-LYO', 'dc-lyo-01', { os: WIN22, vlan: 20, app: 'Annuaire AD/DNS', role: 'Contrôleur de domaine', cores: 4, memGB: 16, cpu: 12, mem: 46, site: 'lyo' });
  def('CL-PRA-LYO', 'fs-lyo-01', { os: WIN22, vlan: 60, app: 'Fichiers', role: 'Réplique DFS-R', cores: 4, memGB: 16, cpu: 10, mem: 44, site: 'lyo' });
  def('CL-PRA-LYO', 'veeam-lyo-01', { os: WIN22, vlan: 80, app: 'Sauvegarde', role: 'Proxy Veeam PRA', cores: 8, memGB: 16, cpu: 6, mem: 30, site: 'lyo' });
  def('CL-PRA-LYO', ['pra-web-portail-01', 'pra-web-portail-02', 'pra-app-portail-01', 'pra-app-portail-02', 'pra-erp-app-01', 'pra-erp-db-01', 'pra-rds-sh-01', 'pra-rds-sh-02', 'pra-exch-01', 'pra-crm-app-01'], { os: WIN22, vlan: 40, app: 'Réplicas PRA', role: 'Réplica (Veeam Replication)', cores: 8, memGB: 32, cpu: 0, mem: 0, site: 'lyo', off: true });

  // placement : repartition par memoire
  for (const d of defs) {
    const cands = clusterHosts(d.cluster);
    const host = cands.reduce((best, h) => (load(h) < load(best) ? h : best), cands[0]);
    const off = d.off || (d.offRatio && rnd() < d.offRatio);
    const site = d.site || 'par';
    const vm = {
      id: d.name, name: d.name, cluster: d.cluster, platform: host.platform, host: host.id, os: d.os, app: d.app, role: d.role,
      ip: ipFor(site, d.vlan), vlan: d.vlan, mac: mac(host.platform === 'vsphere' ? '00:50:56' : host.platform === 'hyperv' ? '00:15:5d' : 'bc:24:11'),
      uuid: uuid(), cores: d.cores, memGB: d.memGB, cpuBase: d.cpu, memBase: d.mem, diskBase: d.disk ?? (35 + Math.floor(rnd() * 35)),
      powered: !off, windows: /Windows/.test(d.os), type: d.container ? 'container' : 'vm', site,
      phase: rnd() * Math.PI * 2, vmid: 100 + vms.length, moid: `vm-${2001 + vms.length}`,
    };
    vms.push(vm);
    host.vms.push(vm.id);
  }

  function load(h) {
    return h.vms.reduce((s, id) => s + (vms.find((v) => v.id === id)?.memGB || 0), 0) / h.memGB;
  }

  return { inventory, hosts, physicals, netDevices, vms, racks, tors };
}
