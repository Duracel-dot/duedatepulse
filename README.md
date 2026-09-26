# SupervisionNG

**Une vue 3D unique et intégrale de l'infrastructure** : salles et baies physiques,
systèmes, réseau et câblage, hyperviseurs, machines virtuelles et flux applicatifs,
dans une seule scène navigable, mise à jour en temps réel. Fonctionne sous **Windows**
(serveur Node.js, sans compilation ; affichage dans Edge ou Chrome).

![Vue d'ensemble : baies, câblage, clusters d'hyperviseurs, VM et flux](docs/apercu.png)

## Ce que montre la vue

| Couche | Représentation |
|---|---|
| **Sites & salles** | sites côte à côte, salles avec faux-plancher, rangées en allées chaudes / froides |
| **Baies & équipements** | baies 42U, serveurs, stockage, onduleurs à leur position U réelle ; voyant d'état en façade |
| **Réseau & câblage** | commutateurs, routeurs, pare-feu, répartiteurs ; câbles réels (inventaire + LLDP) colorés selon l'utilisation |
| **Hyperviseurs** | plateaux regroupés en îlots par cluster, au-dessus des baies, reliés au serveur physique qui les porte |
| **Machines virtuelles** | un cube par VM (prisme hexagonal pour un conteneur) posé sur son hyperviseur |
| **Flux** | arcs animés entre VM, serveurs et externes ; densité = débit, couleur = type d'application |
| **Externes** | Internet, WAN, agences, cloud (Microsoft 365…) avec leurs liens et leur latence |

Fonctions principales :

- **Corrélation multi-sources** : un même serveur vu par l'inventaire, Hyper-V, WinRM et SNMP
  devient une seule entité (clés : nom d'hôte, n° de série, UUID, MAC) ; les flux NetFlow,
  qui ne contiennent que des adresses IP, sont rattachés automatiquement aux VM.
- **Traçage de chemin** : un clic sur un flux affiche son trajet physique réel,
  VM → hyperviseur → serveur → carte réseau → ToR → cœur → … → VM, avec les ports, débits
  et taux d'utilisation de chaque lien traversé.
- **Alarmes** : seuils (CPU, mémoire, disque, température, latence, utilisation des liens),
  états remontés par les collecteurs, colonnes lumineuses au-dessus des baies en défaut,
  acquittement.
- **Coloration** par statut ou en carte de chaleur (CPU, mémoire, disque, température).
- **Isolation** d'un élément et de tout ce qui lui est lié (touche `I`), recherche (`/`),
  écartement des couches, vues prédéfinies.
- **Mode mur d'écrans** (`?kiosk=1` ou touche `K`) : rotation automatique et passage en revue
  des alarmes, pour les écrans de salle de supervision.

![Traçage du chemin physique d'un flux](docs/trace-flux.png)

## Démarrage rapide sous Windows

### Option 1 — paquet prêt à l'emploi (recommandé)

1. Récupérer **`SupervisionNG-x.y.z-windows.zip`** (≈ 6 Mo, dépendances incluses).
2. Décompresser, par exemple dans `C:\SupervisionNG`.
3. Double-cliquer sur **`SupervisionNG.cmd`**.

Si Node.js 20+ n'est pas installé, le lanceur télécharge automatiquement Node.js portable
depuis nodejs.org (somme de contrôle SHA-256 vérifiée, proxy système pris en compte) dans
le sous-dossier `node\`. Rien n'est installé dans Windows.

**Poste sans accès Internet** : utiliser le paquet hors-ligne, qui embarque `node.exe`
(artefact **SupervisionNG-win-x64** de la CI GitHub Actions, ou
`npm run package:win -- --with-node`). S'il est fourni en deux parties
(`.zip.001` et `.zip.002`), les recomposer. Dans PowerShell :

```powershell
cmd /c copy /b SupervisionNG-0.1.0-windows-hors-ligne.zip.001 + SupervisionNG-0.1.0-windows-hors-ligne.zip.002 SupervisionNG-hors-ligne.zip
Unblock-File .\SupervisionNG-hors-ligne.zip
Expand-Archive .\SupervisionNG-hors-ligne.zip -DestinationPath .
.\SupervisionNG\SupervisionNG.cmd
```

(Dans une invite de commandes `cmd`, la première ligne s'écrit sans `cmd /c`.)

(7-Zip ouvre aussi directement le fichier `.001`.)

### Option 2 — depuis les sources

Prérequis : [Node.js 20 LTS ou plus récent](https://nodejs.org).

```bat
git clone <ce dépôt> C:\SupervisionNG
cd C:\SupervisionNG
npm ci
SupervisionNG.cmd
```

Sans fichier `config\supervisionng.json`, SupervisionNG démarre en **mode démonstration** :
deux datacenters simulés (Paris et un site de secours à Lyon), environ 140 VM sur VMware,
Hyper-V et Proxmox, un réseau complet, des flux applicatifs et des incidents
(panne d'hôte avec redémarrage HA des VM, lien coupé, saturation, attaque DDoS, surchauffe
de baie…). La vue s'ouvre sur <http://localhost:8080>.

Options de ligne de commande :

```
node server\index.js [--config fichier] [--demo] [--port 8080] [--host 0.0.0.0] [--open]
```

## Passer sur l'infrastructure réelle

1. **Configuration** : copier `config\supervisionng.example.json` en `config\supervisionng.json`,
   activer les collecteurs voulus (`"enabled": true`) et renseigner les cibles.
2. **Inventaire physique** : copier `config\inventory.example.json` en `config\inventory.json`
   et décrire sites, salles, rangées, baies et positions U. C'est la seule information qui ne
   se découvre pas ; le reste (VM, hyperviseurs, voisins réseau, flux) est collecté. Le fichier
   est relu automatiquement à chaque modification.
3. **Secrets** : ne pas laisser de mot de passe en clair. Deux possibilités :
   - `"password": "env:SNG_VCENTER_PASSWORD"` (variable d'environnement) ;
   - `"password": "dpapi:..."`, valeur produite par
     `powershell -ExecutionPolicy Bypass -File scripts\protect-secret.ps1` (chiffrement DPAPI
     lié à la machine).
4. **Service Windows** : dans une console PowerShell **administrateur**,
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -OpenFirewall -NetFlowPort 2055
   ```
   crée une tâche planifiée lancée au démarrage (redémarrage automatique en cas d'arrêt),
   sous le compte `SYSTEM` ou un compte de service (`-User DOMAINE\svc-supervision`).
   Journal : `logs\supervisionng.log`. Désinstallation : `scripts\uninstall-service.ps1`.
5. Pour afficher la vue depuis d'autres postes : `"server": { "host": "0.0.0.0" }`, et de
   préférence `"auth"` (authentification) et `"https"` (certificat `.pfx`).

## Collecteurs

| Type | Source | Ce qui est collecté | Prérequis |
|---|---|---|---|
| `inventory` | `config\inventory.json` | sites, salles, baies, positions U, câblage déclaré, externes | — |
| `windows` | CIM / WinRM (PowerShell) | OS, CPU, mémoire, disques, services automatiques arrêtés, IP/MAC ; connexions TCP → flux (`"flows": true`) | WinRM (TCP 5985/5986) ; droits de lecture CIM (administrateur local ou *Remote Management Users* + droits WMI) |
| `hyperv` | PowerShell Hyper-V / WinRM | hôtes, matériel, cluster, VM (état, CPU, mémoire, réseaux, VLAN, réplication) | module Hyper-V (RSAT) sur le serveur SupervisionNG ; compte membre de *Hyper-V Administrators* |
| `vsphere` | API REST vCenter | clusters, ESXi, VM, identité invité ; CPU/mémoire via VI/JSON | vSphere 7+ (métriques : 8.0U1+) ; rôle lecture seule ; TCP 443 |
| `proxmox` | API Proxmox VE | nœuds, VM QEMU, conteneurs LXC, stockages, MAC/VLAN | jeton d'API avec rôle *PVEAuditor* ; TCP 8006 |
| `snmp` | SNMP v2c / v3 | système, interfaces et débits (IF-MIB), n° de série (ENTITY-MIB), **voisins LLDP → câblage automatique** | UDP 161 ; vues SNMPv2-MIB, IF-MIB, ENTITY-MIB, LLDP-MIB |
| `netflow` | NetFlow v5 / v9 / IPFIX | flux (conversations, débits), rattachés aux VM par IP | exporter depuis routeurs / pare-feu / switches vers UDP 2055 ; règle de pare-feu entrante |
| `ping` | ICMP | disponibilité et latence de tous les équipements connus ayant une IP | ICMP autorisé sur les cibles |
| ingestion | `POST /api/ingest/<source>` | tout ce qu'un script ou un autre outil veut pousser | voir [docs/API.md](docs/API.md) |

Le format de données commun à tous les collecteurs, et la façon d'en écrire un nouveau,
sont décrits dans [docs/COLLECTEURS.md](docs/COLLECTEURS.md).

### Comment les sources sont fusionnées

Chaque collecteur publie ce qu'il voit avec des **clés de corrélation**. Deux entités de
même classe (physique, hyperviseur, VM) partageant une clé forte — `host:` (nom d'hôte court),
`fqdn:`, `serial:`, `uuid:`, `mac:` — sont fusionnées. L'inventaire a la priorité pour le nom
et la position ; l'état retenu est le pire des états remontés ; les métriques les plus
récentes l'emportent. Un collecteur d'hyperviseur publie trois niveaux (serveur physique →
hyperviseur → VM), ce qui place automatiquement chaque VM au-dessus de la baie qui l'héberge.
Un équipement découvert mais absent de l'inventaire apparaît dans la zone
« Équipements non positionnés ». Les données d'une source qui ne répond plus sont
signalées obsolètes (état inconnu) au bout d'environ trois intervalles de collecte.

## Utilisation de la vue

| Action | Souris / clavier |
|---|---|
| Tourner / déplacer / zoomer | clic gauche / clic droit (ou Maj + clic) / molette |
| Sélectionner, détails | clic sur un équipement, une VM, un câble, un flux ou une étiquette |
| Centrer sur la sélection | double-clic ou `F` |
| Tracer le chemin d'un flux | clic sur un flux dans la scène ou dans le panneau de détail |
| Rechercher (nom, IP, hôte…) | `/` |
| Afficher / masquer une couche | `1` à `7` |
| Changer de coloration | `C` |
| Isoler la sélection | `I` |
| Vue d'ensemble / de dessus | `R` / `T` |
| Mode mur d'écrans | `K` (ou URL `?kiosk=1`) |
| Désélectionner | `Échap` |

L'URL peut désigner un élément (`#sel=<id>`) et restreindre les couches
(`?layers=physical,network`) : pratique pour des favoris ou des écrans dédiés.

## Sécurité

- Écoute par défaut sur `127.0.0.1` ; ouvrir explicitement (`"host": "0.0.0.0"`).
- Authentification HTTP Basic (`server.auth`) et HTTPS (`server.https` avec un `.pfx`) intégrés.
- L'API d'ingestion exige un jeton (`server.ingestToken`) ; sans jeton, seuls les envois
  locaux sont acceptés.
- Les collecteurs ne font que de la **lecture** (CIM, API en lecture seule, SNMP GET).
- Les secrets se référencent par variable d'environnement ou par chiffrement DPAPI.
- Aucune ressource externe : three.js est servi localement, la vue fonctionne sur un réseau isolé.

## Architecture

```
SupervisionNG.cmd          lanceur Windows (double-clic)
server/
  index.js                 démarrage : configuration, collecteurs, serveur HTTP
  config.js                configuration JSONC + secrets (env:, dpapi:, file:)
  model/store.js           fusion multi-sources, seuils, alarmes, deltas temps réel
  model/inventory.js       inventaire physique -> entités
  collectors/              demo, inventory, windows, hyperv, vsphere, proxmox, snmp, netflow, ping
  http/app.js              API REST, flux SSE, fichiers statiques
scripts/ps/                scripts PowerShell des collecteurs Windows (ASCII, compatibles 5.1 et 7)
shared/                    modèle et graphe communs serveur / navigateur (calcul des chemins)
public/                    vue 3D (three.js, sans étape de build) et interface
config/                    exemples de configuration et d'inventaire
```

Dépendances : `three` (rendu 3D) et `net-snmp` (optionnelle, collecteur SNMP). Pas de base de
données : l'état est reconstruit en mémoire à partir des collecteurs ; l'historique des
métriques (≈ 1 h) sert aux mini-graphes.

## Développement

```bash
npm ci
npm test                 # tests unitaires et d'intégration (node:test)
npm run demo             # serveur en mode démonstration
npm run package:win -- --with-node   # paquet Windows autonome dans dist/
```

La CI GitHub Actions exécute les tests sous **Windows et Linux** (Node 20 et 22), lance les
scripts PowerShell réels sous Windows PowerShell 5.1, puis construit et vérifie le paquet
Windows autonome (artefact téléchargeable).

## Prochaine grande refonte

La direction de la prochaine refonte est décrite dans [docs/refonte/](docs/refonte/README.md). Elle a été
arrêtée par un conseil réunissant un expert en supervision, un designer UI/UX et un directeur artistique :

- la piste visuelle « Maquette & calques » ;
- une interface ramenée à environ 9 % de l'écran ;
- des vues physique et logiques ;
- un stockage de métrologie sur 13 mois ;
- une feuille de route en deux refontes.

Le dossier contient aussi les maquettes et les comptes rendus complets du conseil, ainsi que
l'[architecture du backend](docs/refonte/ARCHITECTURE-BACKEND.md) : socle Telegraf et VictoriaMetrics,
méthodes de remontée et mesures de sécurité.

Une **démo jouable du nouveau front** est servie par l'application, hors ligne : lancer la démonstration
(`SupervisionNG.cmd` ou `npm run demo`), puis ouvrir <http://localhost:8080/refonte/>. Elle rejoue un
incident avec des données figées.

La **démo spatiale** <http://localhost:8080/refonte/spatial/> intègre toute la console dans la scène 3D. Les
strates physique, réseau, virtualisation et services y sont superposées à l'aplomb les unes des autres. La
démo applique aussi la grammaire de l'état global (marge, redondance, inconnu, interventions), arrêtée par un
[conseil d'experts de la production](docs/refonte/CONSEIL-PRODUCTION.md).

## Licence

MIT — voir [LICENSE](LICENSE).
