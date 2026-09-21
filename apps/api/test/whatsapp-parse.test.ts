import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatsAppChat, cleanWhatsAppName } from '../src/lib/whatsapp-import.js';

test('export Android : « d/mm/yy, hh:mm - Nom: message » + fichier joint', () => {
  const msgs = parseWhatsAppChat([
    '8/09/26, 10:31 - Julien: Bonjour',
    'suite du message',
    '8/09/26, 10:32 - Julien: IMG-20260908-WA0001.jpg (fichier joint)',
    '8/09/26, 10:33 - Les messages et les appels sont chiffrés de bout en bout.',
  ].join('\n'));
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0]!.author, 'Julien');
  assert.equal(msgs[0]!.body, 'Bonjour\nsuite du message');
  assert.equal(msgs[1]!.attach, 'IMG-20260908-WA0001.jpg');
  assert.equal(msgs[2]!.author, null);
});

test('export iPhone : « [d/mm/yy hh:mm:ss] Nom: message » avec marques directionnelles', () => {
  const msgs = parseWhatsAppChat([
    '‎[17/09/26 15:40:12] R-853: ‎Les messages et les appels sont chiffrés de bout en bout.',
    '[17/09/26 15:44:01] ~ Josephine: Bonjour ici demain',
    '[17/09/26 15:46:52] ~ Josephine: ‎<pièce jointe : 00000036-PHOTO-2026-09-17-15-46-52.jpg>',
  ].join('\n'));
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0]!.author, null); // ligne système portant le nom du groupe
  assert.equal(msgs[1]!.body, 'Bonjour ici demain');
  assert.equal(msgs[1]!.at.toISOString(), '2026-09-17T15:44:01.000Z');
  assert.equal(msgs[2]!.attach, '00000036-PHOTO-2026-09-17-15-46-52.jpg');
  assert.equal(msgs[2]!.body, '');
  assert.equal(cleanWhatsAppName(msgs[1]!.author!), 'Josephine');
});

test('export iPhone : légende avant la pièce jointe conservée comme texte', () => {
  const [m] = parseWhatsAppChat('[17/09/26 15:46:52] Josephine: Bonjour ici demain merci ‎<pièce jointe : 00000036-PHOTO-2026-09-17-15-46-52.jpg>');
  assert.equal(m!.attach, '00000036-PHOTO-2026-09-17-15-46-52.jpg');
  assert.equal(m!.body, 'Bonjour ici demain merci');
});
