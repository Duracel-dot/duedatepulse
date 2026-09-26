# Conseil de production, tour 2 : expert production applicative

## 1. Accords

- Un canal = un sens, figé dans `tokens.json` et testé.
- La hauteur porte la strate, jamais une mesure ; ni particules ni animation permanente.
- Seule la cause racine est rouge : conséquences d'infrastructure hachurées (injoignable), chaque service à la teinte de son SLI mesuré.
- La caméra du mur ne bouge jamais ; aucune rotation automatique.
- Une scène calme parce qu'aveugle est le pire mensonge : je retiens 30 s de moteur muet (système) au lieu de mes 90 s.

## 2. Votes

**C1. Changement en cours.**
Choix : statique ; la clé (pleine si déclaré, en contour hors fenêtre), avec l'avancement par instance sur poste. J'abandonne l'échafaudage.
Justification : un déploiement dure des heures ; un défilement aussi long use le mouvement, et la clé est déjà au vocabulaire.

**C2. Redondance.**
Choix : double filet ou tracé doublé sur toutes les strates, services compris ; j'abandonne l'inclinaison.
Justification : un seul signe du sol aux services, lisible en gris ; l'inclinaison se confond avec la perspective. Un service sans réserve reste hors du compteur « dégradés ».

**C3. Luminance.**
Choix : marge consommée, rampe bleue à deux paliers ; charge p95 d'un lien et budget d'erreur consommé en sont des cas.
Justification : trois propositions, un concept. Le débit métier bas devient une alarme P2 (sous 60 % de la normale 10 min).

**C4. Rythmes.**
Choix : trois au plus : clignotement 1 Hz (P1), défilement directionnel 0,5 Hz (trafic hors régime, liens), respiration 0,2 Hz (budget ≥ 6×, services). Chacun cesse à la prise en charge ou après 10 min.
Justification : clignoter, glisser et respirer ne se confondent pas ; l'expiration et un plafond de 5 % de l'écran en mouvement contiennent l'accoutumance.

**C5. Minimum ancré.**
Choix : un cartouche d'architecte fixe dans un coin (heure, âge des données, P1 et P2 non pris), sans fond ni bouton, 2 % de l'écran au plus. Au mur, gravé au sol, la caméra étant fixe.
Justification : la vérité des données ne peut dépendre de l'endroit où regarde la caméra ; la direction artistique a déjà adopté le cartouche.

**C6. Caméra sur poste.**
Choix : Entrée à tout moment ; sinon recadrage après 60 s sans manipulation, une fois par nouvelle cause P1, 400 ms sans rotation, jamais pendant une sélection.
Justification : strates, tiroir et traçage satisfont déjà le « visuel qui se meut » ; un N1 qui lit un cartel reste souvent 30 s immobile.

**C7. Mode tempête.**
Choix : plus de 3 nouvelles causes en 60 s (rythme) **ou** plus de 7 causes ouvertes (stock) ; conséquences retenues 15 s, jamais la cause.
Justification : les deux seuils mesurent deux choses ; la rétention couvre la convergence sans gêner un SLI calculé sur 5 min.

**C8. Retour au calme.**
Choix : strates refermées 5 min après le dernier P1 ; cicatrice de 30 min.
Justification : 30 s ferait battre la scène ; les rechutes applicatives (reprises en masse, cache froid, files en rattrapage) tombent entre 15 et 30 min.

**C9. Estompage.**
Choix : − 30 % de luminance au plus, objets nominaux seulement, sur focus demandé ; jamais au mur, sur un objet en alarme ni par transparence.
Justification : s04 montre que le traçage ivoire se perd sans lui ; la transparence empile les strates et coûte au GPU.

**C10. Fraîcheur.**
Choix : hachure.
Justification : un voile se confond avec l'estompage et le voile bleu de marge ; la hachure est déjà décidée et achromatique.

## 3. Critique du rendu actuel

- **Garder** : l'écartement des strates, la colonne comme localisateur, le totem dans la salle, la règle au sol.
- **Changer** : le faisceau rouge du sol au ciel et l'éventail de lignes rouges. Tracer en ivoire fin le chemin réel ; le rouge reste sur la cause.
- **Changer** : la strate SERVICES, qui porte l'impact usager, est minuscule et illisible. Plaques de 60 px au moins, cartel formulé en usagers.
- **Enlever** : les cartels superposés de s04 et « Prendre en charge » sur CRM, simple conséquence : on prend en charge la cause. Lignes de rappel à l'encre.
- **Changer** : le totem incliné, au texte d'environ 6 px : face caméra, 5 lignes, 32 px au mur. Repères de la règle à l'encre : l'ambre y imite une alarme active.

## 4. Table finale canal → sens

| Canal | Sens unique |
|---|---|
| Hauteur | strate (niveau d'abstraction) |
| Teinte + forme | sévérité ; ivoire = interaction et traçage ; violet = temps non réel |
| Clignotement 1 Hz synchronisé | cause P1 non prise en charge |
| Mouvement lent (≤ 0,5 Hz, 10 min au plus) | régime anormal en cours : défilement sur les liens, respiration sur les services |
| Luminance (rampe bleue, 2 paliers) | marge consommée : capacité, thermique, charge p95, budget d'erreur, âge des files |
| Double filet ou tracé doublé | redondance ; trait simple de 3 px = perdue |
| Hachure | inconnu : périmé, injoignable, perte de supervision |
| Clé | changement en cours (pleine : déclaré ; contour : hors fenêtre) |

L'épaisseur reste une propriété du dessin (capacité nominale des liens), jamais un état.
