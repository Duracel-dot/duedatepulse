# Conseil de production, tour 1 : expert production système

Au-dessus des pannes, une seule question : **quelle marge me reste-t-il avant la prochaine ?** La scène doit la montrer.

## 1. Ce qui compte vraiment

1. **Redondance tenue ou perdue.** Sans filet, rien n'est rouge, mais la prochaine défaillance banale devient une crise. Sources : capacité HA (vSphere, Hyper-V), Redfish, PDU et onduleurs en SNMP, chemins SAN. Toutes les 60 s. Seuils : N+1 perdu = P2 ; marge après défaillance < 10 % = « mince » ; voie 2N > 40 % = mince, > 50 % = P2.
2. **Fraîcheur de la supervision.** Un écran calme parce qu'aveugle ment. Sources : horodatage par contrôle, battement des collecteurs et du moteur. Toutes les 10 s. Seuils : 3 intervalles sans donnée = périmé ; moteur muet plus de 30 s = scène figée.
3. **Énergie et climat.** Une salle dense sans climatisation gagne 10 °C en vingt minutes. Sources : sondes d'entrée de baie, onduleurs, PDU. Toutes les 30 s. Seuils : > 25 °C = mince, > 27 °C = P2, > 32 °C = P1 ; +1 °C en 5 min = P2 ; onduleur sur batterie plus de 60 s = P1.
4. **Saturation projetée**, en jours et non en pourcentage : régression sur 7 et 30 jours (datastores, agrégats, journaux SQL, mémoire des clusters), toutes les 15 min. Seuils : < 30 j = mince, < 7 j = P2, < 48 h = P1.
5. **Contention** : rien n'est en panne, tout rame. CPU ready > 5 % par vCPU (P2 à 10 %), swap d'hôte, latence datastore > 20 ms au p95. Collecte toutes les 20 s, lecture sur 15 min.
6. **Changements en cours** : maintenances, tâches vCenter et SCVMM, reconstructions RAID, resynchronisations. Au fil de l'eau. La plupart des incidents suivent un changement ; un changement hors fenêtre déclarée = P2.
7. **Protection des données** : une sauvegarde échoue en silence jusqu'au jour de la restauration. Âge du dernier point réussi, lu toutes les 15 min par l'API de sauvegarde. Plus de 26 h pour une quotidienne = P2 sur le service.

## 2. À ne pas afficher

- Les pourcentages CPU et RAM par VM : 140 jauges qui ondulent sans décision à la clé.
- La routine : sauvegardes nocturnes, vMotion DRS, redémarrages dans leur fenêtre.
- Les LED, ventilateurs et particules « qui montrent que ça vit » : trois semaines après, plus personne ne regarde un mur animé.
- Les cumuls d'événements, les P3 au mur, les alarmes filles et la rotation automatique de caméra.
- Les avertissements sans propriétaire : au bout d'un mois, on corrige le seuil.

## 3. Encodage dans l'espace 3D

**Un canal = un sens.** Un objet nominal n'utilise aucun canal dynamique.

- **Élévation** : le niveau d'abstraction (strates), sans aucune hauteur métrique.
- **Teinte** : la sévérité d'alarme. L'ivoire sert à l'interaction, le violet au temps non réel.
- **Clignotement** : action immédiate (cause P1 non prise en charge). 1 Hz, créneau à 50 %, luminance 100 % ↔ 45 % sans jamais s'éteindre, phases calées sur une horloge unique.
- **Double filet au pied de l'objet** : la redondance. Au nominal, deux traits de 1,5 px écartés de 3 px, en `#2A313B`, intégrés au dessin. Redondance mince : un trait passe en tireté. Redondance perdue : un trait unique de 3 px, ambre si le P2 est levé. La plinthe de la salle le reprend : c'est la seule synthèse, lisible à 4 m.
- **Luminance** : la marge qui fond (thermique, énergie, capacité, contention). Voile bleu sur la face supérieure, en 2 paliers (3e et 5e bleu de la rampe), avec hystérésis (apparition à 25 °C, disparition à 24 °C ; apparition sous 30 j, disparition au-delà de 45 j). Fondu de 2 000 ms, recalcul toutes les 5 min au plus : la marge évolue comme la lumière du jour.
- **Hachure** : l'inconnu (périmé, injoignable, perte de supervision). Trait de 1,5 px à 45°, pas de 6 px ; au mur, 3 px et 12 px. Si la scène est figée, toute la salle se hachure.
- **Défilement de tirets** : changement en cours. Tirets de 8 px, défilant à 6 px/s (0,5 Hz), en encre claire à 60 %. Au-delà de 5 objets, un seul défilement sur le socle du cluster. Au mur, une clé statique.
- **Transparence** : mise en retrait pendant un focus. Jamais sous 35 % d'opacité, jamais sur un objet en alarme.

L'état global se lit au silence : ni voile ni hachure, filets doubles, rien ne bouge. L'heure gravée au sol, secondes comprises, prouve que la scène vit.

## 4. Chorégraphie de panne

Le concept empile cinq mouvements simultanés (impulsion, strates, caméra, tiroir, estompage) : l'opérateur perd ses repères au pire moment.

- **Ne bougent jamais** : la caméra du mur ; celle d'un poste touché depuis moins de 60 s ; les baies ; les autres incidents ouverts.
- **Bougent une fois** : l'onde au sol, un seul anneau de 1 200 ms à +20 % de luminance, à la naissance d'une cause P1, jamais au mur. Le tiroir sort de 30 % de sa profondeur en 400 ms, sans rebond, sur poste seulement ; au mur, une épingle de 32 px le remplace.
- **Strates** : écartées en 400 ms au premier P1, refermées 5 min après le dernier, sans va-et-vient. Au mur, l'écartement est fixe.
- **Chaîne d'impact** : chaque maillon porte la teinte de son propre état. Un rouge uniforme confond cause et conséquence.
- **Caméra** : sur poste, le recadrage est proposé (Entrée), jamais imposé. Il englobe la salle et toutes les causes P1.
- **Trois incidents** : trois colonnes allumées, aucune ne prend la caméra, et le totem les ordonne par priorité puis ancienneté.
- **Tempête de 200 événements** : seules les causes racines sont dessinées. Au-delà de 7 causes, agrégation par baie puis par rangée, sans onde ni tiroir. Plus de 20 alarmes en 60 s sur une rangée, une voie électrique ou un cluster désignent une cause commune probable. Les événements sont regroupés par fenêtres de 1 s, et un objet change d'aspect au plus toutes les 2 s.
- **Prise en charge** : le clignotement cesse en moins de 100 ms et la colonne descend à 60 % de luminance. Chaque action doit calmer la scène d'un cran. Une aggravation relance le clignotement.
- **Retour au calme** : l'objet rétabli garde un contour gris clair pendant 15 min. La caméra ne revient jamais seule.

## 5. Pièges et garde-fous

- **Accoutumance** : un jour normal, moins de 2 % d'objets colorés, aucun mouvement sans changement réel, et une revue hebdomadaire des alarmes chroniques.
- **Mal des transports** : caméra jamais autonome, ni roulis ni variation de focale, transitions de 400 ms au plus, aucun mouvement sous `prefers-reduced-motion`.
- **Daltonisme** : redondance, marge, incertitude et changement sont achromatiques ; une capture en niveaux de gris doit raconter la même histoire.
- **Mur à 4 m** : 1 px disparaît ; traits de 3 px, glyphes de 32 px, deux niveaux de luminance au plus.
- **GPU intégré** : clignotement à 2 rendus par seconde, défilement à 10 i/s, hachures en shader : le rendu à la demande tient.
- **Confiance** : le gris signifie « vérifié il y a moins de 3 intervalles », jamais « pas de nouvelles ». J'ai vu un mur resté vert trois heures sur un navigateur gelé.
- **4 h du matin** : ne jamais faire comparer deux nuances. En 3 secondes, l'opérateur sait s'il y a un P1 non pris, si la scène vit et si la redondance tient.

## 6. Recommandations

- **PROD-SYS-1 (P0)** : faire de la marge l'état global affiché, car elle précède les pannes.
- **PROD-SYS-2 (P0)** : figer la table des canaux dans `tokens.json` ; deux sens par canal rendent la scène illisible.
- **PROD-SYS-3 (P0)** : moteur muet plus de 30 s ⇒ scène hachurée, heure arrêtée ; une scène figée et calme est le pire mensonge.
- **PROD-SYS-4 (P0)** : aucune caméra autonome, ni au mur ni sur poste actif, pour l'orientation et contre le mal des transports.
- **PROD-SYS-5 (P0)** : ancrer à l'écran l'heure, l'âge des données et le nombre de P1 et P2 non pris ; exception assumée au « sans surimpression ».
- **PROD-SYS-6 (P0)** : synchroniser les clignotements ; déphasés, ils font un stroboscope.
- **PROD-SYS-7 (P1)** : mode tempête qui agrège et désigne une cause commune ; 200 marqueurs ne se lisent pas.
- **PROD-SYS-8 (P1)** : ne jamais estomper un objet en alarme, pour garder la vue globale.
- **PROD-SYS-9 (P1)** : le double filet et la plinthe de salle, seule synthèse lisible à 4 m.
- **PROD-SYS-10 (P1)** : collecter les marges (HA, voies, onduleurs, sondes, projections) ; sans elles, rien à encoder.
- **PROD-SYS-11 (P1)** : montrer les changements en cours, sans la routine ; la plupart des incidents en découlent.
- **PROD-SYS-12 (P2)** : porter l'âge du dernier point de restauration sur la strate services ; sans lui, un service n'a pas de filet.
- **PROD-SYS-13 (P2)** : tests à 4 m et en niveaux de gris dans les critères de sortie ; ce qui n'est pas testé dérive.
