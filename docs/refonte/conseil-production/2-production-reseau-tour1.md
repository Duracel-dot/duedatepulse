# Conseil de production · tour 1 · expert production réseau

## 1. Ce qui compte vraiment

Une panne franche se voit toujours ; ce qui tue, c'est une marge qui s'use sans bruit.

| # | Signal | Pourquoi | Source · fréquence | Seuils |
|---|---|---|---|---|
| 1 | Fraîcheur | Un lien gris sans donnée a l'air sain | âge par source et par objet | 2 intervalles manqués : voile ; 3 : P2 (déjà décidé) |
| 2 | Redondance, en topologie **et** en capacité | « À combien de pannes suis-je de la coupure ? » | LLDP, LACP, vPC, HA, BGP ; traps, gNMI ON_CHANGE, relevé 60 s | chemin double devenu simple : P2. Transit 1 est à 81 % : si transit 2 dépasse 19 %, la paire ne tient plus une perte |
| 3 | Pertes et erreurs | Les usagers souffrent avant la saturation | discards, CRC, optique DOM ; 60 s, 10 s sur le cœur | discards > 0,01 % : attention, > 0,1 % : dégradé ; CRC sur 3 relevés ; Rx à moins de 2 dB du seuil |
| 4 | Saturation au p95 | Une moyenne efface les pics | compteurs 64 bits, max des deux sens | > 70 % : visible ; > 85 % pendant 15 min : P2 |
| 5 | Qualité entre sites | Le WAN se dégrade avant de tomber | ICMP ou TWAMP toutes les 10 s, p99 | perte > 0,5 % sur 5 min : dégradé ; > 2 % : P2 ; gigue > 10 ms |
| 6 | Trafic hors régime | Paire déséquilibrée, secours actif, tempête de broadcast | compteurs par membre, IPFIX à 1 min | jumeaux à plus de 2:1 pendant 15 min ; secours > 20 % au lieu de < 5 % ; broadcast > 1 000 pps : P2 |
| 7 | Changements | La plupart des incidents suivent un changement | syslog de commit, rebonds BGP, TCN STP | commit hors fenêtre ; > 3 TCN/h |

## 2. À ne pas afficher

- **Des particules de trafic partout** : c'est un économiseur d'écran, qui tue le rendu à la demande et l'attention.
- **Des débits chiffrés sur les liens** : ils sont illisibles au mur et restent dans le cartel.
- **Les ports d'accès, fermés ou libres** : seul compte un lien attendu (LLDP) qui tombe.
- **Les moyennes, le CPU des routeurs, le syslog brut, les cartes d'« attaques », un ping vert sur 2 000 objets.**

## 3. Encodage dans l'espace 3D

Un canal = un sens, fixé dans `tokens.json` :

| Canal | Sens unique | Paramètres |
|---|---|---|
| Teinte et forme | gravité (déjà décidé) | jamais la charge |
| Épaisseur | capacité nominale | 1G : 2 px, 10G : 3 px, 100G : 5 px ; jamais animée |
| Tracé doublé | redondance | deux traits écartés de 3 px ; un membre tombé passe en tireté ; un lien simple par conception reste simple, sans alarme |
| Luminance (rampe bleue) | charge au p95 | < 70 % : encre ; 70 à 85 % : bleu 4 ; > 85 % : bleu 5, puis ambre après 15 min ; changement de palier en 2 s |
| Barbules statiques | pertes | traits perpendiculaires de 4 px, côté du port fautif, tous les 24 px (≤ 0,1 %) ou tous les 8 px (au-delà, ou CRC) |
| Défilement | trafic hors régime | chevrons tous les 48 px à 24 px/s, soit 0,5 Hz, dans le sens du trafic, à vitesse unique ; arrêt à la prise en charge ou au bout de 10 min ; 8 liens au plus |
| Voile | fraîcheur | 40 % d'opacité ; toute la strate si sa source se tait |
| Clé | changement | pleine : maintenance ; en contour : commit hors fenêtre, pendant 60 min |
| Hauteur | strate | jamais une mesure |
| Clignotement 1 Hz | P1 racine non prise en charge | seul autre rythme |

À 0,5 Hz, moitié du clignotement P1, « le trafic a bougé » ne se confond pas avec « réveille quelqu'un ».

Une scène saine est **immobile, opaque, doublée, sombre**. L'état global, ce sont les exceptions à ces quatre qualités.

## 4. Chorégraphie de panne

**Critique.**
- *« La chaîne s'allume en rouge »* : seule la cause racine est rouge ; les conséquences portent le code injoignable. Sinon, une coupure du cœur peint 200 objets en rouge.
- *« Le reste s'estompe »* : non. Le reste est déjà gris, et l'estomper cacherait un second incident.
- *« Une verticale = une chaîne »* : faux pour le réseau. Un cœur porte toutes les colonnes : sa panne s'étend à l'horizontale, puis monte par les ToR.
- *Le tiroir* convient à un serveur. En réseau, on montre plutôt où le trafic est parti.

**Exigences.**
- **Ce qui bouge** : une impulsion au sol de 800 ms, jamais rejouée ; le clignotement P1 ; le défilement sur le secours.
- **Ce qui ne bouge jamais** : la caméra du mur, les objets, les épaisseurs, le texte. Au poste, recadrage seulement après 30 s sans manipulation : 400 ms, sans rotation, une fois par minute au plus.
- **Trois incidents** : caméra fixe, trois épingles, P1 clignotant en phase.
- **200 événements** (coupure de core-par-1) : la racine apparaît aussitôt ; les conséquences sont retenues 15 s (convergence), puis s'affichent d'un bloc. La scène répond alors à **« le secours tient-il ? »** : les liens de core-par-2 défilent, et leur luminance dit s'ils saturent. Les sessions BGP qui tombent ensuite (délai de maintien de 90 à 180 s) se rangent sous la même racine.
- **Retour au calme** : un lien redevient double après 5 min de stabilité, sans vert ni flash.
- **Prise en charge** : elle arrête clignotement et défilement ; trait simple et barbules restent tant que l'état dure.

## 5. Pièges et garde-fous

- **Accoutumance** : tout mouvement expire en 10 min ; objectif : moins de 5 % du temps en mouvement sur une semaine normale.
- **Mal des transports** : aucune rotation automatique ; moins de 5 % de l'écran bouge.
- **Daltonisme** : redondance, pertes et changements passent par la forme, la charge par la luminance.
- **Mur à 4 m** : sur un écran de 55 pouces en 1080p, un trait sombre de moins de 3 px disparaît. Au mur : cœur, amonts, transit et WAN seulement.
- **GPU intégré** : le défilement décale les UV, sans particules. Tout mouvement suspend le rendu à la demande.
- **Confiance** : compteurs 64 bits obligatoires (à 10 Gb/s, un compteur 32 bits boucle en 3,4 s) ; deltas négatifs jetés après un redémarrage.
- **4 h du matin** : « dois-je réveiller quelqu'un ? » Un losange clignote, ou non. La luminosité du mur ne baisse jamais la nuit.

## 6. Recommandations

- **PROD-NET-1 (P0)** : dictionnaire des canaux fixé dans `tokens.json` et vérifié par un test ; sinon, chaque vue réinvente le sien.
- **PROD-NET-2 (P0)** : redondance en tracé doublé, calculée en topologie et en capacité ; c'est l'état global du réseau.
- **PROD-NET-3 (P0)** : voile sur les données périmées ; un gris sans donnée est le pire mensonge d'une console.
- **PROD-NET-4 (P0)** : aucune animation permanente, défilement réservé au trafic hors régime ; attention et GPU préservés.
- **PROD-NET-5 (P0)** : seule la cause racine en rouge, pas d'estompage, caméra du mur fixe ; le second incident reste visible.
- **PROD-NET-6 (P0)** : conséquences retenues 15 s, 5 min de stabilité avant le retour ; une convergence n'est pas une tempête.
- **PROD-NET-7 (P1)** : discards, CRC et optique en barbules ; les pertes précèdent la saturation.
- **PROD-NET-8 (P1)** : gNMI toutes les 10 s sur le cœur et le transit ; un relevé à 60 s cache les micro-rafales.
- **PROD-NET-9 (P1)** : clé de changement pendant 60 min ; première question d'un incident : « qui a touché quoi ? ».
- **PROD-NET-10 (P1)** : sondes entre sites toutes les 10 s, au p99 ; le WAN se dégrade avant de tomber.
- **PROD-NET-11 (P2)** : trafic comparé à sa plage normale sur 168 créneaux ; sinon, on crie au loup.
- **PROD-NET-12 (P2)** : test du mur en 5 s par un N1 de nuit ; seule preuve que l'encodage fonctionne.
