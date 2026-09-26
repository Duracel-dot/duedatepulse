# Tour 1 — Directeur artistique 3D & data-visualisation

## 1. Critique franche de la v0.1

**Ce qui fait « démo générique néon ».** Fond bleu-noir, grille « Tron » + brouillard, baies en verre à 32 % cerclées de filaire, icosaèdres filaires qui tournent, arcs additifs aux 9 couleurs arc-en-ciel : le vocabulaire de toutes les démos WebGL « cyber ». Et il dessert la supervision :

- **Le vert hurle.** 208 éléments OK sur 213 : le #22c55e saturé couvre plateaux, VM et plaques ; la normalité est la couleur la plus bruyante. Capture 6 : 109 critiques réduits à des points rouges dans un tapis vert. La rampe de chaleur passe par ce même vert à 55 % CPU : « vert » veut dire deux choses.
- **Couleurs surchargées** : le cyan désigne câbles, îlots, clusters, flux web et WAN.
- **Profondeur illisible** : baies transparentes, donc aucune occlusion ; en vue d'allée (capture 3), un magma bleu où les équipements sont des traits verts. Le faisceau de câbles cyan (captures 1, 5) domine alors qu'il est le moins informatif.
- **Additif = blanc** : là où les flux se croisent, tout sature ; le « chevelu » ne se lit pas.
- **Texte** : étiquettes DOM de 10–11 px, « .corp.local » répété, collisions (« Agence Lille/Marseille »).
- **Surface** : panneau de détail ouvert, la scène n'a que ~42 % des pixels (930 × 658 sur 1600 × 900). Objectif DA : ≥ 85 % au repos (à trancher avec le designer UI).

**Au mur (3–6 m).** Hauteur de caractère ≥ distance/200, soit ≈ 32 px à 4 m sur un 55" 1080p : aucune étiquette ne passe. Un équipement 1U fait 2–3 px à l'échelle d'une salle : son alarme est invisible, sauf la colonne lumineuse (bonne idée, trop timide). La rotation continue interdit toute lecture.

**Ce qui fonctionne et doit rester** : positions U réelles ; la métaphore des **strates** (physique au sol, virtuel au-dessus) ; le **traçage de chemin** (capture 2 : seul moment parfaitement lisible, parce que tout le reste s'éteint, preuve qu'« éteindre le normal » marche) ; l'isolation ; le cadrage dans la zone libre ; l'instanciation.

## 2. Direction artistique

Principe commun non négociable, repris des IHM de conduite (ISA-101) : **la normalité est silencieuse**. OK = aucune couleur ; la couleur est réservée aux écarts, à la sélection et aux mesures demandées.

### Piste A — « Maquette & calques » (recommandée)
Le physique est une **maquette d'architecte en graphite mat**, coupée à 1,40 m comme un plan de niveau ; le logique est dessiné à l'encre sur des **calques** posés au-dessus, qu'on soulève et déplie en plans 2D. La couche virtuelle devient un calque flottant (VM en carrés d'encre).

- **Palette** : vide #0B0C0E ; sol #16181B (joints #1F2226) ; matière #2B2F34, arêtes éclairées #3A3F46 ; poché des murs coupés #050506, trait de coupe #8D949C ; encre #7D8791, encre claire (texte) #DDE1E5 ; calque #C9D3DC à 7 % ; sélection ivoire #F5F1E8 ; traçage violet #B78CFF ; mesures en rampe « bleu instrument » #1C2A3A → #2F5F8F → #6FA3D6 → #CFE4F7 ; avertissement #F2A33A ; critique #FF5A47.
- **Matières** : plâtre/graphite (roughness 0,9, metalness 0) ; seuls LED et afficheurs émettent.
- **Lumière** : lumière de maquette, clé 5200 K à 35°, remplissage froid faible, occlusion précalculée. **La sélection s'éclaire** (tache de lumière ivoire projetée) au lieu d'une boîte filaire.
- **Typographie** : IBM Plex Sans Condensed (lettrage de plan), IBM Plex Mono à chiffres tabulaires (valeurs)  (OFL, servies localement) ; capitales espacées façon cartouche.
- **États et alarmes** : critique = l'équipement s'allume de l'intérieur (émissif à travers la porte perforée) + **épingle** de taille écran constante au-dessus de la baie ; clignotement 1 Hz seulement si non acquitté, fixe ensuite ; avertissement = ambre fixe ; inconnu = **hachures** (convention du plan : « non relevé ») ; arrêté = matière assombrie, contour pointillé. Couleur toujours doublée d'une forme ou d'un motif (daltonisme).
- **Signature** : une maquette monochrome où la seule couleur est une anomalie, des murs en poché, des calques translucides. Aucun outil de supervision ne ressemble à ça.

### Piste B — « Cyanotype » (blueprint technique)
Tout en trait, isométrie, sans lumière. Fond bleu de Prusse #0F2A44, grille #1A3A5A, trait #E6EEF5, trait secondaire #7FA3C4, alertes #FFB84D / #FF6B5B. Métriques en **cotes** (lignes de cote chiffrées), Plex Mono en capitales. Pour : très légère, naturellement 2D. Contre : cliché, peu de profondeur, rouge médiocre sur bleu, fatigue en 3×8.

### Piste C — « Phosphore » (instrument de mesure)
Verre fumé #0E1410 sur #060807, réticule gradué #1B2A22, traces #9BE8B5, valeurs #E8FFF0, **rémanence** = historique. Identité métrologique forte, mais le vert contredit la sémantique d'état, exige du bloom et vire au rétro-gadget.

**Recommandation** : A, en empruntant à B le « trait » des vues logiques (les plans de la maquette) et à C la rémanence pour l'historique.

## 3. Vue physique : niveau de détail élevé

**Façades procédurales.** Gabarits indexés par (type, constructeur, modèle, hauteur U), vendor/model étant déjà collectés : serveurs 1U/2U à baies de disques, commutateur 48 SFP + 6 QSFP, stockage à tiroirs, onduleur à afficheur, pare-feu à LCD. Chaque gabarit est dessiné au démarrage sur canvas dans un **atlas** 2048² (albédo, masque émissif, normale de gravure) : pas de build. Une **DataTexture d'états** (un texel par port) est lue par le shader : la LED du port Eth1/49 reflète le vrai lien LLDP (vert discret, ambre si erreurs, éteinte si down). Arrière : deux alimentations, PDU 0U sur les montants.

**Baies et salle** : portes perforées en *alpha-test* (pas de transparence triée), passe-câbles à brosse, plinthe ; **chemins de câbles** grillagés au-dessus, goulotte fibre ; torons par chemin (épaisseur ∝ nombre), dépliés en câbles de près. Dalles 600 mm, dalles perforées côté froid, confinement d'allée (portes, toit), armoires de climatisation en périphérie, **coupe du faux plancher** optionnelle montrant le plénum.

**LOD selon la taille à l'écran** (adapté au 4K), avec hystérésis et fondu tramé :
- **LOD0** (équipement > 40 px) : façade complète, LED par port, câbles individuels, sélection au port.
- **LOD1** (8–40 px) : façade simplifiée, une LED par équipement, torons.
- **LOD2** (< 8 px par U) : la baie devient un bloc portant une **bande U** de 42 texels, colorés seulement en anomalie : code-barres d'état lisible à 5 m ; les VM d'un hôte s'agrègent en barre d'états.
- **LOD3** (multi-sites) : salles en dalles, anomalies en épingles avec compteur.

| Budget | Poste iGPU 1080p, 60 i/s | Mur 4K, 30 i/s |
|---|---|---|
| Draw calls | ≤ 120 | ≤ 150 |
| Triangles visibles | ≤ 800 k | ≤ 1,5 M |
| Textures (VRAM) | ≤ 96 Mo | ≤ 160 Mo |
| JS par image | ≤ 4 ms | ≤ 8 ms |
| Résolution interne | DPR plafonné à 1,25 | dynamique 0,7–1,0 |

Plus : **rendu à la demande** (aucune image si rien ne bouge), niveau de qualité automatique (UNMASKED_RENDERER + mesure des trois premières secondes).

## 4. Vues logiques : une grammaire par vue

Règle : **3D pour ce qui a une géométrie réelle** (salles, baies, câbles, thermique, trajet physique d'un flux) ; **2D orthographique pour les graphes**, où la perspective n'ajoute qu'occlusion. Même canevas, même encre, un type = une silhouette partout (serveur = rectangle rayé en U, commutateur = rectangle à pointillés de ports, VM = carré, conteneur = hexagone, externe = cercle à encoche).

- **Réseau L2/L3, « plan de métro »** : couches Internet/WAN → pare-feu → cœur → ToR → serveurs, tracés orthogonaux, épaisseur = débit nominal, couleur seulement au-delà du seuil ; chaque **VLAN/VRF est une ligne de métro** qui longe les liens ; domaines L3 en aplats de calque. Placement elkjs en Web Worker, vendorisé (licence EPL-2.0 à valider).
- **Services, « schéma de principe »** : graphe orienté gauche → droite (utilisateurs → frontaux → applis → BDD → stockage), nœuds = services agrégeant leurs VM, arêtes = flux NetFlow (épaisseur log du débit, couleur = latence hors seuil). Mode **impact** : un serveur en panne allume tout l'aval.
- **Virtualisation, treemap** cluster → hôte → VM : surface = ressource allouée, remplissage = usage, **réserve N+1 hachurée** (la capacité qu'on n'a pas le droit de consommer).
- **Flux** : **matrice** applications × applications (échelle log, triée par blocs) pour l'est-ouest, **sankey** pour le nord-sud (Internet → pare-feu → LB → applis → BDD). Pas de diagramme en cordes. Les arcs 3D ne servent plus qu'au traçage.

**Transitions, « le calque se soulève »** : chaque entité est un jeton persistant ; changer de vue fait **glisser le même objet** de sa position U vers sa station ou sa case (900 ms, échelonné par niveau, interruptible). La caméra fait un travelling compensé (FOV qui se ferme pendant qu'elle recule) puis bascule en orthographique sans saut. La maquette reste en fond de plan à 10 % ; la sélection ivoire suit l'objet. `prefers-reduced-motion` : fondu enchaîné.

## 5. Métrologie dans la scène

- **Texture d'historique** : une ligne par (entité, métrique), 360 colonnes (1 h à 10 s), une colonne écrite par tic : toutes les sparklines en un seul appel de dessin.
- **Cartels** ancrés (nom, 1–2 sparklines, valeur) pour la sélection, les épinglés et les anomalies seulement : 12 au plus.
- **Jauges à rémanence** au flanc des baies (puissance, T° d'entrée) : remplissage = maintenant, trait fantôme = max 24 h, encoche = seuil.
- **Ombres temporelles** : une VM migrée laisse un fantôme pointillé sur l'ancien hôte pendant 15 min.
- **Sol thermique en isolignes** (pas 1 °C, cotées tous les 2 °C), interpolées sur GPU depuis les sondes : plus lisible qu'un aplat arc-en-ciel.
- **Relecture** : bande temporelle de 28 px (code-barres des alarmes + curseur) ; la scène entière est fonction de t ; mode **comparer à t–1 h / t–24 h** ne montrant que les changements. Suppose un stockage de séries (à arbitrer avec l'expert métrologie).
- À proscrire : barres 3D et jauges sur chaque objet.

## 6. Techniques de rendu (three.js r186)

- **WebGLRenderer** conservé (WebGPU plus tard). **NeutralToneMapping** au lieu d'ACES, qui décale les teintes d'état.
- **Éclairage** : directionnelle + hémisphérique + RoomEnvironment en PMREM (procédural, hors-ligne). Pas d'ombres temps réel : ombres de contact en décalque, AO dans l'atlas, carte d'ombre recalculée seulement au changement de disposition.
- **Matériaux** : MeshStandardMaterial mat, variantes via onBeforeCompile (hachures, perforation tramée, émissif d'alarme) ; MeshLambertMaterial pour le niveau économe. Zéro transparence triée.
- **Instanciation** : InstancedMesh partout, BatchedMesh pour les châssis hétérogènes. Aujourd'hui buildCables crée un Line2 et un LineMaterial **par lien** : fusionner en un LineSegments2 à couleur par sommet.
- **Flux** : FlowLayer.update recalcule chaque particule sur le CPU à chaque image ; animer dans le vertex shader (attribut t + uniforme temps), mélange normal, « comètes » en tirets.
- **Texte** : remplacer CSS2DRenderer par du **SDF/MSDF instancié** (troika-three-text avec police locale, ou atlas MSDF pré-généré et versionné), évitement des collisions, noms courts (FQDN au survol), échelle kiosque.
- **Post-traitement** : aucun par défaut. En qualité haute : GTAO demi-résolution accumulé caméra immobile. Halos d'alarme par sprites plutôt que bloom plein écran ; contour de sélection par coque inversée plutôt qu'OutlinePass.
- **À éviter** : bloom global, additif, filaire, profondeur de champ, aberration chromatique. Au mur : **plans fixes** enchaînés (ronde de vidéosurveillance), cadrage d'office des nouvelles alarmes.

## Recommandations numérotées

| N° | Recommandation | Priorité | Justification |
|---|---|---|---|
| DA-1 | Normalité silencieuse : OK sans couleur, tone mapping neutre | P0 | 109 critiques invisibles (capture 6) ; ISA-101 |
| DA-2 | « Maquette & calques » + jetons couleur/typo uniques partagés CSS/three | P0 | Identité unique, cohérence 2D/3D |
| DA-3 | Texte SDF instancié, déclutter, échelle kiosque (≥ 32 px au mur) | P0 | Étiquettes illisibles et en collision |
| DA-4 | LOD par taille écran, bande U d'état, épingles | P0 | Alarme d'équipement lisible à 5 m |
| DA-5 | Câbles fusionnés, flux animés sur GPU, rendu à la demande, niveau auto | P0 | 60/30 i/s sur iGPU |
| DA-6 | Mur : plans fixes enchaînés au lieu de la rotation continue | P0 | Illisible en mouvement permanent |
| DA-7 | Façades procédurales (atlas canvas) + LED par port pilotées par LLDP | P1 | Détail demandé, au service de la donnée |
| DA-8 | Vues logiques 2D : métro, services, treemap N+1, matrice/sankey | P1 | Une grammaire par question |
| DA-9 | Transitions à identité persistante + travelling perspective → ortho | P1 | Ne jamais perdre le fil |
| DA-10 | Texture d'historique GPU : cartels, sparklines, jauges à rémanence | P1 | Métrologie sans surcharge |
| DA-11 | Allées confinées, climatisation, isolignes thermiques | P1 | Physique et thermique crédibles |
| DA-12 | Timeline de relecture + mode « comparer » | P2 | Dépend du stockage de séries |
| DA-13 | Qualité haute optionnelle : GTAO accumulé, halos sprites | P2 | Beauté sans pénaliser les iGPU |
