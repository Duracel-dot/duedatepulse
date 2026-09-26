// Grammaire visuelle de l'état global, arrêtée par le conseil de production (docs/refonte/CONSEIL-PRODUCTION.md).
// Règle : un canal visuel = un seul sens. Une scène saine est immobile, opaque, doublée et sombre ;
// l'état global se lit dans les exceptions à ces quatre qualités.
export const CANAUX = [
  { canal: 'élévation', sens: 'niveau d’abstraction : physique, réseau, virtualisation, services', note: 'jamais une mesure' },
  { canal: 'teinte et forme', sens: 'sévérité d’une alarme', note: 'ivoire = interaction et traçage ; violet = temps non réel ; P3 absent du mur' },
  { canal: 'clignotement carré 1 Hz', sens: 'cause racine P1 non prise en charge', hz: 1, note: 'phases calées sur une horloge unique, luminance 100 % ↔ 45 %' },
  { canal: 'défilement orienté 0,5 Hz', sens: 'trafic sorti de son régime (secours actif, flux hors fenêtre)', hz: 0.5, note: 'liens seulement, 8 au plus, expire après 10 min ou à la prise en charge' },
  { canal: 'double trait', sens: 'redondance', note: 'double = tenue ; tireté = mince ; simple = perdue' },
  { canal: 'luminance (2 paliers de bleu)', sens: 'marge consommée : charge p95, jours avant saturation, température, contention, budget d’erreur', note: 'hystérésis, fondu de 2 s' },
  { canal: 'hachure à 45°', sens: 'inconnu : donnée périmée, injoignable, perte de supervision', note: 'toute la salle si le moteur se tait plus de 30 s' },
  { canal: 'glyphe statique', sens: 'intervention en cours : échafaudage = changement (avancement par instance) ; clé = maintenance déclarée', note: 'échafaudage en pointillé pendant 60 min d’observation' },
  { canal: 'atténuation (−30 % au plus)', sens: 'mise en retrait pendant un focus demandé', note: 'objets nominaux gris seulement, sur poste, jamais par transparence' },
];

export const RYTHMES = CANAUX.filter((c) => c.hz);

// deux paliers opaques, plus sombres que le rouge et l'ambre : en niveaux de gris, la marge ne crie jamais plus fort qu'une panne
export const LUMINANCE = { 1: '#46709C', 2: '#6690BE' };

export const CHOREGRAPHIE = {
  recadrageApresInactiviteS: 60,  // la caméra ne bouge seule que si personne ne la manipule
  recadrageMs: 400,               // recul sans rotation, salle entière + colonnes des causes P1
  ondeMs: 1000,                   // une seule onde au sol, à la naissance d'une cause P1, jamais au mur
  stratesMs: 400,
  tiroirMs: 350,
  refermerStratesApresS: 300,     // 5 min de stabilité après la dernière résolution
  cicatriceMin: 30,
  tempete: { nouvellesCauses: 3, fenetreS: 60, agregationAuDela: 7, retentionConsequencesS: 15 },
};
