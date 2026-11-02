import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDay } from '../src/lib/gps-day.js';

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
