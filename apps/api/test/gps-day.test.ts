import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteVisit, summarizeDay } from '../src/lib/gps-day.js';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
const P = (h: number, m: number, lat: number, speed: number) => ({ lat, lng: 4.4, at: t(h, m), speed });

test('journée vide : aucun résumé inventé', () => {
  const s = summarizeDay([]);
  assert.equal(s.points, 0); assert.equal(s.stoppedSince, null); assert.equal(s.km, 0);
});

test('arrêté depuis le dernier déplacement, kilomètres cumulés, bruit GPS ignoré', () => {
  const s = summarizeDay([
    P(7, 0, 50.800, 0), P(7, 10, 50.810, 40), P(7, 20, 50.830, 50), P(7, 30, 50.8301, 0), // arrêt à 7h30
    P(7, 31, 50.83011, 0), P(7, 32, 50.83012, 0),
  ]);
  assert.equal(s.firstMoveAt, t(7, 10).toISOString());
  assert.equal(s.stoppedSince, t(7, 30).toISOString());
  assert.equal(s.noMoveToday, false);
  assert.ok(s.km > 3 && s.km < 4, `km=${s.km}`); // ≈ 3,3 km (0,03° de latitude)
});

test('véhicule en route : pas d’immobilisation', () => {
  const s = summarizeDay([P(8, 0, 50.8, 0), P(8, 5, 50.81, 30)]);
  assert.equal(s.stoppedSince, null);
});

test('jamais bougé aujourd’hui : arrêté depuis le premier signal', () => {
  const s = summarizeDay([P(8, 0, 50.65767, 0), P(8, 1, 50.65767, 0)]);
  assert.equal(s.noMoveToday, true);
  assert.equal(s.stoppedSince, t(8, 0).toISOString());
  assert.equal(s.km, 0);
});

test('tracé limité à ~400 points, dernier point conservé', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => ({ lat: 50 + i * 0.0001, lng: 4.4, at: new Date(Date.UTC(2026, 10, 2, 6) + i * 10_000), speed: 30 }));
  const s = summarizeDay(pts);
  assert.ok(s.track.length <= 420);
  assert.equal(s.track[s.track.length - 1][0], pts[pts.length - 1].lat);
});

test('arrivée chantier : premier arrêt dans le rayon, simple passage ignoré, départ détecté', () => {
  const site = { lat: 50.85, lng: 4.4 };
  const v = siteVisit([
    P(7, 0, 50.80, 0), P(7, 20, 50.85, 40), // passage à vitesse normale devant le chantier : pas une arrivée
    P(7, 40, 50.8503, 0),                   // arrêt à ~33 m du chantier : arrivée
    P(9, 0, 50.8503, 0), P(9, 10, 50.86, 30), // départ
  ], site);
  assert.equal(v.arrivedAt, t(7, 40).toISOString());
  assert.equal(v.leftAt, t(9, 10).toISOString());
});

test('arrivée chantier : jamais venu', () => {
  assert.deepEqual(siteVisit([P(8, 0, 50.7, 0)], { lat: 50.85, lng: 4.4 }), { arrivedAt: null, leftAt: null });
});

test('arrêts de la journée : durée minimale, veille comptée, arrêt en cours sans fin', () => {
  const s = summarizeDay([
    P(7, 0, 50.80, 0), P(7, 1, 50.80, 0), P(7, 2, 50.8, 0),           // 3 min seulement : pas un arrêt
    P(7, 3, 50.81, 40),                                               // en route
    P(8, 0, 50.85, 0), P(11, 30, 50.85, 30),                          // arrêt 8h00 → 11h30 (le traceur dormait entre les deux)
    P(12, 0, 50.9, 0), P(12, 20, 50.9, 0),                            // arrêt en cours depuis 12h00
  ]);
  assert.equal(s.stops.length, 2);
  assert.equal(s.stops[0]!.from, t(8, 0).toISOString());
  assert.equal(s.stops[0]!.to, t(11, 30).toISOString());
  assert.equal(s.stops[1]!.from, t(12, 0).toISOString());
  assert.equal(s.stops[1]!.to, null);
});
