# Dossier du conseil — refonte de SupervisionNG

## Le produit aujourd'hui (v0.1)
SupervisionNG : application de supervision d'infrastructure, **une vue 3D unique** (three.js dans le navigateur,
serveur Node.js), tourne sous **Windows** (paquet autonome, service = tâche planifiée), hors-ligne possible,
interface en français. Code : ce dépôt (README.md, docs/COLLECTEURS.md,
public/js/scene/*.js pour la vue, server/model/store.js pour la fusion des données).

Données : collecteurs inventaire (sites/salles/rangées/baies/positions U/câblage), Windows CIM/WinRM, Hyper-V,
vSphere, Proxmox, SNMP (+LLDP → câblage), NetFlow v5/v9/IPFIX, ping, API d'ingestion. Un moteur fusionne les
sources par clés (hôte, série, UUID, MAC), résout les flux IP vers les VM, calcule des alarmes à seuils,
pousse des deltas temps réel (SSE). Historique : seulement ~1 h en mémoire (tampons circulaires), pas de base
de séries temporelles. Mode démonstration : 2 datacenters (Paris, Lyon PRA), ~140 VM, incidents simulés.

Vue actuelle (une seule scène) : salles au sol, baies 42U avec équipements en position U réelle et voyant d'état
en façade, câbles (lignes à épaisseur écran) routés à l'arrière des baies, couche « hyperviseurs » en îlots par
cluster flottant au-dessus des baies, VM en cubes posés sur les plateaux, flux en arcs + particules, externes
(Internet, WAN, agences) en sphères filaires. Traçage du chemin physique d'un flux (VM → hyperviseur → serveur →
ToR → cœur → … → VM). Coloration statut / CPU / mémoire / disque / température. Isoler la sélection.
Interface : barre du haut (compteurs d'état, recherche), panneau gauche fixe 246 px (couches, coloration,
écartement, vues, options, légende), panneau droit 380 px (détail), bandeau bas 176 px (alarmes / collecteurs).
Mode mur d'écrans (?kiosk=1).

Captures : sept captures de la v0.1 (vue d'ensemble, traçage, allée, coloration CPU, deux sites, grande infrastructure, sélection d'un lien), non versionnées.


## Retour du client (mot pour mot, à traiter intégralement)
« bon c'est un peu cette vibe là mais j'ai plusieurs remarques :
- Utilise un nouveau skill design pour proposer un visuel vraiment unique et un niveau de détail élevé
- L'interface prend trop de place sur le visuel
- Il faut plusieurs vues comme la vue physique et des vues logiques
- C'est de la supervision mais aussi un outil de métrologie
- Échanger avec un conseil d'expert en sup et des UI/UX designer la marche à suivre pour la prochaine grande refonte. »

## Contraintes à respecter
- Doit tourner sous Windows, y compris sur des postes/serveurs sans GPU puissant (murs d'écrans NOC : souvent
  des PC avec GPU intégré), et hors-ligne (aucune ressource CDN, tout servi localement).
- Stack actuelle : Node.js ≥ 20 sans étape de build, three.js, ES modules, pas de framework front. Une étape de
  build ou une base de données embarquée peuvent être proposées si elles se justifient (dites-le).
- Utilisateurs : opérateurs de supervision (N1/N2), ingénieurs systèmes/réseau, responsables d'exploitation,
  mur d'écrans de salle de supervision. Français.
- Le périmètre fonctionnel déjà acquis (collecteurs, fusion, traçage de chemin) doit être conservé.

## Le conseil
- Expert supervision & métrologie (NOC, Centreon/Nagios/Zabbix/Prometheus/Grafana, ITIL, SLA, capacité).
- Designer UI/UX spécialiste des interfaces denses de salle de contrôle.
- Directeur artistique 3D & data-visualisation.
Chacun écrit sa contribution, puis lit celles des autres et réagit (accord, désaccord argumenté, amendements).
