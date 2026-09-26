# Collecteurs — contrat de données

Un collecteur interroge une source (Hyper-V, vCenter, switch SNMP, NetFlow…) et
publie un **snapshot complet** de ce qu'il voit. Chaque snapshot remplace le
précédent de la même source. Le magasin (`server/model/store.js`) fusionne ensuite
toutes les sources en **une seule topologie** : un même serveur vu par
l'inventaire, par Hyper-V et par WinRM devient une seule entité.

## Interface d'un module collecteur

```js
// server/collectors/<type>.js
import { Collector } from './base.js';

class MonCollecteur extends Collector {
  defaultInterval() { return 60; }          // secondes
  async poll() {                            // appelé périodiquement
    return { entities: [...], links: [...], flows: [...] };
  }
}
export default function create(cfg, ctx) { return new MonCollecteur(cfg, ctx); }
```

Les collecteurs « poussés » (ex. récepteur NetFlow) surchargent `start()` /
`stop()` et appellent `this.publish(snapshot)` eux‑mêmes.

`ctx` fournit : `logger`, `config` (configuration globale), `store` (lecture :
`store.getEntities()` renvoie les entités fusionnées), `publish()`.

`cfg` est le bloc de configuration du collecteur (secrets déjà résolus) :
`{ type, name, enabled, interval, timeout, ... }`.

## Snapshot

```js
{
  entities: [{
    id: 'hyperv:hv01',            // unique DANS la source, stable d'une collecte à l'autre
    type: 'hypervisor',           // voir ENTITY_TYPES (shared/model.js)
    name: 'HV01',
    parent: 'hyperv:hv01/hw',     // réf. de l'entité parente (voir « Références »)
    keys: ['host:hv01', 'serial:CZ1234'],   // clés de corrélation (buildKeys())
    status: 'ok',                 // ok | warning | critical | unknown | off
    statusText: 'Service arrêté : W32Time',
    attrs: { vendor, model, serial, os, osVersion, ip: [], mac: [], cpuCores, memGB, cluster, ... },
    metrics: { cpu: 12.5, mem: 64.2, disk: 71, temp, powerW, rxBps, txBps, latencyMs, uptimeS, ... },
  }],
  links: [{
    a: 'snmp:sw1', aPort: 'Gi1/0/1',
    b: 'snmp:esx01', bPort: 'vmnic0',
    kind: 'ethernet',             // ethernet | fiber | fc | wan | lag | virtual
    speedBps: 10e9,
    status: 'ok',
    metrics: { rxBps, txBps, util, errors },   // util en % (0-100)
  }],
  flows: [{
    src: { ip: '10.1.2.3' },      // ou une réf. d'entité
    dst: { ip: '10.1.9.9' },
    proto: 'tcp', port: 443, app: 'https',
    bps: 1200000, pps: 150,
  }],
}
```

### Métriques

Pourcentages (0‑100) : `cpu`, `mem`, `disk` (disque le plus rempli), `util`.
Débits en bit/s : `rxBps`, `txBps`, `bps`. Températures en °C, puissance en W,
durées en secondes (`uptimeS`), latences en ms.

### Références

Un champ de référence (`parent`, `links[].a/b`, `flows[].src/dst`) peut être :

- une **chaîne** : id d'une entité de la même source, sinon id d'une entité
  d'une autre source (ex. id d'inventaire) ;
- un **objet** `{ key: 'host:hv01', cls: 'physical' }` ou `{ keys: [...] }` :
  recherche par clé de corrélation, éventuellement restreinte à une classe ;
- un **objet** `{ ip: '10.0.0.5' }` : recherche par IP (flux). Une IP inconnue
  est rattachée à une entité externe synthétique (Internet, réseau nommé…).

### Clés de corrélation

Utiliser les helpers de `shared/model.js` : `hostKey()`, `fqdnKey()`,
`serialKey()`, `uuidKey()`, `macKey()`, `ipKey()` ou `buildKeys({hostname, serial, uuid, mac, ip})`.

Les clés `host`, `fqdn`, `serial`, `uuid`, `mac` **fusionnent** les entités d'une
même classe (`physical`, `hypervisor`, `vm`…). Les clés `ip` servent seulement
à la recherche.

### Modélisation recommandée d'un hôte de virtualisation

Un collecteur d'hyperviseur publie **trois niveaux** :

1. le serveur physique (`type: 'server'`, classe `physical`) avec les clés
   `host:`, `serial:` → il fusionne avec l'entrée d'inventaire (position en baie) ;
2. l'hyperviseur (`type: 'hypervisor'`, `parent` = le serveur physique) ;
3. les VM (`type: 'vm'`, `parent` = l'hyperviseur) avec clés `uuid:`, `host:`
   (nom d'hôte invité) et `mac:`.

Un serveur physique inconnu de l'inventaire est affiché dans la zone
« Équipements non positionnés ».
