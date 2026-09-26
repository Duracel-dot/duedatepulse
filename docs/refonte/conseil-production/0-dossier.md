# Dossier du conseil de production — SupervisionNG, console « tout en 3D »

## Le produit
SupervisionNG : supervision d'infrastructure (Node.js, three.js, tourne sous Windows, hors ligne possible,
interface en français). Collecte : inventaire physique (salles, baies, positions U, câblage), Windows/WinRM,
Hyper-V, vSphere, Proxmox, SNMP + LLDP, NetFlow/IPFIX, ping, API d'ingestion. Un moteur fusionne les sources
(une CMDB vivante), relie flux ↔ VM, trace le chemin physique d'un flux. Prochaine version : moteur d'événements
(alarme par contrôle, dépendances, état « injoignable », cause racine, prise en charge nominative),
métrologie 13 mois (p95, plages normales, projections), socle Telegraf + VictoriaMetrics.

Code : ce dépôt (lecture seule pour le conseil). Documents utiles :
- docs/refonte/README.md : synthèse du premier conseil (supervision, UX, direction artistique) ;
- docs/refonte/ARCHITECTURE-BACKEND.md : socle de collecte et sécurité ;
- public/refonte/ : démo actuelle (HUD 36 px, rail 44 px, console, vues 2D, vue physique 3D).
Captures de la démo « tout en 3D » en cours de construction, remises au conseil : vue physique au repos,
console N1 et inspecteur, mur 2×2, vue services, vue métrologie, puis la scène spatiale à l'arrivée, pendant
l'incident et en sélection du service CRM (captures s01 à s06, non versionnées).

## Décisions déjà prises (premier conseil)
- Normalité silencieuse (ISA-101) : le nominal est gris, la couleur est réservée aux anomalies.
- Priorités : P1 #FF5A47 losange plein (seule une cause racine P1 non prise en charge clignote, 1 Hz),
  P2 #F5A524 triangle, P3 #E8D44D cercle creux (absent du mur). Interaction : ivoire #F5F1E8 portée par la
  forme. Temps non réel (relecture) : violet #B78CFF. Rampe de mesure : 5 bleus #1B2633 → #9CC3EA.
  Fond graphite #12161C. Typo IBM Plex.
- Un incident = une ligne : les conséquences sont regroupées sous la cause racine.

## Ce que le client demande maintenant (mot pour mot)
1. « C'est pas possible de tout avoir de navigable sans interface en avant ? que tout soit intégré dans
   l'espace 3D ? »
2. « Si une panne survient il faut que le visuel se meuve de manière à mettre en évidence la panne sans perdre
   la vue globale ; la complexité entre infrastructure physique et logique doit être résolue. »
3. « Montez un conseil d'experts de la production système, réseau, applicatif ; ils ont tous des années
   d'expérience dans des environnements chargés et exigeants ; ils savent ce qui est le plus important sur une
   console de supervision pour ne pas envahir l'espace visuel d'informations inutiles, mais capables, par des
   jeux de mouvement, couleurs, intensité, etc., de communiquer des informations sur l'état global au-dessus
   des simples pannes. »

## Concept spatial en cours de construction (à critiquer librement)
Une seule scène 3D, aucune interface en surimpression. L'axe vertical porte le niveau d'abstraction :
- strate PHYSIQUE (sol) : salle, baies, équipements en position U réelle ;
- strate RÉSEAU (au-dessus) : commutateurs placés à l'aplomb de leur baie, liens en « plan de métro » ;
- strate VIRTUALISATION : hôtes à l'aplomb de leur serveur physique, VM posées sur leur hôte, clusters ;
- strate SERVICES (en haut) : chaque service placé au barycentre de ses VM, relié à elles par des « racines ».
Un élément logique est toujours à l'aplomb de son ancrage physique : une verticale = une chaîne de dépendances.
Au repos, les strates sont resserrées et silencieuses. Survoler un élément allume sa chaîne verticale.
Navigation sans interface : clic sur un objet (cartel 3D ancré qui se déplie), clic sur le nom d'une strate
pour l'isoler, tableau d'événements comme objet physique dans la salle (totem), règle temporelle au sol pour la
relecture, recherche au clavier affichée au sol, raccourcis clavier, focus clavier virtuel pour l'accessibilité.
Chorégraphie de panne (P1) : impulsion au sol depuis l'équipement, les strates s'écartent, la caméra recadre
pour contenir TOUTE la salle ET la colonne de la panne (jamais de zoom qui fait perdre le contexte), le serveur
fautif sort de sa baie comme un tiroir, la chaîne d'impact s'allume en rouge du sol jusqu'aux services, le reste
s'estompe, un cartel en haut de la colonne résume l'impact.

## Scénario de démonstration
Paris DC1, salle A : 16 baies (rangées A et B), cluster VMware CL-PROD-PAR (10 hôtes), Hyper-V HVCL-PAR,
SQL Always On physique, stockage NetApp, ~140 VM. Incident : esx-par-08 perd ses deux alimentations ; HA
redémarre 3 VM ailleurs ; crm-db-01 et pki-01 ne redémarrent pas (réserve N+1 consommée) ⇒ CRM et PKI
interrompus, Portail/RDS/Kubernetes dégradés. Autres signaux : A04 T° d'entrée 28,4 °C (pris en charge),
transit Internet 1 à p95 81 % (pris en charge), lic-par-01 perte de supervision, stockage plein le 14/11.

## Contraintes
Windows, hors ligne, PC de mur à GPU intégré (60 i/s visés, 30 au pire), opérateurs N1/N2 en 3×8, mur
d'écrans lu à 4 m, daltonisme (8 % des hommes), fatigue et accoutumance aux alarmes, pas de mal des transports.
