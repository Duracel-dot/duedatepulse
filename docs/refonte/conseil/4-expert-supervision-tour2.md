# Tour 2 — Expert supervision & métrologie

## 1. Accords forts

- **La normalité est silencieuse** (UX-1, DA-1), avec une **forme** qui double toujours la couleur (UX-5).
- **Compteurs d'alarmes non prises en charge** (UX-4) et **tiroir d'alarmes** qui regroupe par cause, exige un commentaire et gère la maintenance (UX-6). C'est la traduction IHM de EXP-1 à EXP-3 et de EXP-5.
- **Mur** : caméra fixe, plans enchaînés et bandeau « Données figées » (UX-12, DA-6, EXP-10).
- **Vues logiques en 2D** (DA-8) : réseau en plan de métro, graphe des services, treemap où la **réserve N+1 est hachurée**.
- Bande U d'état et épingles (DA-4), budget tenu sur GPU intégré (DA-5, UX-7).
- La période globale (UX-10) et la relecture (UX-14, DA-12) supposent le stockage EXP-4 : c'est un prérequis.

## 2. Désaccords et amendements

1. **Poste N1 (UX-2).** Une scène à 91 % avec une bande de 28 px convient à un N2, pas à un N1. *Amendement* : l'espace « N1 » s'ouvre en volets coordonnés, console d'événements à 40 % et vue Services à 60 %.
2. **Clignotement.** Pendant une tempête, tout clignoterait. *Amendement* : seules les **racines** P1/P2 non prises en charge clignotent, jamais les enfants « injoignables » ni les mineurs.
3. **« Inconnu = hachures sans teinte ».** Le silence n'est pas un OK. *Amendement* : un inconnu qui dure plus de 3 intervalles sur un élément de production lève une alarme **majeure** « perte de supervision ». Distinguer aussi un arrêt attendu d'un arrêt inattendu.
4. **Rendu à la demande (DA-5).** Une image immobile ressemble à un navigateur figé. *Amendement* : l'âge du dernier delta reste toujours visible, et un chien de garde tourne dans la page.
5. **Transitions de 900 ms (DA-9).** *Amendement* : 400 ms au plus, désactivables, jamais au mur.
6. **LED par port (DA-7).** Une façade générique trompe le technicien au moment de débrancher. *Amendement* : n'allumer que les ports réellement mappés, avec la mention « représentation schématique ».
7. **Isolignes thermiques (DA-11).** Interpoler entre des sondes rares invente des températures. *Amendement* : afficher les sondes réelles, et n'interpoler qu'à partir d'une sonde pour deux baies.
8. **Rampe cividis (UX).** Elle finit en jaune, comme la priorité « mineur ». *Amendement* : utiliser la rampe « bleu instrument » du DA.

## 3. Votes

**(a) A « Maquette & calques ».** Le graphite neutre fait le mieux ressortir les alarmes. B rend mal le rouge et fatigue en 3×8 ; C est verte, ce qui contredit la sémantique d'état. Le thème clair (UX-13) est conservé.

**(b) Inter + JetBrains Mono.** Une police condensée perd en lisibilité à 11–13 px sur un écran 1080p. Les IP et noms d'hôtes exigent un zéro barré et des 1/l/I distincts. Plex Sans Condensed reste admise pour le seul lettrage 3D des salles.

**(c) Sélection en cyan #4CC9F0, traçage en violet #B78CFF.** L'ivoire #F5F1E8 n'a qu'un contraste de 1,17:1 avec l'encre claire #DDE1E5 : en 2D, la sélection se confondrait avec le texte. Sélection et chemin coexistent, ils ont donc besoin de deux teintes hors statut.

**(d) 3 priorités affichées**, calculées à partir de 2 sévérités techniques (compatibles Centreon) et de la criticité métier. Les 6 niveaux Zabbix se projettent sur ces 3 priorités ; « information » reste dans le journal.

| Priorité | Couleur | Forme | Saillance |
|---|---|---|---|
| P1 critique | **#FF5A47** (5,9:1 sur fond, contre 4,6:1 pour #E5484D) | losange plein | clignote si c'est une racine non prise en charge |
| P2 majeur | **#F5A524** | triangle plein | fixe |
| P3 mineur | **#E8D44D**, contour seul | cercle creux | fixe, absent du mur |

Entre l'ambre et le jaune, le contraste n'est que de 1,36:1, d'où le mineur tracé en contour seul.

**(e) Vue par défaut.**
- **N1** : console groupée par cause racine, à côté de la vue Services ; Entrée ouvre la vue physique sur l'alarme.
- **Mur** : un rôle par écran.
  1. Services et compteurs P1/P2.
  2. Console en grand corps.
  3. Vue physique en plans fixes, cadrée sur les racines.
  4. Métro réseau et WAN.
- **Mur d'un seul écran** : services et bande des 5 racines.

**(f) Refonte 1**, un tout indissociable : une palette silencieuse sans suppression des filles reste une tempête, et un tiroir de métrologie sans stockage reste vide.
- **Serveur** : EXP-1, 2, 3, 9 et 10 ; EXP-4 réduit (brut sur 14 j et palier 1 h avec p95 sur 13 mois) ; EXP-11 limité aux métriques critiques.
- **Interface** : UX-1 à 7, UX-9, 11 et 12 ; DA-1 à 6 ; UX-10 simple (période, petits multiples, comparaison à J-7).
- **Vues** : Physique (piste A), Services, L2 en plan de métro.

**Refonte 2** : EXP-12 à 16 ; vues Virtualisation, Flux et L3/WAN ; DA-7 et DA-9 à 13 ; UX-8 et UX-13 à 15. Sans salle tenue 24 h/24, les notifications (EXP-15) passent en refonte 1.
