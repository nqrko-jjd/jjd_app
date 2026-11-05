import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newContent, noiseReason, triageMail } from '../src/lib/mail-triage.js';

const h = (pairs: Record<string, string>) => Object.entries(pairs).map(([k, v]) => ({ key: k.toLowerCase(), line: `${k}: ${v}` }));
const mail = (o: Partial<Parameters<typeof noiseReason>[0]>) =>
  noiseReason({ headerLines: [], from: 'Jean Dupont <jean@exemple.be>', subject: '', body: '', hasAttachment: false, ...o });

test('réponses automatiques et retours d’erreur écartés', () => {
  assert.equal(mail({ subject: 'Réponse automatique : Demande de devis' }), 'auto_reply');
  assert.equal(mail({ subject: 'Out of Office', body: 'I am away' }), 'auto_reply');
  assert.equal(mail({ headerLines: h({ 'Auto-Submitted': 'auto-replied' }), subject: 'Re: chantier' }), 'auto_reply');
  assert.equal(mail({ from: 'MAILER-DAEMON@mx.exemple.be', subject: 'Failure' }), 'bounce');
  assert.equal(mail({ subject: 'Undeliverable: facture 123' }), 'bounce');
});

test('newsletter écartée, sauf si elle parle de demande, rappel ou chantier', () => {
  const list = h({ 'List-Unsubscribe': '<mailto:unsub@promo.be>' });
  assert.equal(mail({ headerLines: list, subject: 'Nos promos de novembre', body: 'Jusqu’à -30 % sur les outils' }), 'bulk');
  assert.equal(mail({ headerLines: h({ Precedence: 'bulk' }), subject: 'Webinar', body: 'Inscrivez-vous' }), 'bulk');
  assert.equal(mail({ headerLines: list, subject: 'Nouvelle demande de devis', body: 'Un client demande…' }), null);
  assert.equal(mail({ headerLines: list, subject: 'Herinnering', body: 'Factuur 2026-118 vervallen' }), null);
  assert.equal(mail({ headerLines: h({ 'Auto-Submitted': 'auto-generated' }), subject: 'Nieuwe aanvraag', body: '' }), null);
});

test('« merci » seul écarté, mais pas une confirmation qui contient une info', () => {
  assert.equal(mail({ body: 'Merci beaucoup, bonne journée\nJean' }), 'acknowledgement');
  assert.equal(mail({ body: 'Bien reçu, merci.\n\nLe 3 nov. 2026, David a écrit :\n> Voici le devis' }), 'acknowledgement');
  assert.equal(mail({ body: 'Goed ontvangen, bedankt' }), 'acknowledgement');
  assert.equal(mail({ body: 'OK pour mardi' }), null);
  assert.equal(mail({ body: 'Merci, on se voit à 10h' }), null);
  assert.equal(mail({ body: 'Merci, la fuite est revenue' }), null);
  assert.equal(mail({ body: 'Merci', hasAttachment: true }), null);
});

test('mail ordinaire jamais écarté sans IA', () => {
  assert.equal(mail({ subject: 'Question', body: 'Pouvez-vous passer voir la porte de garage qui ne ferme plus ?' }), null);
});

test('newContent coupe la citation et la signature', () => {
  assert.equal(newContent('Bonjour\nC’est noté\n-- \nJean\n> ancien'), 'Bonjour\nC’est noté');
  assert.equal(newContent('Ok\n\nOn Mon, Nov 2, 2026 at 9:00 David wrote:\nblabla'), 'Ok');
});

const fakeClient = (reply: string | Error) => ({
  messages: { create: async () => { if (reply instanceof Error) throw reply; return { content: [{ type: 'text', text: reply }] }; } },
}) as never;
const m = { from: 'a@b.be', subject: 's', body: 'b', attachments: [] };

test('premier tri : lit la réponse, et retombe sur l’analyse complète en cas d’échec', async () => {
  assert.deepEqual(await triageMail(fakeClient('{"actionable": false, "needsAttachment": false}'), 'x', m), { actionable: false, needsAttachment: false });
  assert.deepEqual(await triageMail(fakeClient('{"actionable": true}'), 'x', m), { actionable: true, needsAttachment: true });
  assert.equal(await triageMail(fakeClient(new Error('model not found')), 'x', m), null);
  assert.equal(await triageMail(fakeClient('pas de json'), 'x', m), null);
  assert.equal(await triageMail(null, 'x', m), null);
});
