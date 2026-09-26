# Tour 2 — Directeur artistique 3D & data-visualisation

## 1. Accords forts

- **UX-1, UX-5** : trouvé indépendamment par l'UX et moi, DA-1 devient un invariant : normalité silencieuse, sévérité doublée d'une forme.
- **UX-2** (91 % de scène), **UX-7** (fin du `backdrop-filter`), **UX-12** (caméra fixe, cartouches reliés à l'objet) : ce sont mes cartels et plans fixes (DA-6).
- **UX-13** = DA-2 : un seul `tokens.json` pour le CSS et la scène.
- **EXP-2** : « Injoignable » se traduit dans la maquette par des enfants en contour pointillé, un trait d'attache vers la cause et **une seule épingle** avec compteur (« 8 VM, 3 services »).
- **EXP-4** : la base à paliers rend la relecture possible ; DA-12 monte en P1 si elle est retenue.
- **EXP-6, EXP-7** : c'est ma règle « 3D pour la géométrie, 2D pour les graphes ».
- **EXP-16** : l'expert parle déjà de **calque** énergie/climat ; les isolignes ne se colorent qu'hors de la plage ASHRAE 18–27 °C.

## 2. Désaccords et amendements

1. **Cyan d'interaction (UX-1) : contre.** C'est la teinte signature de la v0.1 « néon ». Surtout, en deutéranopie, #4CC9F0 devient ≈ #9CB4F0, presque le haut d'une rampe séquentielle bleue : « sélectionné » et « valeur haute » se confondent. L'ivoire #F5F1E8 sort de toute rampe (luminance 0,88 contre 0,52) et résiste à tous les daltonismes. J'adopte en revanche **une seule** couleur d'interaction : l'ivoire pour sélection, survol, focus **et** tracé. J'abandonne le violet du tracé, qu'un daltonien voit bleu.
2. **Cadre de relecture ambre (UX §5)** : l'ambre signifie « majeur ». Le temps non réel (relecture, comparaison) prend le violet #B78CFF, avec la mention « RELECTURE » et un cadre hachuré.
3. **Cividis (UX)** : il finit en jaune, teinte du mineur. Rampe monochrome bleu acier plafonnée à #9CC3EA, ambre ou rouge au franchissement de seuil.
4. **Deux volets (UX-3)** : oui, mais dans **un seul contexte WebGL** avec deux viewports (`setScissor`). Ressources partagées : coût ≈ 1,3× au lieu de 2×.
5. **« 3D allégée » (expert)** : d'accord pour l'interface, pas pour le détail : il n'existe qu'en LOD0, ne coûte rien de loin et, monochrome, ne crie jamais.
6. **Inventaire trompeur (risque signalé par l'expert)** : convention d'architecte « existant / projeté » : un objet déclaré mais non confirmé par un collecteur est dessiné en trait de construction (tireté, sans matière).
7. **Taille du texte au mur** : retenons « hauteur ≥ distance/200, jamais moins de 28 px ».

## 3. Votes

- **(a) Direction artistique** : je maintiens A, « Maquette & calques ». Graphite la nuit, **plâtre blanc** en thème clair (#E4E2DC sur #D9DCE0) : UX-13 sans second design.
- **(b) Polices** : la superfamille **IBM Plex**. Sans (interface), Sans Condensed (scène, colonnes denses), Mono (IP, ports). Inter est la police la plus générique de la décennie et n'a pas de version étroite, indispensable contre les collisions de noms longs. Repli : Inter pour l'interface, Plex Condensed obligatoire dans la scène.
- **(c) Interaction** : un ivoire unique, #F5F1E8. Le violet #B78CFF est réservé au temps non réel.
- **(d) Sévérités** : je me range aux teintes UX, meilleures. Critique #E5484D (écart de luminance avec l'ambre 1,9 contre 1,7 pour mon rouge, décisif en deutéranopie). Majeur #F5A524, mineur #E8D44D. **Trois niveaux** dans la console et la 2D. Dans la scène, le mineur n'est qu'un contour et disparaît en LOD2–3 : à 4 m, un daltonien ne distingue pas ambre et jaune (rapport 1,36).
- **(e) Vues par défaut** : N1 : console d'événements (60 %) + **plan de masse** 2D (maquette vue de dessus en orthographique) ; perspective à la demande. Mur : services et multi-sites ; maquette 3D de la salle principale en caméra fixe ; console ; petits multiples de capacité.
- **(f) Habiller la console et la 2D** : la console est une **nomenclature de plan**, pas un tableau web : filets d'encre de 1 px, ni cartes ni zébrures, en-têtes en Plex Condensed capitales espacées, sévérité en **marge de coupe** de 4 px avec glyphe. Un groupe de cause racine est une barre de **poché**, ses enfants reliés par un trait d'attache. La colonne Localisation montre une **mini bande U** (celle de la baie en LOD2, emplacement allumé) ; la durée est une réglette graduée. Les vues 2D sont **dessinées au trait sur calque** : trame de points à 8 px, zones (domaines L3, clusters) en aplats de calque bordés de hachures, capacités en **cotes**, réserve N+1 hachurée à 45°. Chaque vue porte un **cartouche** (vue, périmètre, période, « données au 14:32:05 », sources), hachuré quand les données sont figées (EXP-10) : signature commune du poste, du mur et des exports PDF.

## 4. Jetons de design proposés

```json
{
  "color": {
    "bg": "#12161C", "surface": "#181D24", "surfaceRaised": "#1F252E", "hairline": "#2A313B",
    "maquette": { "floor": "#171B21", "material": "#2B3139", "edge": "#3B434E", "poche": "#07090B",
                  "cutLine": "#8D949C", "calque": "rgba(201,211,220,0.07)", "unconfirmed": "dashed:#5A636E" },
    "ink": { "primary": "#DDE1E6", "secondary": "#8A94A0", "disabled": "#5A636E" },
    "severity": { "critical": "#E5484D", "major": "#F5A524", "minor": "#E8D44D",
                  "unknown": "hatch:#8A94A0", "stale": "hatch:#8A94A0", "maintenance": "hatch:#6F8196",
                  "unreachable": "dashed:#5A636E" },
    "severityShape": { "critical": "losange", "major": "triangle", "minor": "cercle" },
    "interaction": "#F5F1E8",
    "temporal": "#B78CFF",
    "metricRamp": ["#1B2633", "#2F4E6E", "#4F7FAE", "#7AA5D2", "#9CC3EA"],
    "flow": { "web": "#6E9CC0", "database": "#8E97CF", "auth": "#5FAFA8", "storage": "#86B59A",
              "replication": "#A9BCD0", "other": "#7D8791" },
    "flowPattern": { "web": "plein", "database": "plein", "auth": "points", "storage": "plein",
                     "replication": "tirets", "other": "fin" },
    "light": { "bg": "#D9DCE0", "material": "#E4E2DC", "edge": "#C9C6BE", "inkPrimary": "#1E242B" }
  },
  "font": {
    "ui": "IBM Plex Sans", "scene": "IBM Plex Sans Condensed", "mono": "IBM Plex Mono",
    "fallback": "Segoe UI, sans-serif", "features": "tnum", "wallMinPx": 28
  },
  "radius": { "none": 0, "sm": 2, "md": 4 },
  "stroke": { "hairline": 1, "focus": 2, "trace": 3, "severityMargin": 4 },
  "motion": { "unackBlinkHz": 1, "viewMorphMs": 900 }
}
```

Mail, remote et infra (code actuel) rejoignent `other` ; variantes de sévérité du thème clair à calculer (≥ 3:1 sur #E4E2DC).
