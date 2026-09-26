# Tour 1 — Expert supervision & métrologie

## 1. Diagnostic de la v0.1, vu depuis la console d'un N1/N2

**Précieux, à ne pas casser**
- La **fusion multi-sources par clés** (`store.js`) : une CMDB vivante que ni Centreon ni Zabbix n'offrent nativement. C'est l'actif n°1.
- Le **traçage de chemin** avec ports, débits et taux par saut (capture 02) : ce qu'un N2 réseau fait à la main avec trois outils.
- Le rattachement **flux NetFlow → VM**, la collecte en lecture seule, DPAPI, le hors-ligne, la détection de source obsolète. Tout cela passe une homologation.

**Manquant pour l'adoption**
- Le N1 travaille dans une **liste d'événements**, pas dans une scène. Le bandeau de 176 px montre 3 alarmes, sans tri, filtre, regroupement, durée, « pris en charge par », commentaire ni consigne.
- Les compteurs du haut comptent des **entités** (208 OK, 24 arrêtés), pas les **alarmes non prises en charge**, seule question du N1.
- **Aucun journal** : impossible de dire ce qui s'est passé cette nuit à 3 h 12.
- **Aucune métrologie** : `history.js` garde 1 h (360 points à 10 s, 8 métriques) en RAM, effacée au redémarrage. **Liens et flux ne sont pas historisés.**
- « Disponibilité 37 j 0 h » (capture 04) est un *uptime*. Pour un responsable d'exploitation, la disponibilité est un pourcentage sur une période : c'est le mot des SLA.
- Seuils uniformes : 70/85 °C pour toute température (air entrant d'une baie : 18–27 °C ASHRAE), `disk` = seul volume le plus plein, en % (95 % de 10 To ≠ 95 % de 40 Go).

**Dangereux en production**
1. **Seuils instantanés**, sans durée ni hystérésis ; ping à **un paquet** (`-n 1`) → critique au premier paquet perdu. Capture 06 : 282 alarmes, dont des VM à 97 % de CPU. Un N1 coupe le son en une semaine.
2. **Pas de dépendances** : un hôte tombé produit son alarme, celles de ses VM, de ses liens, de ses pings. La cause racine est noyée.
3. **Une alarme par entité** (`e:<id>`, messages concaténés) : un acquittement couvre CPU et disque à la fois, et un acquittement posé sur un avertissement **reste acquis quand il passe critique**. Aggravation masquée.
4. **Acquittement** anonyme, sans commentaire, en mémoire, **effacé dès que l'alarme disparaît un cycle** : chaque oscillation ressort.
5. **Pas de maintenance planifiée** : chaque intervention prévue = tempête.
6. `maxFlows` = 600 flux gardés **par débit** : DNS, AD, NTP, les petits flux qui cassent tout, disparaissent.
7. Authentification Basic sans rôles ni traçabilité : irrecevable en ministère.

## 2. Les vues

**Un modèle, plusieurs projections.** Toutes les vues partagent la **sélection** (identifiant fusionné), les **filtres** (site, service, criticité) et un **contexte temporel** global (« maintenant » ou « mardi 03 h 12 », qui rejoue états et métriques partout). Menu « Afficher dans… » sur tout élément ; tout adressable par URL (déjà amorcé avec `#sel=`) pour favoris et écrans du mur.

| Vue | Question d'exploitation | Forme | Priorité |
|---|---|---|---|
| **Console d'événements** | Que dois-je traiter, qui s'en occupe ? | Liste pleine largeur, groupée par cause racine | P0 |
| **Services / applications** | Quel service est touché, et par quoi ? | Arbre de dépendances 2D | P0 |
| **Physique** (actuelle) | Où est-ce, que touche cette baie, ce PDU ? | 3D allégée | P0 |
| **Réseau L2** | Où est la coupure, la saturation, le domaine d'impact ? | Schéma 2D issu de LLDP, liens au p95 | P0 |
| **Virtualisation** | Le cluster tient-il N+1 ? Qui consomme ? | Cluster → hôtes → VM, treemap | P1 |
| **Flux** | Qui parle à qui, quoi de nouveau ? | Matrice / Sankey par service | P1 |
| **Réseau L3 & WAN** | VLAN, sous-réseaux, passerelles, agences ? | Schéma + carte multi-sites | P1 (tables ARP/routes à collecter) |
| **Stockage** | Quel datastore sature, quelle latence ? | Tableau + projection | P2 |
| **Énergie & climat** | Tient-on la perte d'une voie électrique, d'une clim ? | **Calque** de la vue physique + tableau | P2 (P1 en salle ministérielle) |

La vue services est le pivot : dépendances **déclarées** et **suggérées** à partir des flux observés, ce que peu d'outils savent faire. La 3D n'est **pas** la vue d'entrée du N1 : c'est celle du technicien d'intervention, de l'impact physique et du mur.

## 3. Métrologie

Concrètement :
- **13 mois d'historique** (septembre N contre N-1, budget capacité).
- **Paliers** agrégés au fil de l'eau : brut 1 min / 14 j ; 15 min (moy., max) / 90 j ; 1 h (min, moy., max, **p95**) / 400 j ; 1 j (moy., max, p95, p99) / 5 ans. **Le p95 se calcule sur le brut au moment de l'agrégation**, jamais sur des moyennes ; et **on ne moyenne pas des moyennes pour afficher un pic** (l'erreur MRTG/Cacti qui efface les saturations).
- **p95** pour le trafic (base de facturation opérateur), **p99** pour les latences.
- **Baselines** : 168 créneaux heure × jour, médiane + MAD sur 4–8 semaines, **en heure locale**. Hors enveloppe = anomalie info/avertissement, jamais critique.
- **Projection** sur le p95 journalier 30–90 j : « D: plein le 14/11 », « cluster sans N+1 mémoire dans 6 semaines ». C'est ce qu'achètent les responsables d'exploitation.
- **Comparaison de périodes**, **rapports de disponibilité** calculés sur le journal des transitions (pas sur des échantillons), maintenances exclues, MTTR ; export PDF/CSV ; API de requête.

**Volumétrie (2 000 VM)** : ≈ 24 000 séries VM, 1 600 séries hyperviseurs, ≈ 35 000 séries interfaces (120 équipements × 48 ports × 6) : **≈ 60 000 séries à 1 min, 86 M points/jour, 1 000 points/s**.
- Naïf, un point par ligne SQLite (~25 o) : **≈ 850 Go sur 13 mois**.
- Paliers + blocs compressés (2–3 o/valeur) : brut ≈ 3 Go, 15 min ≈ 2,5 Go, 1 h ≈ 6 Go, 1 j ≈ 1 Go. **Total ≈ 12–15 Go**, plus 2–3 Go de conversations agrégées (entité × entité × application, 5 min, top N + « autres »).

**Stockage proposé** (dépendance justifiée) :
- **SQLite en WAL** via `node:sqlite`, donc **Node 24 LTS**, déjà embarquable dans le paquet hors-ligne ; repli `better-sqlite3`. Aucun serveur, sauvegarde = copie.
- Une ligne = **une série × une heure**, `Float32Array` compressé (delta/XOR ou `zlib`). Tampon d'une heure en RAM (≈ 14 Mo) + table de transit écrite chaque minute contre les plantages.
- **Un fichier par palier et par mois** : purge = suppression de fichier, jamais de `VACUUM`. Agrégations dans un `worker_thread`.
- UTC aligné sur la minute ; **trous visibles**, jamais interpolés.
- L'installeur pose l'**exclusion Defender** du dossier de données et un quota, avec auto-alarme sous 15 % libres.
- Pas de TSDB tierce par défaut (Prometheus ne sous-échantillonne pas, VictoriaMetrics le réserve à l'édition payante, InfluxDB/Timescale sont trop lourds pour un zip), mais une **interface `MetricStore`** pour les brancher chez les grands comptes.

**Métriques minimales par type**
- *Hyperviseur / serveur* : CPU, **CPU ready**, mémoire active, ballooning/swap, T° entrée et composants, W, alimentations/ventilateurs/RAID (Redfish).
- *VM* : CPU, CPU ready, **% et Go libres par volume**, latence disque, IOPS, réseau, âge des snapshots.
- *Interface* : bps, util (max des deux sens, déjà correct), **erreurs et discards**, état, **vitesse négociée**.
- *Réseau, pare-feu, LB* : CPU, mémoire, T°, voisins BGP/OSPF, sessions, état HA, membres de pool.
- *Stockage* : capacité utilisée/provisionnée, latence L/E, IOPS.
- *Énergie / salle* : kW par voie (**2N : chaque voie < 50 %**), autonomie onduleur, sur batterie, T° d'air entrant par baie.
- *WAN / externe* : latence, gigue, **perte %** (5 paquets par mesure).
- *Service* : sonde synthétique (HTTP, TCP, SQL), temps de réponse p95.

## 4. Supervision : sémantique des alarmes

- **Unité = contrôle** (entité × indicateur). Chaque transition va dans un **journal persistant** qui alimente console, chronologie, rejeu et SLA.
- **États souples / confirmés** : N échecs ou « pendant X min » avant alarme ; **hystérésis** (alarme à 92 %, retour sous 85 %). **Flapping** : une alarme « instable », notifications suspendues.
- **Dépendances** implicites (VM → hyperviseur → serveur → ToR, LLDP) et déclarées (services). Parent en défaut → enfants **« Injoignable (cause : X) »**, grisés, non notifiés, regroupés : « ESX-PAR-07 injoignable — 8 VM, 3 services impactés ». La joignabilité se calcule sur le **chemin entre le serveur SupervisionNG et la cible** : le graphe du traçage fait déjà ce travail.
- **Cause racine** : règles topologiques + fenêtre de 60–120 s, **explicables** ; pas d'apprentissage opaque.
- **Cycle de vie** : Ouverte → Prise en charge (qui, quand, **commentaire obligatoire**, n° de ticket) → Résolue → Close. Acquittement persistant, audité, **levé si aggravation**, expiration optionnelle.
- **Maintenances** sur entité, groupe ou service, propagées au choix, récurrentes (Patch Tuesday), planifiées d'avance : événements enregistrés mais non notifiés, exclus du SLA, pictogramme dans toutes les vues ; **alarme si l'élément n'est pas revenu OK en fin de fenêtre**.
- **Héritage** : état propre et état hérité distincts (A05 « état agrégé du contenu » est un bon début). Clusters et services : **règles de redondance** (1 hôte sur 8 perdu, N+1 respecté = avertissement).
- **Priorité = sévérité × criticité métier** (production, PRA, recette, dev) : `dev-05` ne réveille personne. Seuils surchargeables par groupe et entité, avec durée.
- **Notifications hors-ligne** : SMTP interne, syslog, traps vers l'hypervision, webhook ITSM (GLPI, ServiceNow) ; escalade (non prise en charge à 15 min → N2, 30 min → astreinte).
- **Superviser le superviseur** : bandeau « DONNÉES FIGÉES depuis 2 min » si le flux SSE ou un collecteur se tait ; `/api/health` contrôlé par une tâche externe.

## 5. Interdits et risques

(Must / Should / Could : voir le tableau.)

**À ne PAS faire**
- La 3D comme console principale ou seul accès à une information : tout doit exister en liste ou en 2D (GPU intégrés, daltonisme, rapidité).
- Réécrire Grafana : quelques vues de métrologie contextuelles et un export suffisent.
- Laisser une anomalie statistique produire du critique.
- Stocker 13 mois de brut, ou un point par ligne.
- Ajouter de l'écriture ou de la remédiation sur les cibles : la lecture seule est un atout d'homologation.

**Risques** : dériver en « Centreon bis » (tenir le positionnement : carte vivante + métrologie contextualisée + corrélation) ; boucle Node saturée par les agrégations ; `node:sqlite` encore évolutif (isoler derrière une interface) ; disque plein ; dérive d'horloge entre sources ; inventaire faux rendant la 3D trompeuse (afficher source et date de chaque donnée).

## Recommandations numérotées

| N° | Recommandation | Priorité | Justification |
|---|---|---|---|
| EXP-1 | Moteur d'événements persistant : alarme par contrôle, journal, confirmation, hystérésis, flapping | Must | Sans lui : tempête et amnésie, rejet par les N1 |
| EXP-2 | Dépendances implicites et déclarées, état « Injoignable », regroupement par cause racine | Must | Un incident = une ligne, pas 40 |
| EXP-3 | Prise en charge nominative + commentaire, levée si aggravation, maintenances récurrentes | Must | Traçabilité ITIL, fin des alarmes masquées |
| EXP-4 | SQLite (`node:sqlite`, Node 24) à paliers, blocs compressés, un fichier par mois, p95 sur le brut | Must | 13 mois ≈ 15 Go, hors-ligne, sans serveur |
| EXP-5 | Console d'événements pleine largeur, compteurs « non pris en charge » | Must | L'outil de travail réel du N1 |
| EXP-6 | Vue services avec état calculé par règles de redondance | Must | Répond à « qui est impacté ? » |
| EXP-7 | Vue réseau L2 2D (LLDP), liens au p95 | Must | Données déjà là ; la 3D ne diagnostique pas un réseau |
| EXP-8 | Sélection, filtres et curseur temporel partagés, URL adressables | Must | Cohérence multi-vues, post-mortem |
| EXP-9 | Rôles lecteur/opérateur/admin, audit, vocabulaire (uptime ≠ disponibilité) | Must | Recevabilité ministère |
| EXP-10 | Supervision du superviseur : données figées, santé externe, quota disque | Must | Un mur figé mais vert est le pire scénario |
| EXP-11 | Métriques enrichies : CPU ready, discards, vitesse négociée, Go libres, perte %, kW/voie | Must | Les métriques actuelles ratent les vraies pannes |
| EXP-12 | Baselines, projection de saturation, comparaison de périodes | Should | La promesse « métrologie » du client |
| EXP-13 | Rapports de disponibilité / SLA sur le journal, PDF/CSV | Should | Livrable mensuel de l'exploitation |
| EXP-14 | Import des états Centreon / Zabbix / Alertmanager, export Prometheus | Should | Coexister plutôt que remplacer : adoption |
| EXP-15 | Notifications et escalade hors-ligne (SMTP, syslog, trap, webhook) | Should | Muette hors de la salle, elle ne protège personne |
| EXP-16 | Calque énergie/climat (2N, T° d'entrée) sur la vue physique | Could (Should en ministère) | Risque physique majeur, mal couvert ailleurs |
