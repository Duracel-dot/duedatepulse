// Démo de la refonte (public/refonte) : données synchronisées et modèle d'état du scénario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OUTPUT, renderModule } from '../scripts/refonte-demo-data.mjs';
import { stateAt, T0, EVENT_BY_ID } from '../public/refonte/js/data.js';

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
