# Tour 2 — Designer UI/UX : réactions

## 1. Accords forts

- **DA-1 / UX-1** : la normalité est silencieuse. Nous sommes trois à le dire, c'est donc le premier principe de la refonte.
- **EXP-1, EXP-2, EXP-3** sont le moteur dont mon tiroir d'alarmes (UX-6) n'était que la façade : une alarme par contrôle, l'état « Injoignable (cause : X) », la prise en charge nominative levée en cas d'aggravation.
- **EXP-8 = UX-3 + UX-9** : sélection, filtres, temps et URL partagés ; « Afficher dans… » va dans le menu contextuel et Ctrl+K.
- **EXP-10** : le bandeau « Données figées » s'impose, nous l'avons proposé tous les trois.
- **DA-3 et DA-4** : texte SDF sans chevauchements, et bande U d'état. Je relève mon minimum au mur de 28 à **32 px** (règle distance/200).
- **DA-5/UX-7** (rendu à la demande, pas de flou), **DA-8** (2D pour les graphes), **EXP-4** (condition de UX-10 et UX-14).

## 2. Désaccords et amendements

- **Transitions (DA-9)** : 900 ms, c'est trop pour un opérateur qui change de vue 50 fois par heure. **Je propose 400 ms au plus.** L'animation est instantanée quand on enchaîne les commandes au clavier ou quand `prefers-reduced-motion` est actif. Le travelling reste réservé aux changements de vue ; une sélection ne déplace jamais la caméra sans une demande (F ou Entrée).
- **Cartels ancrés (DA-10)** : 12 au plus sur le poste, **5 au plus au mur**. À 32 px, 12 cartels couvriraient environ 15 % de l'écran. On ne les affiche que pour la sélection, les objets épinglés et les critiques non prises en charge.
- **Bande de relecture (DA-12)** : elle ne doit pas ajouter de troisième bande permanente. En mode relecture, elle **remplace la bande d'alarmes de 28 px**, au même emplacement, avec le code-barres des alarmes et le curseur. Coût d'emprise : zéro.
- **Capitales espacées (DA-2)** : je les réserve aux titres de section et aux cartouches. **Jamais pour les noms d'objets**, car les noms d'hôtes sont sensibles à la casse et les capitales ralentissent la lecture.
- **Plans fixes au mur (DA-6)** : au moins 20 s par plan, ronde suspendue tant qu'une critique n'est pas prise en charge.
- **Commentaire obligatoire (EXP-3)** : oui, mais avec des modèles préremplis et Ctrl+Entrée ; sinon, les opérateurs tapent « . ».
- **Priorité = sévérité × criticité (EXP)** : la **forme et la couleur codent la priorité**, pas la sévérité brute. Sinon, `dev-05` en critique crie aussi fort que la production.

## 3. Votes

**(a) Direction artistique : A « Maquette & calques ».** Seule piste où le normal est gris par nature (ISA-101), déclinable en thème clair « plan papier » ; B fatigue sur fond bleu, le vert de C contredit les états.

**(b) Polices : je change d'avis et vote IBM Plex Sans Condensed + IBM Plex Mono.** Inter est partout et n'apporte aucune identité ; le Condensed gagne de la largeur sur les FQDN et les étiquettes 3D. Deux conditions : Condensed à 12 px minimum, et **toutes les valeurs chiffrées en Plex Mono**, dont les chiffres sont tabulaires par construction.

**(c) Interaction : ivoire #F5F1E8 et violet de traçage #B78CFF, avec des amendements.** Je retire mon cyan, qui ne se distingue de la rampe de mesure « bleu instrument » que par un rapport de luminance de 1,38 : ce serait une nouvelle collision.
- L'ivoire est presque identique au texte (rapport de 1,17). La sélection doit donc passer par la **forme** : coque, halo et étiquette inversée (fond ivoire, encre sombre).
- L'anneau de focus clavier fait 2 px, en ivoire.
- En thème clair, la sélection devient une encre sombre (#1B1F24).
- Le violet est **exclusivement** réservé au traçage.

**(d) Sévérité : 3 priorités, 2 teintes.**
- Critique : #FF5A47, forme pleine en losange.
- Majeur : #F2A33A, triangle plein.
- Mineur (y compris les écarts statistiques de l'EXP) : triangle ambre **creux**, sans troisième teinte. Avec un jaune, on retomberait dans la confusion ambre/jaune pour les daltoniens.
- Critique et majeur n'ont qu'un rapport de luminance de 1,48 entre eux : **la forme est obligatoire**.
- Thème clair : #C8321F et #9A5B00, qui atteignent 3,9:1 sur #D9DCE0 (WCAG 1.4.11).
- Inconnu : hachures. Maintenance : hachures et clé.

**(e) Vue par défaut.** Pour le N1 : la **Console d'événements**, partagée avec la scène cadrée sur l'événement sélectionné. Pour le mur : la **vue Physique en LOD2**, avec bande U, épingles et plans fixes. Un mur à plusieurs écrans ajoute la vue Services sur un second écran.

**(f) Intégrer EXP-5 sans regonfler l'emprise.** La console est **un contenu, pas un habillage** ; je ne la compte donc pas dans mon budget de 8,8 %. C'est un seul composant qui existe en trois tailles :
1. **Bande de 28 px** dans toutes les vues.
2. **Tiroir** (touche A, 40 % de la hauteur) dans les vues d'analyse.
3. **Vue pleine largeur** dans le rail (G A), partagée horizontalement : scène en haut sur 55 %, console en bas sur 45 %, et Ctrl+↑/↓ pour agrandir la console à 100 %.

Quand la console est visible, la bande de 28 px disparaît, pour ne jamais afficher deux fois la même liste. L'habillage de l'espace N1 se limite au HUD et au rail, soit 5,5 %. Les compteurs « non pris en charge » par priorité restent dans le HUD (EXP-5 = UX-4).
