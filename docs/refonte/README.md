# Refonte de SupervisionNG — marche à suivre

Ce dossier fixe la direction de la prochaine grande refonte. Il réunit :

- la synthèse du conseil (ce fichier) : décisions, arbitrages et feuille de route ;
- les comptes rendus complets des deux tours du conseil, dans [`conseil/`](conseil/) ;
- les maquettes de la piste retenue, dans [`maquettes/`](maquettes/).

Le conseil réunissait trois points de vue : un expert en supervision et métrologie (NOC, Centreon, Zabbix, Prometheus, ITIL, SLA), un designer UI/UX spécialiste des salles de contrôle, et un directeur artistique 3D et data-visualisation. Au premier tour, chacun a produit un diagnostic et des recommandations numérotées (EXP-n, UX-n, DA-n). Au second tour, chacun a lu les deux autres, puis a voté et amendé. Les désaccords restants ont été arbitrés ci-dessous.

## 1. Les remarques du client et nos réponses

| Remarque | Réponse |
|---|---|
| Un visuel vraiment unique, avec un haut niveau de détail | Direction « Maquette & calques » : la salle dessinée comme une maquette d'architecte en graphite mat, les couches logiques posées au-dessus comme des calques. Le détail (façades, bandes U, allées confinées, climatisation) est monochrome et ne crie jamais. Seules les anomalies portent de la couleur. |
| L'interface prend trop de place | L'interface passe de 30 à 45 % de l'écran à environ 8,8 % au repos en 1920×1080 : HUD de 36 px, rail de 44 px, bande de 28 px et lentille de recherche de 440×32. Les panneaux ne s'ouvrent qu'à la demande. |
| Plusieurs vues, physique et logiques | Un seul modèle, plusieurs projections qui partagent sélection, périmètre, filtres et temps. La 3D sert la géométrie : salle, baie, câblage. La 2D sert les graphes : services, réseau en plan de métro, capacité de virtualisation, flux. |
| Supervision **et** métrologie | Un stockage de séries sur 13 mois (SQLite à paliers, sans serveur), le p95 calculé sur les données brutes, des plages normales, une projection de saturation, la comparaison de périodes et des rapports de disponibilité. |
| La marche à suivre avec un conseil | Deux refontes successives, décrites au § 5, chacune avec ses critères de sortie. |

## 2. Principes adoptés à l'unanimité

1. **La normalité est silencieuse** (ISA-101 ; UX-1, DA-1). Un état nominal est gris et sans couleur. Le rouge, l'ambre et le jaune sont réservés aux anomalies. Chaque sévérité est aussi portée par une forme (UX-5).
2. **Un incident = une ligne.** On lève une alarme par contrôle (entité × indicateur), avec confirmation, hystérésis et détection du battement. Les dépendances rendent les enfants « Injoignable (cause : X) » : ils sont regroupés sous la cause racine et ne sont pas notifiés (EXP-1, EXP-2).
3. **La prise en charge est nominative et commentée.** Elle propose des modèles de commentaire et le raccourci Ctrl+Entrée. Elle est levée si l'alarme s'aggrave. Les maintenances sont planifiées et peuvent être récurrentes (EXP-3).
4. **3D pour la géométrie, 2D pour les graphes.** Aucune information n'existe seulement en 3D : tout est aussi disponible en liste ou en 2D (GPU intégrés, daltonisme, rapidité).
5. **Le superviseur est supervisé.** Un bandeau « Données figées » apparaît dès qu'une source se tait. L'âge des données est toujours affiché, et un chien de garde vérifie le rendu (EXP-10).
6. **Toujours hors ligne, sous Windows, sur GPU intégré.** Aucune ressource CDN : polices, jetons et moteur sont servis localement. Le rendu se fait à la demande, sans `backdrop-filter`, à 60 i/s visés et 30 au pire.

## 3. Décisions visuelles

**Direction artistique : A « Maquette & calques »** (vote unanime). B « Cyanotype » rend mal le rouge et fatigue en 3×8. Le vert de C « Phosphore » contredit la sémantique d'état. Les maquettes B et C sont conservées pour mémoire.

**Jetons** : un seul `tokens.json` sert au CSS et à la scène 3D (DA-2). Les valeurs complètes figurent dans [`conseil/6-directeur-artistique-tour2.md`](conseil/6-directeur-artistique-tour2.md) ; les amendements ci-dessous les remplacent.

| Rôle | Valeur | Règle |
|---|---|---|
| Fond, surface, filet | `#12161C`, `#181D24`, `#2A313B` | graphite mat |
| Encre, encre claire | `#8A94A0`, `#DDE1E6` | l'état normal est à l'encre |
| Interaction | ivoire `#F5F1E8` | portée par la **forme** : coque, halo, étiquette inversée, focus de 2 px ; sert aussi au traçage de chemin |
| Temps non réel | violet `#B78CFF` | relecture et comparaison seulement |
| P1 critique | `#FF5A47`, losange plein | seule une cause racine non prise en charge clignote (1 Hz) |
| P2 majeur | `#F5A524`, triangle plein | inclut « perte de supervision » |
| P3 mineur | `#E8D44D`, cercle creux | absent du mur et du niveau de détail LOD2 |
| Rampe métrique | 5 bleus, de `#1B2633` à `#9CC3EA` | monochrome, jamais de jaune |

**Typographie** : IBM Plex, embarquée. Plex Sans pour l'interface. Plex Sans Condensed pour la scène, les en-têtes et les tableaux denses (12 px minimum). Plex Mono pour les noms d'objets, les IP, les valeurs et les durées : chiffres tabulaires, et jamais de capitales sur les noms d'objets.

**Mouvement** : les transitions durent 400 ms au plus et gardent l'identité des objets. Elles sont instantanées au clavier ou avec `prefers-reduced-motion`, et absentes du mur.

**États d'un objet** : nominal (gris), dégradé (cercle creux), cause racine (losange et teinte), injoignable (hachures et contour tireté), pris en charge (glyphe en contour seul), maintenance (clé et gris), perte de supervision (P2 après 3 intervalles sans donnée sur un élément de production), donnée périmée (âge en ambre), projeté (trait de construction pointillé).

## 4. Vues, poste N1, mur et métrologie

| Vue | Question d'exploitation | Forme | Refonte |
|---|---|---|---|
| Console d'événements | Que dois-je traiter, et qui s'en occupe ? | liste groupée par cause, en 3 tailles : bande 28 px, panneau 40 %, plein écran | 1 |
| Services et impacts | Quel service est touché, et par quoi ? | graphe en colonnes (usagers → socle), mode impact | 1 |
| Physique | Où est-ce, et que touche cette baie ? | 3D « Maquette & calques », LOD, bande U, épingles | 1 |
| Réseau L2 | Où est la coupure ou la saturation ? | plan de métro issu de LLDP, liens au p95 | 1 |
| Virtualisation | Le cluster tient-il N+1 ? | treemap mémoire, réserve N+1 hachurée | 2 |
| Flux | Qui parle à qui ? | matrice est-ouest et Sankey nord-sud | 2 |
| Réseau L3 et WAN | Sous-réseaux, passerelles, agences ? | schéma et carte multi-sites | 2 |
| Métrologie | Est-ce normal ? Quand sera-ce plein ? | petits multiples, plage normale, J-7, projection, disponibilité | 1 (simple), 2 (complète) |

**Poste N1 par défaut** : la console d'événements occupe 40 % et la vue Services 60 %. La touche Entrée ouvre la vue physique cadrée sur l'alarme. L'habillage se limite alors au HUD et au rail, soit 5,5 %.

**Mur d'écrans** : un rôle par écran et des plans fixes (20 s au moins, ronde suspendue tant qu'un P1 n'est pas pris en charge). Texte de 32 px au moins, lisible à 4 m. Cinq cartouches au plus par écran. Pour 4 écrans :

1. services et compteurs P1/P2 ;
2. console en grand corps ;
3. vue physique en LOD2 ;
4. métro réseau et WAN.

**Métrologie** (EXP-4, EXP-11, EXP-12) :

- **Stockage** : SQLite en WAL via `node:sqlite`, ce qui impose Node 24 LTS dans le paquet Windows. Une ligne contient une série sur une heure, en blocs compressés. On garde un fichier par palier et par mois, et la purge supprime des fichiers.
- **Paliers** : brut à 1 min sur 14 j, 15 min sur 90 j, 1 h sur 400 j (dont le p95), 1 j sur 5 ans. Le p95 se calcule sur le brut. Les trous restent visibles et ne sont jamais interpolés. Pour 2 000 VM, le tout occupe environ 12 à 15 Go.
- **Accès** : une interface `MetricStore` isole `node:sqlite` et permet de brancher une base de séries tierce chez les grands comptes.
- **Refonte 1** : brut sur 14 j et palier horaire sur 13 mois, petits multiples, comparaison à J-7.
- **Refonte 2** : plages normales (168 créneaux heure × jour), projection de saturation et rapports de disponibilité en PDF et CSV.

## 5. Feuille de route

### Refonte 1 — socle d'exploitation (lot indivisible)

Une palette silencieuse sans suppression des alarmes filles laisse passer la tempête. Un tiroir de métrologie sans stockage reste vide. Ces éléments se livrent donc ensemble.

| Volet | Éléments |
|---|---|
| Moteur et données | EXP-1 moteur d'événements persistant · EXP-2 dépendances, injoignable, cause racine · EXP-3 prise en charge et maintenances · EXP-4 séries SQLite (version réduite) · EXP-9 rôles et audit · EXP-10 supervision du superviseur · EXP-11 métriques critiques (CPU ready, discards, vitesse négociée, Go libres, perte %) · EXP-15 notifications, **seulement s'il n'y a pas de salle tenue 24/7** |
| Interface | UX-1 palette ISA-101 · UX-2 ossature 36/44/28 et lentille · UX-3 sélection et périmètre partagés, deux volets · UX-4 compteurs « non pris en charge » · UX-5 forme et couleur, tests de daltonisme · UX-6 console · UX-7 panneaux opaques · UX-9 état dans l'URL · UX-10 période globale (version simple) · UX-11 étiquettes 3D sans chevauchement · UX-12 mur |
| Rendu | DA-1 normalité silencieuse · DA-2 jetons communs · DA-3 texte net, 32 px au mur · DA-4 niveaux de détail, bande U, épingles · DA-5 rendu à la demande · DA-6 mur en plans fixes |
| Vues | Physique · Services · Réseau L2 · Console N1 |

**Ordre de travail proposé** :

1. **Socle serveur.** Passer à Node 24 LTS (paquet, `get-node.ps1`, CI), implanter `MetricStore` et SQLite à paliers, puis le journal des transitions et le moteur d'événements par contrôle.
2. **Sémantique.** Dépendances implicites (VM → hôte → ToR, LLDP) et déclarées, état « Injoignable », regroupement par cause, prise en charge et maintenances, rôles et audit, chien de garde des sources.
3. **Ossature de l'interface.** `tokens.json` et polices Plex embarquées, HUD, rail, bande, lentille, sélection, périmètre et temps partagés, état dans l'URL.
4. **Console et vue Services**, qui forment ensemble le poste N1 par défaut.
5. **Vue physique refaite.** Maquette et calques, niveaux de détail, bande U, épingles, rendu à la demande.
6. **Réseau L2** en plan de métro, **métrologie simple**, **mur**.

**Critères de sortie** :

- un incident produit une seule ligne dans la console ;
- l'interface occupe 9 % de l'écran au plus au repos ;
- 60 i/s sur GPU intégré, 30 au pire, sur la démonstration de 2 000 VM ;
- le mur se lit à 4 m ;
- les tests de daltonisme passent ;
- tout fonctionne hors ligne sous Windows.

### Refonte 2 — profondeur et métrologie

| Volet | Éléments |
|---|---|
| Moteur et données | EXP-12 plages normales, projection, comparaison · EXP-13 rapports de disponibilité · EXP-14 import Centreon, Zabbix et Alertmanager, export Prometheus · EXP-15 notifications et escalade complètes · EXP-16 calque énergie et climat |
| Interface | UX-8 palette Ctrl K, clavier intégral, aide · UX-13 thème clair « plâtre » · UX-14 relecture de la scène · UX-15 densités compacte, standard et mur |
| Rendu | DA-7 façades procédurales, LED par port (ports cartographiés seulement) · DA-9 transitions à identité persistante · DA-10 historique sur GPU · DA-11 allées, climatisation, isolignes · DA-12 frise de relecture et « comparer » · DA-13 qualité haute optionnelle |
| Vues | Virtualisation · Flux · Réseau L3 et WAN · Métrologie complète |

**Critères de sortie** :

- le rapport mensuel de disponibilité se produit sans retouche ;
- chaque volume et chaque cluster a sa projection de saturation ;
- n'importe quel incident peut être rejoué ;
- l'outil coexiste avec la supervision déjà en place.

## 6. Désaccords et arbitrages

| Sujet | Positions | Arbitrage |
|---|---|---|
| Polices | Expert : Inter et JetBrains Mono. UX et DA : IBM Plex. | **Plex**, par 2 voix contre 1. La réserve de l'expert sur la lisibilité est traitée ainsi : Condensed à 12 px minimum, et toutes les valeurs, IP et noms d'hôtes en Plex Mono, conçue pour le code (0/O et 1/l/I distincts). |
| Couleur d'interaction | Expert : cyan pour la sélection, violet pour le traçage. UX : ivoire portée par la forme, violet pour le traçage. DA : ivoire unique, violet pour le temps non réel. | **Ivoire** pour la sélection, le survol, le focus et le traçage, toujours doublée d'une forme. **Violet** pour la relecture et la comparaison. Le cyan se confond avec le haut de la rampe métrique en deutéranopie, et un daltonien voit le violet bleu. |
| Rouge critique | Expert et UX : `#FF5A47` (contraste de 5,9:1). DA : `#E5484D` (meilleur écart avec l'ambre en deutéranopie). | **`#FF5A47`** avec un losange obligatoire. À revalider lors des tests de daltonisme (UX-5). |
| Mineur | Expert : cercle creux jaune. UX : triangle ambre creux, sans troisième teinte. DA : jaune en contour seul. | **Cercle creux `#E8D44D`**. Il ne s'affiche ni au mur ni en LOD2, où ambre et jaune se confondent. |
| Poste N1 | Expert : console 40 % et Services 60 %. UX : console et scène. DA : console 60 % et plan de masse. | **Console 40 % et Services 60 %** ; Entrée ouvre la vue physique. |
| Transitions | DA : 900 ms. UX et expert : 400 ms au plus. | **400 ms au plus**, jamais au mur. |
| Texte au mur | UX : 32 px. DA : hauteur ≥ distance/200, jamais moins de 28 px. | **32 px** pour une lecture à 4 m. |
| Bande de relecture | DA : une frise en plus. UX : aucune bande permanente de plus. | La relecture **remplace** la bande d'alarmes de 28 px, en violet. |
| LED par port | DA : façades procédurales. Expert : une façade générique trompe le technicien. | Seuls les ports cartographiés s'allument, avec la mention « représentation schématique ». |
| Isolignes thermiques | DA : isolignes. Expert : interpoler entre des sondes rares invente des températures. | Sondes réelles d'abord ; interpolation seulement avec au moins une sonde pour deux baies ; couleur seulement hors de la plage ASHRAE 18–27 °C. |
| Inventaire non confirmé | Expert : un inventaire faux rend la 3D trompeuse. | Convention d'architecte « existant / projeté » : un objet déclaré mais non confirmé par un collecteur est dessiné en trait de construction. |
| Polices embarquées | UX-13 était en priorité P1 (refonte 2). | Plex est **embarquée dès la refonte 1**, puisque l'outil fonctionne hors ligne. UX-13 ne garde que le thème clair. |

## 7. Risques à surveiller

- **Dériver vers un « Centreon bis ».** Il faut tenir le positionnement : une carte vivante, une métrologie contextualisée et la corrélation.
- **`node:sqlite` évolue encore.** L'interface `MetricStore` l'isole, avec `better-sqlite3` en repli.
- **Saturation de la boucle Node par les agrégations.** Les agrégations tournent dans un `worker_thread`.
- **Disque plein.** L'installeur pose un quota et une exclusion Defender, et une alarme se lève sous 15 % d'espace libre.
- **Dérive d'horloge entre sources.** Tout est aligné en UTC, et l'âge et la source de chaque donnée sont affichés.
- **Performances sur GPU intégré.** Deux volets tiennent dans un seul contexte WebGL (`setScissor`), pour un coût d'environ 1,3× au lieu de 2×.

## 8. Maquettes

Les maquettes ont été dessinées sur le scénario de démonstration. L'hôte `esx-par-08` (baie A06) perd ses deux alimentations. Ses 5 VM deviennent injoignables : 3 sont redémarrées par HA (Portail, Bureaux à distance et Kubernetes restent dégradés, N+1 tenu), 2 ne le sont pas, ce qui interrompt le CRM et la PKI. Le cluster CL-PROD-PAR a consommé sa réserve N+1.

| Fichier | Contenu |
|---|---|
| [`01-physique-salle.jpg`](maquettes/01-physique-salle.jpg) | Salle A en maquette : rangées, allée chaude confinée, climatisation, calque des clusters, épingle de la cause racine |
| [`02-physique-gros-plan.jpg`](maquettes/02-physique-gros-plan.jpg) | Gros plan sur la rangée A : façades schématiques, cotes, cartels ancrés |
| [`03-services-impact.jpg`](maquettes/03-services-impact.jpg) | Vue Services en mode impact |
| [`04-reseau-l2-metro.jpg`](maquettes/04-reseau-l2-metro.jpg) | Réseau L2 en plan de métro, bus de VLAN, lien saturé au p95 |
| [`05-virtualisation-n1.jpg`](maquettes/05-virtualisation-n1.jpg) | Treemap mémoire, réserve N+1 hachurée |
| [`06-flux.jpg`](maquettes/06-flux.jpg) | Matrice est-ouest et Sankey nord-sud |
| [`07-metrologie.jpg`](maquettes/07-metrologie.jpg) | Petits multiples sur 7 j, plage normale, J-7, projection, carte horaire, disponibilité |
| [`08-mur-physique-lod2.jpg`](maquettes/08-mur-physique-lod2.jpg) | Écran de mur : vue physique LOD2 et cartouches |
| [`09-direction-B-cyanotype.jpg`](maquettes/09-direction-B-cyanotype.jpg), [`10-direction-C-phosphore.jpg`](maquettes/10-direction-C-phosphore.jpg) | Directions écartées |

Les écrans complets avec l'interface (HUD, rail, console N1, inspecteur, mur 2×2, système de design) sont sur la toile de conception du projet.

## 9. Comptes rendus du conseil

- [`conseil/0-dossier.md`](conseil/0-dossier.md) : le dossier remis au conseil
- Tour 1 : [expert supervision](conseil/1-expert-supervision-tour1.md) · [designer UI/UX](conseil/2-designer-uiux-tour1.md) · [directeur artistique](conseil/3-directeur-artistique-tour1.md)
- Tour 2 : [expert supervision](conseil/4-expert-supervision-tour2.md) · [designer UI/UX](conseil/5-designer-uiux-tour2.md) · [directeur artistique](conseil/6-directeur-artistique-tour2.md)
