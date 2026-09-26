# Conseil de production, tour 1 : expert production applicative

## 1. Ce qui compte vraiment

Question unique : « les usagers obtiennent-ils ce qu'ils viennent chercher, et cela va-t-il durer ? ». Un certificat expiré laisse l'infrastructure grise pendant que toutes les connexions échouent. Signaux classés :

| # | Signal | Pourquoi | Source | Fréquence | Seuils |
|---|---|---|---|---|---|
| 1 | **Santé ressentie** (SLI : part de requêtes bonnes) | seul signal que l'usager perçoit | sondes transactionnelles Telegraf depuis DC1 **et** Lyon ; 5xx et temps des frontaux (IIS, proxy, OTLP) | 30 s, SLI sur 5 min | bonne = succès **et** sous le seuil du parcours (1 s portail, 300 ms API) ; dégradé sous le SLO (99,5 %) ; interrompu sous 90 % |
| 2 | **Vitesse de consommation du budget d'erreur** | l'érosion avant la panne | moteur, sur le SLI, budget 30 j | 1 min | 14,4× sur 1 h et 5 min → P2 ; 6× sur 6 h et 30 min → tendance ; 1× sur 3 j → ticket, hors scène |
| 3 | **Changements en cours** | « qu'est-ce qui a changé ? » ouvre toute crise | webhook CI/CD (version, instances), calendrier ITSM | événement | tout changement effectif, plus 30 min d'observation |
| 4 | **Latence p99 contre la normale** | l'usager part avant l'erreur ; la moyenne ment | sondes, OTLP, JMX, `time-taken` IIS, attentes SQL | 1 min | p99 > 2× la borne haute du créneau pendant 10 min ; intégrée au SLI |
| 5 | **Débit métier contre la normale** | panne silencieuse : zéro erreur parce que zéro requête | compteurs métier (connexions/min, commandes/min) par l'API ; à défaut NetFlow vers la VIP | 1 min | < 60 % de la borne basse du créneau pendant 10 min ; nul 5 min → P2 |
| 6 | **Saturation des files et pools** | précurseur de 15 à 60 min | RabbitMQ, Kafka, MSMQ, JMX, pool SQL | 30 s | âge du plus vieux message > 50 % du délai toléré ; pool > 90 % 5 min. Jamais la profondeur brute |
| 7 | **Dette de redondance** | la prochaine panne sera un P1 | dépendances (instances vivantes contre requises), AG SQL, N+1, échéances x509 | 1 min | instances < requises + 1 ; AG désynchronisée 5 min ; certificat < 21 j |

La fraîcheur des données conditionne les sept (§ 5).

## 2. À ne pas afficher

- CPU et mémoire à 85 % sans effet sur latence ou files.
- Compteurs de vanité : « 1 247 contrôles OK », « disponibilité 99,98 % ».
- Scores composites (« santé 87/100 ») : personne ne sait pourquoi ils baissent.
- Redémarrages unitaires de pods, hors-production, batchs réussis.
- Particules de trafic permanentes : un mouvement perpétuel use le canal mouvement avant le jour où il servira.
- Moyennes de latence, courbes animées au repos.

## 3. Encodage dans l'espace 3D

Un canal = un sens, figé dans `tokens.json`. Au repos, rien ne bouge et rien n'est coloré.

| Canal | Sens unique | Paramètres |
|---|---|---|
| Hauteur | la strate | un service ne « s'enfonce » jamais |
| Teinte + forme | sévérité de l'impact | palette décidée ; ivoire = interaction ; violet = temps non réel |
| Clignotement carré 1 Hz | cause racine P1 non prise en charge | unique |
| Respiration sinusoïdale | le budget brûle (≥ 6×) sans panne franche | 0,2 Hz, luminance ± 15 %, après 5 min confirmées ; fondu de 2 s sous 3× pendant 15 min ; figée à la prise en charge |
| Luminance du liseré et de la face | activité métier contre la normale | `#8A94A0` → `#3A424D` si débit bas (écart 3,3:1) ; jamais vers le clair, réservé à l'ivoire |
| Inclinaison | dette de redondance | 5° statiques vers la racine restante (à valider à 4 m), posés en 400 ms, retirés après 10 min rétablis |
| Échafaudage | changement en cours | 4 montants de 1 px (2 px au mur) en `#DDE1E6` sur la colonne ; une graduation par instance, pleine une fois mise à jour ; pointillé pendant l'observation |
| Épaisseur des liens entre services | accumulation (file, pool) | invisible sous 50 % du délai toléré, puis 2 → 6 px ; 6 px = P2 |
| Hachure | « on ne sait pas » (injoignable, périmé) | 45°, pas de 6 px, opacité 30 % ; plus jamais pour la réserve N+1 |

La respiration amende « seul le P1 clignote » : une vitesse mérite un canal temporel, lent, jamais au-delà de 0,5 Hz.

**Strate SERVICES.** Elle porte l'état global : à 4 m, on compte ce qui est coloré, respire, s'assombrit, penche ou est en chantier. La teinte d'un service vient de son SLI, jamais de ses VM : les racines disent *pourquoi*, pas *si*. Dans le scénario, Portail, Bureaux à distance et Kubernetes servent leurs usagers sans réserve : ils doivent **pencher, sans jaune**, et sortir du compteur « 3 dégradés » du mur, qui mélange impact et fragilité. Aucune teinte d'ambiance globale.

## 4. Chorégraphie de panne

Critique :
- **Impulsion au sol et tiroir** supposent une cause physique ; or mises en production, verrous et dépendances externes dominent. Partir de la strate de la cause.
- **Chaîne rouge** : contraire à « un incident = une ligne ». Traçage ivoire, rouge pour la seule cause, chaque service garde la teinte de son SLI.
- **Recadrage automatique** : jamais au mur ; au poste, sur Entrée ou après 60 s sans saisie.
- **« Le reste s'estompe »** : ainsi rate-t-on le second incident. − 30 % de luminance au plus, jamais sur un objet en sévérité.
- **Cartel** : parler d'usagers (« CRM : 100 % des connexions en échec depuis 3 min »), pas de VM.

Exigences :
- **Bouge une fois** : strates 400 ms, tiroir 300 ms, traçage ascendant 600 ms. Puis immobilité.
- **Ne bouge jamais** : positions au sol, caméra du mur, horloge au sol, marques des autres incidents.
- **Trois incidents** : un cadrage englobant les trois colonnes, tri par impact (SLI × usagers) ; tiroir et traçage pour le premier seul, cartels repliés numérotés pour les autres.
- **Tempête de 200 événements** : au-delà de 3 causes en 60 s, aucune animation, image stable, un cartel « cause commune probable » (réseau, stockage, DNS, annuaire).
- **Prise en charge** : clignotement coupé, losange en contour, respiration figée, rien d'autre ne bouge.
- **Retour au calme** : gris après 10 min de SLI conforme ; cicatrice en trait fin 30 min ; strates resserrées 30 s après la dernière résolution.
- **Mise en production qui dégrade** : traçage entre échafaudage et service ; cartel « dégradé 4 min après CHG-1234, v2.14 → v2.15, 6/10 instances », SLI nouvelles contre anciennes instances. Autres échafaudages en pointillé : gel suggéré.

## 5. Pièges et garde-fous

- **Accoutumance** : respirer plus de 4 h sans prise en charge révèle un SLO faux, à corriger.
- **Mal des transports** : ni rotation automatique ni oscillation ; respiration sur la luminance, jamais l'échelle ; en mouvement réduit, liseré épaissi.
- **Daltonisme** : huit canaux sur neuf sont achromatiques, la teinte est doublée d'une forme.
- **Mur à 4 m** : service de 60 px au moins, écarts de luminance ≥ 3:1, traits de 2 px.
- **GPU intégré** : des uniformes sur les matériaux existants ; ni particules, ni halo, ni transparence triée ; 0,2 Hz se rend à 10 i/s.
- **Confiance** : une sonde unique ment ; deux points doivent concorder. Un SLI de plus de 3 intervalles est hachuré, jamais figé dans sa dernière couleur ; flux muet 90 s → strate hachurée, horloge au sol en ambre. Une scène figée et calme est le pire mensonge.
- **Opérateur à 4 h** : l'état se lit en 3 s sans souris ; les normales par créneau n'assombrissent pas la nuit ; un échafaudage sans ticket est une anomalie (P3).

## 6. Recommandations

- **PROD-APP-1 (P0)** : état d'un service = SLI sondé de deux points, pas l'état de ses VM. C'est ce que vit l'usager.
- **PROD-APP-2 (P0)** : table canal → sens dans `tokens.json`, hauteur réservée aux strates. Sinon le vocabulaire dérive.
- **PROD-APP-3 (P0)** : dette de redondance en inclinaison, sans couleur, hors compteur « dégradés ». Impact et fragilité sont distincts.
- **PROD-APP-4 (P0)** : hachure dès 3 intervalles sans donnée. Une scène figée ne doit jamais paraître saine.
- **PROD-APP-5 (P0)** : aucune caméra automatique au mur. Préserver la mémoire spatiale.
- **PROD-APP-6 (P1)** : consommation du budget en respiration 0,2 Hz, 14,4× en P2. Voir l'érosion avant la panne.
- **PROD-APP-7 (P1)** : ingestion des changements, échafaudage, corrélation dans l'heure. La première question de crise.
- **PROD-APP-8 (P1)** : chorégraphie depuis la strate de la cause, tri par impact, mode tempête. Lisible sous charge.
- **PROD-APP-9 (P1)** : débit métier rendu en luminance, alarme de débit nul. Détecter la panne silencieuse.
- **PROD-APP-10 (P2)** : épaisseur des liens selon l'âge des messages. Voir le bouchon avant le débordement.
- **PROD-APP-11 (P2)** : cicatrice de 30 min, revue des états permanents. Informer la relève.
