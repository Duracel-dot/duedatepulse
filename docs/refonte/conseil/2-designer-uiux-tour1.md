# Tour 1 — Designer UI/UX (IHM de salle de contrôle)

## 1. Diagnostic de l'existant

**Emprise mesurée** (d'après `app.css`, écran 1920×1080 à 100 %) :

| Zone | Dimensions | Part |
|---|---|---|
| Barre haute | 1920×52 | 4,8 % |
| Panneau gauche (hauteur plafonnée) | 246×816 | 9,7 % |
| Bandeau alarmes | 1896×176 | 16,1 % |
| Détail droit | 380×816 | 15,0 % |
| **Total** | | **30,6 % sans sélection, 45,5 % avec** |

Le cadre de scène dégagé (`updateInsets`) ne couvre que 66 % de l'écran, 50 % avec une sélection ; sur les captures en 1600×900, 42 %. Avec la mise à l'échelle Windows à 125 %, c'est pire. En 06, les 2 000 VM tiennent dans 12 % de l'écran : le cadrage ne remplit pas l'espace libre.

**Rendement.** Le bandeau occupe 16 % de l'écran pour une seule ligne utile (01, 02, 05) ou pour « Aucune alarme active » (04, 07). Avec 282 alarmes (06), il en montre trois. Le panneau gauche affiche en permanence des réglages rarement touchés (écartement, économie d'énergie, rotation). La **légende**, seul élément indispensable, est sous le pli : on ne la voit sur aucune des 7 captures.

**Hiérarchie : l'inverse d'ISA-101.**
- C'est l'état normal qui crie. Voyants et plateaux verts saturés, faisceaux cyan des câbles peu chargés dominent 01, 05 et 07. En 06, les 109 VM critiques se noient dans le vert.
- **Collisions de teintes.** #38bdf8 sert à la fois d'accent d'interface, de sélection, de flux Web, de câble peu chargé et d'étiquette de cluster. Le rose marque la réplication *et* le tracé de chemin. L'orange « stockage » et l'ambre « avertissement » ont un rapport de luminance de 1,05 : en 03, les flux STOR-PAR ressemblent à des avertissements. Le dégradé thermique arc-en-ciel place le vert au milieu, donc 55 % se lit « OK ».
- **Daltonisme.** Le rapport de luminance vaut 1,06 entre ambre et vert, 1,65 entre rouge et vert. La sévérité ne tient qu'à la teinte de pastilles de 8 px, ce qui exclut environ 8 % des hommes.
- **Confiance.** En 01, la barre haute affiche « 0 critiques » alors que le bandeau montre une alarme *Critique* sur un lien : les pastilles comptent des entités, pas des alarmes. La pastille « 208 OK » attire l'œil sans rien apprendre à l'opérateur.
- **Étiquettes.** Chevauchements non gérés (« Agence Lille/Marseille/Nantes » en 05 et 07), corps de 9,5 à 10 px, suffixe « .corp.local » répété partout. `--dim` n'atteint que 3,2:1, sous le seuil WCAG AA.
- **Mouvement.** La pastille et les liens critiques pulsent même acquittés. En kiosque, la caméra tourne et vole d'une alarme à l'autre toutes les 12 s.

**Affordances et états.** « Vues » désigne en fait des *cadrages caméra* ; les pastilles de santé ne sont pas cliquables. Couches et lignes d'alarme sont inaccessibles au clavier, sans aucun `:focus-visible`. L'acquittement se fait en un clic, sans commentaire, regroupement ni localisation. Pas d'état maintenance ni « donnée périmée » : un objet dont le collecteur est en échec reste vert. `#sel=` passe par `replaceState`, donc Précédent ne marche pas. Enfin, `backdrop-filter: blur` au-dessus d'un WebGL à 60 i/s coûte cher sur GPU intégré.

**À garder** : le fil d'Ariane, le tracé de chemin port par port (remarquable), l'infobulle compacte, la recherche par « / » et les chiffres tabulaires.

## 2. Architecture de l'information et navigation

**Un seul modèle, plusieurs lentilles.** Trois notions distinctes sont partagées par toutes les vues :
- **Périmètre** : là où je regarde (Paris › DC1 › Salle A, ou « Service ERP »). Fil d'Ariane dans le HUD ; il filtre toutes les vues.
- **Sélection** : un ensemble d'objets épinglés (Maj+clic pour en ajouter). Elle alimente l'inspecteur et la métrologie.
- **Survol** : une surbrillance passagère reprise dans toutes les vues ouvertes.

**Niveaux ISA-101** : N1 synthèse (géographie, santé des services), N2 zone (salle, cluster, domaine réseau), N3 objet (baie, hôte, commutateur), N4 diagnostic (métrologie, ports, journal). Le **zoom sémantique** fait passer de N1 à N3 dans une même vue (la molette ou Entrée restreint le périmètre). Le N4 passe toujours par l'inspecteur et le tiroir de métrologie.

**Rail de vues** vertical plutôt que des onglets, qui coûtent une ligne : Physique, Virtualisation, Réseau L2/L3, Flux et dépendances, Services, Alarmes, Métrologie (séquences G puis P/V/R/F/S/A/M).

**Vues coordonnées** : Ctrl+\ partage l'écran en deux volets (60/40) qui partagent la même sélection, typiquement *Physique | Flux*. Pas plus de deux scènes par poste, pour la charge cognitive comme pour le GPU ; le mur d'écrans fait le reste.

**Historique** : `pushState` à chaque changement de vue, de périmètre ou de sélection. Alt+← / Alt+→ et les boutons 4 et 5 de la souris naviguent ; Ctrl+E rouvre les 10 derniers objets.

**Liens profonds** lisibles : `#v=phys|flux&p=site:paris/salle:a&s=vm:app-portail-01&t=now-24h..now&c=<caméra>`. Ctrl+Maj+C copie le lien pour le ticket.

**Espaces de travail** : un état nommé (vues, découpe, périmètre, couches, coloration, période, signets de caméra, densité), personnel ou partagé (« N1 Paris », « Mur – écran 2 »). Stockage en JSON dans `config/`, sans base de données. Le kiosque s'ouvre par `?ws=mur-ecran-2`.

## 3. Réduire l'emprise : cibles chiffrées

```
┌─ HUD 36 px ──────────────────────────────────────────────────────────────┐
│◇ Paris › DC1 › Salle A   ◆1 ▲2 ⧖1   [Temps réel ▾]   Ctrl+K   ● 14:32:05 │
├──┬───────────────────────────────────────────────────────┬───────────────┤
│R │                                                       │ Fiche 320×170 │
│a │               SCÈNE ≥ 88 %                            │ (→ inspecteur │
│i │                                                       │    400 px)    │
│l │ [lentille : couches · colorer par · légende] 440×32   └───────────────┤
├──┴───────────────────────────────────────────────────────────────────────┤
│◆ CRIT 00:03:12  ESX-LYO-01 ↔ TOR-L04-1  Interface down · +4    [A]  28 px │
└──────────────────────────────────────────────────────────────────────────┘
```

| État | Éléments affichés | Interface | Scène |
|---|---|---|---|
| Repos | HUD 36 px (3,3 %), rail 44 px (2,2 %), bande d'alarmes 28 px (2,5 %), lentille 440×32 (0,7 %) | **8,8 %** | **91 %** |
| Sélection | + fiche d'aperçu 320×168 | 11,4 % | 89 % |
| Inspection | + inspecteur complet 400 px | 28 % | 72 % |
| Plein visuel (H) | bande d'alarmes seule | 2,6 % | 97 % |

- **Palette Ctrl+K** (640 px, absente au repos) : objets, vues, espaces de travail et commandes (« colorer par température », « acquitter la sélection », « comparer à J-7 »), raccourci affiché en regard. Elle remplace la recherche et le bloc Options.
- **Lentille flottante** : couches en icônes avec compteurs, mode de coloration, **légende toujours visible** de l'encodage actif. Elle passe à 30 % d'opacité après 5 s d'inactivité.
- **Tiroirs à la demande** : Alarmes (A, 40 % de la hauteur, épinglable), Métrologie (M, 300 px), Affichage (réglages rares).
- **Règles.** Panneaux opaques à 94 %, sans flou. Marges de caméra recalculées et cadrage qui remplit l'espace libre (ce qui corrige 06). Aucun panneau ne s'ouvre sans action de l'utilisateur, sauf la bande d'alarmes, toujours visible.
- **Densité** via `--density` : compact (lignes de 24 px, texte de 12), standard (28/13), mur (44/24).

## 4. Parcours opérateur

1. **Triage.** Une nouvelle alarme non acquittée fait clignoter la bande basse à 1 Hz pendant 3 s, puis la bande reste fixe ; une balise apparaît dans la scène. A ouvre le tiroir sur l'alarme la plus prioritaire ; J/K pour se déplacer. Les alarmes sont **regroupées par cause probable** grâce à la topologie connue : un lien tombé regroupe les VM qu'il rend injoignables. Colonnes : priorité (icône et forme), état, durée, objet, localisation, message, occurrences.
2. **Diagnostic.** Entrée amène la caméra sur l'objet et ouvre sa fiche. D affiche *Physique | Dépendances* : en amont l'hôte, le serveur, le ToR, le cœur et l'alimentation ; en aval les VM, services et flux touchés. Tout le reste est grisé. Le tracé de chemin devient une action de la fiche.
3. **Métrologie.** M ouvre le tiroir sur la sélection, avec la période globale et « comparer à J-7 » en surimpression. Maj+clic ajoute un objet aux courbes.
4. **Action.** Maj+A acquitte avec commentaire (Ctrl+Entrée pour valider ; commentaire obligatoire sur les critiques si configuré). S'y ajoutent l'acquittement groupé, la mise en maintenance (fenêtre avec heure de fin, objet hachuré, alarmes suspendues) et un **journal horodaté par objet**. Échap remonte d'un niveau, et le parcours entier se fait sans souris.

**Mur d'écrans.** Un espace de travail en kiosque par écran : synthèse géographique et services, salle physique de DC1, tableau d'alarmes, indicateurs clés en petits multiples.
- **Caméra fixe**, sans rotation ni vol automatique. Les alarmes apparaissent en **cartouches reliés à leur objet par un trait**, 5 au plus.
- **Lisibilité** à 3–4 m sur un 55" en 1080p : texte d'au moins 28 px, chiffres clés d'au moins 56 px.
- **Données figées** : si le SSE ou un collecteur critique décroche, un bandeau hachuré « Données figées depuis 14:32 » s'affiche.
- **« Envoyer au mur »** pousse l'état du poste vers un écran, qui revient à son espace d'origine après 10 min.

## 5. Métrologie intégrée, sans refaire Grafana

- **Période globale** dans le HUD (Temps réel, 1 h, 24 h, 7 j, 30 j, personnalisée ; Maj+←/→ décale la fenêtre). Toutes les vues suivent cette période, et la coloration devient l'agrégat de la période (moyenne, p95 ou max).
- **Relecture** : un curseur temporel fait rejouer à la scène l'état passé. Un cadre ambre et la mention « RELECTURE 12/09 03:14 » évitent toute confusion avec le direct. C'est notre différence avec Grafana : le graphe pilote la scène, la scène pilote le graphe.
- **Tiroir de métrologie** : petits multiples (une ligne par objet, une colonne par métrique, 4 séries superposées au plus, distinguées aussi par le motif du trait) sur un axe de temps commun. Le réticule est synchronisé et recolore la scène à l'instant survolé. La **plage normale** (p10–p90 des 4 dernières semaines) est en gris, les seuils en tirets fins ; seul le dépassement est coloré.
- **Onglet Tendance** de l'inspecteur : heatmap calendaire jour × heure (p95 sur 12 semaines), projection de saturation, matrice hôtes × heures pour un cluster.
- **Pas d'éditeur de tableaux de bord libre en v1** : les tableaux sont des espaces de travail, et chaque graphe reste lié au contexte. Cela suppose une rétention longue ; je soutiens une base embarquée.

## 6. Système de design

- **Grille** : unité de 4 px ; espacements 4/8/12/16/24 ; largeurs 320/400/560.
- **Typographie** : WOFF2 embarqués, servis localement (licence OFL). **Inter** variable (`tnum`, zéro barré) pour l'interface, **JetBrains Mono** en sous-ensemble latin pour identifiants, IP et ports, Segoe UI en repli : rendu identique de Windows 10 à 11. Échelle 11/12/13/15/18/24, doublée pour le mur. Étiquettes 3D : 12 px minimum, suffixe commun élagué, niveau de détail selon la distance, anti-chevauchement, 60 visibles au plus.
- **Palette ISA-101** : fond gris-bleu #12161C (pas de noir pur). Objets normaux en 4 niveaux de gris-bleu ; **l'état OK n'a pas de couleur**. Réservé aux anomalies : critique en rouge #E5484D avec un losange ; majeur en ambre #F5A524 avec un triangle ; mineur en jaune #E8D44D avec un cercle. Une donnée inconnue ou périmée se signale par des hachures et un contour pointillé, sans teinte. La maintenance est hachurée bleu-gris avec une clé.
- **Interaction** (sélection, focus, tracé) : un seul cyan, #4CC9F0, jamais utilisé pour un statut.
- **Catégories de flux** : 6 teintes froides désaturées doublées d'un motif ; pas de rouge, d'orange ni de jaune.
- **Métriques** : échelle séquentielle monochrome (type cividis) jusqu'au seuil, puis ambre ou rouge. Fin de l'arc-en-ciel.
- **Mouvement** : seul l'état non acquitté clignote (1 Hz) ; `prefers-reduced-motion` coupe particules et pulsations.
- **Thèmes** : sombre (salle obscure, mur) et clair gris ISA #D9DCE0 (salle éclairée). Un même `tokens.json` alimente le CSS et la scène 3D.
- **Accessibilité** : contraste AA (4,5:1 minimum). Clavier complet : tabindex itinérant, `role=grid` pour les alarmes, `role=switch` pour les couches, anneau `:focus-visible` cyan de 2 px. `aria-live` réservé aux nouvelles alarmes critiques. Aide sous « ? ». Tests en simulation de deutéranopie et de protanopie : forme et texte doublent toujours la couleur.

## Recommandations numérotées

| # | Recommandation | Priorité | Justification |
|---|---|---|---|
| UX-1 | Palette ISA-101 : normal en gris, couleurs vives réservées aux anomalies, une seule teinte d'interaction | P0 | Le vert et le cyan normaux écrasent les anomalies (06) |
| UX-2 | Ossature : HUD 36, rail 44, bande d'alarmes 28, lentille flottante | P0 | Interface ramenée de 30–45 % à moins de 9 % au repos |
| UX-3 | Périmètre, sélection et survol partagés ; rail de vues ; deux volets coordonnés | P0 | Condition des vues multiples |
| UX-4 | Compteurs du HUD = alarmes non acquittées par priorité, cliquables | P0 | « 0 critique » affiché pendant une alarme critique |
| UX-5 | Sévérité doublée par une forme, tests de daltonisme | P0 | Ambre et vert ne diffèrent que de 1,06 en luminance |
| UX-6 | Tiroir d'alarmes : regroupement par cause, localisation, acquittement avec commentaire ou groupé, maintenance, journal | P0 | Triage impossible avec 3 lignes visibles |
| UX-7 | Retirer `backdrop-filter`, panneaux opaques | P0 | Gain immédiat sur GPU intégré |
| UX-8 | Palette Ctrl+K, clavier complet, aide « ? » | P1 | Rien à l'écran au repos, gain de vitesse pour les N2 |
| UX-9 | État complet dans l'URL, `pushState`, espaces de travail en JSON | P1 | Liens de ticket, retour arrière, mur configurable |
| UX-10 | Période globale ; tiroir de petits multiples, plage normale, réticule lié à la scène | P1 | Métrologie contextuelle, pas un Grafana bis |
| UX-11 | Étiquettes 3D : anti-chevauchement, suffixe élagué, niveau de détail, 12 px minimum | P1 | Chevauchements en 01, 05 et 07 |
| UX-12 | Mur : un espace par écran, caméra fixe, cartouches, texte ≥ 28 px, bandeau « Données figées » | P1 | Lisible à 4 m, confiance dans les données |
| UX-13 | Polices embarquées, jetons communs CSS/3D, thème clair | P1 | Hors ligne, rendu déterministe, salle éclairée |
| UX-14 | Relecture temporelle de la scène | P2 | Différenciateur fort ; demande la base de séries |
| UX-15 | Densité compact/standard/mur | P2 | Un seul code pour le poste et le mur |
