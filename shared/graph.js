// Parcours du graphe de topologie (partage serveur / navigateur).
//  - ancre physique d'une entite (VM -> hyperviseur -> serveur) ;
//  - plus court chemin sur les liens physiques ;
//  - chemin complet d'un flux (VM source ... switches ... VM destination).

/**
 * @param {Iterable<object>} entities
 * @param {Iterable<object>} links
 */
export function buildIndex(entities, links) {
  const byId = new Map();
  const children = new Map();
  const adj = new Map();
  for (const e of entities) byId.set(e.id, e);
  for (const e of byId.values()) {
    if (!e.parent) continue;
    if (!children.has(e.parent)) children.set(e.parent, []);
    children.get(e.parent).push(e.id);
  }
  for (const l of links) {
    if (!byId.has(l.a) || !byId.has(l.b)) continue;
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push({ to: l.b, link: l });
    adj.get(l.b).push({ to: l.a, link: l });
  }
  return { byId, children, adj };
}

/** Chaine des ancetres logiques jusqu'au premier equipement physique ou externe (inclus). */
export function anchorChain(id, byId) {
  const chain = [];
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur.id);
    if (cur.cls === 'physical' || cur.cls === 'external' || cur.type === 'external') return chain;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return chain;
}

export function physicalAnchor(id, byId) {
  const chain = anchorChain(id, byId);
  return chain.length ? chain[chain.length - 1] : null;
}

/**
 * Plus court chemin (BFS) entre deux entites sur les liens physiques.
 * Les liens coupes (status critical) sont evites si un autre chemin existe.
 * @returns {{nodes:string[], links:object[]}|null}
 */
export function findPath(from, to, adj, opts = {}) {
  if (from === to) return { nodes: [from], links: [] };
  const maxNodes = opts.maxNodes ?? 5000;
  const transit = opts.transit || null; // (id) => bool : noeud traversable
  const avoid = opts.avoid || null;     // Set d'id de liens a eviter
  const attempt = (avoidDown) => {
    const prev = new Map([[from, null]]);
    const queue = [from];
    for (let qi = 0; qi < queue.length && prev.size < maxNodes; qi++) {
      const cur = queue[qi];
      if (cur !== from && transit && !transit(cur)) continue;
      for (const { to: nxt, link } of adj.get(cur) || []) {
        if (prev.has(nxt)) continue;
        if (avoidDown && link.status === 'critical') continue;
        if (avoid && avoid.has(link.id)) continue;
        prev.set(nxt, { node: cur, link });
        if (nxt === to) {
          const nodes = [to];
          const links = [];
          let p = prev.get(to);
          while (p) {
            links.unshift(p.link);
            nodes.unshift(p.node);
            p = prev.get(p.node);
          }
          return { nodes, links };
        }
        queue.push(nxt);
      }
    }
    return null;
  };
  return attempt(true) || attempt(false);
}

/**
 * Chemin de bout en bout d'un flux : VM -> hyperviseur -> serveur -> reseau -> ... -> VM.
 * @returns {{entities:string[], links:object[], complete:boolean}}
 */
export function flowPath(flow, index, opts = {}) {
  const srcChain = anchorChain(flow.src, index.byId);
  const dstChain = anchorChain(flow.dst, index.byId);
  const a = srcChain[srcChain.length - 1];
  const b = dstChain[dstChain.length - 1];
  if (!a || !b) return { entities: [...srcChain, ...dstChain.reverse()], links: [], complete: false };
  if (a === b) {
    const merged = [...srcChain];
    for (const id of [...dstChain].reverse()) if (!merged.includes(id)) merged.push(id);
    return { entities: merged, links: [], complete: true };
  }
  // Les serveurs et le stockage ne servent pas de transit (un serveur a deux
  // cartes ne route pas entre deux commutateurs).
  const transit = opts.transit ?? ((id) => {
    const e = index.byId.get(id);
    return !e || e.type === 'switch' || e.type === 'router' || e.type === 'firewall' || e.type === 'loadbalancer' || e.type === 'external';
  });
  const path = findPath(a, b, index.adj, { transit });
  const entities = [...srcChain.slice(0, -1)];
  if (path) entities.push(...path.nodes); else entities.push(a, b);
  entities.push(...dstChain.slice(0, -1).reverse());
  return { entities, links: path ? path.links : [], complete: !!path };
}
