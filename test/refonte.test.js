// Démo de la refonte (public/refonte) : données synchronisées et modèle d'état du scénario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OUTPUT, renderModule } from '../scripts/refonte-demo-data.mjs';
import { stateAt, globalAt, thermalAt, T0, EVENT_BY_ID } from '../public/refonte/js/data.js';
import { CANAUX, RYTHMES, LUMINANCE, CHOREGRAPHIE, THERMIQUE, tempRGB } from '../public/refonte/js/grammaire.js';

test('world.js est à jour avec le monde de démonstration', () => {
  // fins de ligne normalisées : la CI Windows extrait les fichiers texte en CRLF
  assert.equal(fs.readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n'), renderModule(), 'relancer : node scripts/refonte-demo-data.mjs');
});

test('scénario : un incident = une ligne, conséquences regroupées sous la cause', () => {
  const s = stateAt(0);
  const root = s.roots.find((r) => r.id === 'esx08');
  assert.ok(root, 'cause racine présente');
  assert.equal(root.prio, 1);
  assert.equal(s.roots.filter((r) => r.obj === 'esx-par-08').length, 1);
  // après le redémarrage HA : 2 VM injoignables, 2 liens, 2 services interrompus, 3 dégradés
  assert.equal(root.children.length, 9);
  assert.deepEqual(s.counters, { 1: 1, 2: 2, 3: 3 });
  assert.equal(s.obj.get('esx-par-08'), 'root');
  assert.equal(s.obj.get('crm-db-01'), 'unreach');
  assert.equal(s.vmHost.get('app-portail-02'), 'esx-par-09');
});

test('scénario : avant la panne, seule l’alimentation PSU1 est signalée', () => {
  const s = stateAt(T0 - 30);
  assert.ok(s.roots.some((r) => r.id === 'psu1' && r.prio === 2));
  assert.ok(!s.roots.some((r) => r.id === 'esx08'));
  assert.equal(s.counters[1], 0);
});

test('scénario : la prise en charge retire l’alarme des compteurs, jamais en relecture passée', () => {
  const acks = { esx08: { by: 'test', comment: 'intervention', at: -10 } };
  assert.equal(stateAt(0, acks).counters[1], 0);
  assert.equal(stateAt(-20, acks).counters[1], 1, 'avant la prise en charge, l’alarme reste ouverte');
  assert.ok(EVENT_BY_ID.get('a04').ack, 'A04 est pris en charge par l’astreinte dans le scénario');
});

test('grammaire du conseil de production : un canal visuel = un seul sens', () => {
  assert.equal(new Set(CANAUX.map((c) => c.canal)).size, CANAUX.length, 'canal en double');
  assert.equal(new Set(CANAUX.map((c) => c.sens)).size, CANAUX.length, 'sens en double');
  // deux rythmes au plus, de fréquences distinctes : au-delà, l'œil ne sépare plus les sens
  assert.equal(RYTHMES.length, 2);
  assert.notEqual(RYTHMES[0].hz, RYTHMES[1].hz);
  assert.deepEqual(Object.keys(LUMINANCE), ['1', '2'], 'marge consommée : deux paliers de bleu seulement');
  assert.ok(CHOREGRAPHIE.recadrageApresInactiviteS >= 60, 'la caméra ne bouge jamais sous la main de l’opérateur');
  assert.ok(CHOREGRAPHIE.tempete.nouvellesCauses <= CHOREGRAPHIE.tempete.agregationAuDela);
});

test('état global : redondance, marge et inconnu suivent le scénario', () => {
  const niveaux = new Set(['tenue', 'mince', 'perdue']);
  for (const t of [T0 - 60, T0 + 10, 0]) {
    const g = globalAt(t);
    for (const r of g.redondance) assert.ok(niveaux.has(r.niveau), `${r.id} : ${r.niveau}`);
    for (const m of g.marge) assert.ok(m.niveau === 1 || m.niveau === 2, `${m.id} : palier ${m.niveau}`);
    assert.ok(g.horsRegime.length <= 8, 'huit défilements au plus');
  }
  const cl = (t) => globalAt(t).redondance.find((r) => r.id === 'CL-PROD-PAR').niveau;
  assert.equal(cl(T0 - 60), 'tenue');
  assert.equal(cl(0), 'perdue', 'réserve N+1 consommée par la reprise HA');
  assert.deepEqual(globalAt(0).perimes, ['lic-par-01']);
  assert.ok(globalAt(0).marge.some((m) => m.id === 'esx-par-07'), 'contention après la reprise HA');
  assert.ok(!globalAt(T0 - 60).marge.some((m) => m.id === 'esx-par-07'));
});

test('calque climat : échelle thermique ordonnée, bande ASHRAE dans le domaine', () => {
  const t = THERMIQUE.stops.map(([v]) => v);
  assert.deepEqual(t, [...t].sort((a, b) => a - b), 'paliers dans l’ordre des températures');
  assert.equal(t[0], THERMIQUE.domaine[0]); assert.equal(t.at(-1), THERMIQUE.domaine[1]);
  const [ra, rb] = THERMIQUE.ashrae.recommande;
  assert.ok(ra > THERMIQUE.domaine[0] && rb < THERMIQUE.domaine[1] && THERMIQUE.isotherme === rb);
  assert.deepEqual(tempRGB(-10), tempRGB(THERMIQUE.domaine[0]), 'bornée en dessous');
  assert.deepEqual(tempRGB(99), tempRGB(THERMIQUE.domaine[1]), 'bornée au-dessus');
  // l'extrémité chaude ne doit pas se confondre avec le rouge des alarmes P1 (#FF5A47)
  const [r, g, b] = tempRGB(40); assert.ok(r < 0.8 && g < 0.3 && b > 0.15);
});

test('calque climat : le modèle thermique raconte le scénario (dégivrage de CLIM 2, panne d’esx-par-08)', () => {
  const th = thermalAt(0);
  assert.equal(th.racks.A04.inlet[2], 28.4, 'sonde avant haute d’A04 = alarme A04');
  assert.ok(EVENT_BY_ID.get('a04').title.includes('28,4'));
  assert.equal(th.racks.A05.inlet[2], 25.8, 'A05 = marge consommée palier 1');
  const [c1, c2] = th.crac;
  assert.ok(th.degivrage && c2.debit < c1.debit && c2.soufflage > c1.soufflage);
  assert.ok(th.racks.A04.recirculation && !th.racks.A08.recirculation);
  for (const [id, r] of Object.entries(th.racks)) {
    if (!r.flux) { assert.equal(r.kw, 0, `${id} vide`); continue; }
    assert.ok(r.inlet[0] <= r.inlet[1] && r.inlet[1] <= r.inlet[2], `${id} : l’air se réchauffe vers le haut`);
    assert.ok(r.outlet > r.inlet[2], `${id} : la sortie est plus chaude que l’entrée`);
  }
  assert.ok(th.alleeChaude > th.ambiant && th.plafond < th.alleeChaude);
  assert.ok(thermalAt(T0 - 10).racks.A06.outlet > th.racks.A06.outlet, 'esx-par-08 éteint : A06 souffle moins chaud');
  assert.ok(thermalAt(-900).racks.A04.inlet[2] < 27 && !thermalAt(-900).degivrage, 'avant le dégivrage, A04 est dans la norme');
});
