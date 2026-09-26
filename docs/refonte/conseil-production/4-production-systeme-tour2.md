# Conseil de production, tour 2 : expert production système

## 1. Accords

- **Un canal = un sens**, figé dans `tokens.json` et vérifié par un test. La hauteur ne porte que la strate (NET-1, APP-2).
- **L'état global, c'est la marge**, avec le même tracé doublé côté réseau et côté système. Scène saine : « immobile, opaque, doublée, sombre ».
- **Seule la cause racine est rouge.** Le traçage est ivoire, et un service prend la teinte de son SLI, pas de ses VM (APP-1).
- **Une scène figée et calme est le pire mensonge** : hachure dès 3 intervalles, horloge au sol arrêtée ou en ambre.
- **Le changement ouvre toute crise.** Au mur, caméra fixe ; ni particules ni rotation.

## 2. Votes

- **C1. Échafaudage statique pour un changement en cours, clé pour une maintenance déclarée.** Je retire mon défilement.
  Une nuit de correctifs sur 200 serveurs animerait toute la salle ; le mouvement doit rester rare.
- **C2. Tracé doublé partout, socle des services compris, sans inclinaison.**
  À 4 m, une inclinaison de 5° se confond avec la perspective et casse la verticale. De l'applicatif, je retiens : sans couleur, hors compteur « dégradés ».
- **C3. Marge consommée**, dont la charge au p95 et le budget d'erreur sont des cas particuliers.
  Un service assombri se confond avec l'estompage et avec « hors tension ». Le débit nul reste une alarme P2.
- **C4. Deux rythmes au total** : le clignotement carré à 1 Hz (cause racine P1 non prise en charge) et le défilement à 0,5 Hz (trafic basculé sur le secours, 10 min et 8 liens au plus).
  Le budget d'erreur est une marge : il passe en luminance. Une respiration modulerait ce même canal et endormirait le mur.
- **C5. Un cartouche d'architecte gravé dans le coin du plan** : heure avec secondes, âge des données, nombre de ◆ et de ▲ non pris.
  Sans fond ni bouton, à l'encre du dessin (14 px au poste, 32 px au mur) : la convention de tout plan, pas une interface.
- **C6. Recadrage automatique, une fois par nouvelle cause P1, après 60 s sans manipulation ni saisie.** Sinon, le cartouche affiche « Entrée : cadrer ».
  Le client est entendu sans arracher la vue à qui lit un cartel, ce que 30 s feraient. Jamais au mur.
- **C7. Déclenchement au-delà de 3 nouvelles causes en 60 s ; au-delà de 7 causes ouvertes, agrégation par baie puis par rangée.** Les conséquences sont retenues 15 s, la racine s'affiche aussitôt.
  Le rythme d'arrivée trahit une cause commune, et 15 s couvrent la convergence.
- **C8. Strates refermées après 5 min de stabilité ; cicatrice de 30 min.**
  Refermer après 30 s fait battre les strates au rythme d'une alarme instable ; 30 min laissent voir que « ça recommence ».
- **C9. −30 % de luminance au plus, jamais sur un objet en alarme ou en marge mince.** La transparence n'a plus de sens attribué.
  Le nominal est déjà gris ; la transparence triée coûte au GPU intégré et brouille les strates.
- **C10. Hachure.**
  Un voile à 40 % se lit comme un estompage. La hachure est achromatique, lisible à 4 m (traits de 3 px, pas de 12 px) et déjà retenue pour « injoignable ».

## 3. Critique du rendu actuel

- **Garder** : le cadrage salle et colonne, les strates écartées, le traçage ivoire du CRM (s04), les cartels de deux lignes.
- **Changer le faisceau rouge** : épais, il colore la strate réseau, hors de cause. Rouge sur l'équipement fautif seulement, traçage ivoire fin au-dessus.
- **Corriger les cartels** : en s04, CRM et esx-par-08 se chevauchent et masquent « Prendre en charge » ; la ligne de rappel de lic-par-01 mesure environ 400 px. Anti-chevauchement obligatoire (UX-11).
- **Refaire le totem** : texte d'environ 7 px, posé en transparence sur les plans, P3 compris. Opaque, face caméra, 5 lignes P1 et P2, 32 px au mur, ou remplacé par le cartouche.
- **Alléger les strates** : quatre plans translucides font du moiré sur les baies ; des filets de contour suffisent. Aussi : lic-par-01 en ambre plein au lieu d'être hachuré, libellé « SALLE A — PRODUCTION » en double au sol.

## 4. Table finale proposée canal → sens

| Canal | Sens unique |
|---|---|
| Élévation | niveau d'abstraction (strate) |
| Teinte et forme | sévérité ; ivoire = interaction et traçage ; violet = temps non réel |
| Clignotement carré 1 Hz | cause racine P1 non prise en charge |
| Défilement orienté 0,5 Hz | trafic sorti de son régime ; expire après 10 min |
| Tracé doublé | redondance : tireté = mince, simple = perdue |
| Luminance (2 paliers de bleu) | marge consommée : p95, thermique, capacité, files, budget d'erreur |
| Hachure | on ne sait pas : donnée périmée, injoignable, perte de supervision |
| Glyphe statique | échafaudage = changement en cours ; clé = maintenance |

Hors table, l'épaisseur indique la capacité nominale et ne bouge jamais.
