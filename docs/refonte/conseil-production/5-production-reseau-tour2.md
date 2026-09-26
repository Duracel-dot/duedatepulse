# Conseil de production · tour 2 · expert production réseau

## 1. Accords

- **Un canal = un sens**, fixé dans `tokens.json`. La hauteur porte la strate, jamais une mesure.
- **L'état global, c'est la marge** : redondance en capacité, N+1, dette de redondance.
- **Seule la cause racine est rouge.** Aucun objet en alarme n'est estompé, et la caméra du mur reste fixe.
- **Une scène calme parce qu'aveugle ment** : moteur muet 30 s ⇒ toute la salle hachurée, heure arrêtée.
- **Aucune particule, aucun mouvement de routine.**

## 2. Votes

**C1. Changement.** L'échafaudage statique ; la clé reste à la maintenance planifiée.
Un changement dure de 30 à 60 min : c'est un état, pas un mouvement. Je retire ma clé.

**C2. Redondance.** Double trait partout (lien, pied d'objet, socle de service, plinthe), sans inclinaison.
Un sens n'a qu'un canal, et en vue isométrique 5° ne se lisent pas à 4 m.

**C3. Luminance.** La marge consommée : la charge p95 d'un lien en est un cas, comme les jours avant saturation, la température ou le budget d'erreur.
Assombrir un débit bas inverse le canal ; un débit effondré est une alarme (P2 s'il est nul).

**C4. Rythmes.** Deux rythmes : clignotement P1 à 1 Hz, défilement à 0,5 Hz sur les liens portant du trafic dévié (10 min au plus).
La respiration modulerait la luminance, déjà prise ; le budget d'erreur est une marge.

**C5. Ancrage.** Une ligne de texte en bas à gauche, sans cadre ni fond, en 28 px (32 au mur) : heure, âge des données, P1 et P2 non pris.
C'est la légende d'un plan d'architecte ; une caméra qui bouge peut perdre le totem de vue.

**C6. Caméra.** Recadrage automatique après 30 s sans manipulation, à la naissance d'une cause P1 : recul de 400 ms, sans rotation, sur la salle et toutes les causes P1 ; Entrée pour le forcer, Échap pour revenir.
Le client le demande, et un recul qui englobe la salle ne désoriente pas.

**C7. Tempête.** Au-delà de 3 nouvelles causes en 60 s, animations suspendues et cartel « cause commune probable » ; au-delà de 7, agrégation par rangée. Conséquences retenues 15 s, racine immédiate.
Trois pannes indépendantes en une minute sont rarissimes ; 15 s couvrent la convergence BFD, OSPF et vPC.

**C8. Calme.** Strates refermées 5 min après la dernière résolution ; cicatrice de 30 min.
Un lien qui bat ferait jouer les strates en accordéon ; 30 min couvrent la relève.

**C9. Estompage.** Sur poste seulement, pendant un focus demandé : opacité ≥ 70 %, jamais sur un objet en écart ni au mur.
L'opacité plutôt que la luminance, qui appartient à la marge.

**C10. Fraîcheur.** Hachure.
Elle survit en niveaux de gris et à 4 m, se passe de transparence triée et réunit périmé et injoignable sous « on ne sait pas ». Je retire mon voile.

## 3. Critique du rendu actuel

- **À garder** : la salle entière reste cadrée pendant l'incident, et la colonne de A06 aux services se lit d'un coup d'œil.
- **À enlever** : le faisceau rouge plein et les fils rouges. La chaîne tracée est ivoire fin, les VM tombées sont hachurées.
- **Les strates** : leurs plans translucides empilés écrasent le contraste et noient la strate réseau, presque vide. Il faut un contour et un nom, des objets opaques, et le cœur, les amonts et le transit en double trait.
- **Les cartels** : dans s04, CRM recouvre lic-par-01 et esx-par-08 masque « Prendre en charge ». Un seul cartel ouvert à la fois ; les autres deviennent des épingles numérotées.
- **Le totem et la frise** : texte de 7 px environ, P3 affichés, repères ambre au sol. Au mur : totem en 32 px, P1 et P2 seulement ; frise à l'encre, violette en relecture.

## 4. Table finale proposée canal → sens

| Canal | Sens | Paramètres |
|---|---|---|
| Hauteur | strate | jamais une mesure |
| Teinte et forme | gravité | P3 absent du mur ; clignotement 1 Hz en phase, P1 racine non prise seulement |
| Double trait | redondance | tireté = mince ; simple = perdue (P2) |
| Luminance (2 bleus) | marge consommée | p95 70/85 %, plein < 30/7 j, 25/27 °C ; fondu de 2 s, hystérésis |
| Hachure à 45° | inconnu | périmé, injoignable ; toute la salle si le moteur se tait |
| Échafaudage | changement en cours | pointillé pendant 60 min d'observation |
| Défilement à 0,5 Hz | trafic dévié | liens seulement, 10 min |
| Opacité ≥ 70 % | mise en retrait | poste, focus demandé |

L'épaisseur (capacité) et la position appartiennent au dessin : ce ne sont pas des canaux d'état.
