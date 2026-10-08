import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWorksite, distinctiveTokens, type WsCandidate } from '../src/lib/worksite-guess.js';

const ws: WsCandidate[] = [
  { id: 'a', ref: 'R-877', text: 'R-877 Woluwe - ACP Champs Elysées - Baltimo - SERENELLI - B-BUR-0 ACP Champs Elysées Avenue Général de Longueville 22' },
  { id: 'b', ref: 'R-807', text: 'R-807 Woluwe - ACP CHAMPS ELYSEES - Enlever plafonnage ACP Champs Elysées Avenue Général de Longueville 20' },
  { id: 'c', ref: 'R-813', text: 'R-813 Wolluwe - Baltimo - ACP CHAMPS ELYSEES - Fuite d\'eau garage privé Cathal Av général de longueville 17-18' },
  { id: 'd', ref: 'R-869', text: 'R-869 ACP Edison - Baltimo - Fuite urgente ACP Edison Rue de Fierlant 15/19' },
];

test('mots distinctifs : sans accents, sans mots courants', () => {
  const t = distinctiveTokens(['Fwd: ACP CHAMPS ELYSEE - Fuite appartement Mr SERENELLI - B-BUR-0 ( étage -1 )']);
  assert.ok(t.includes('champs') && t.includes('elysee') && t.includes('serenelli'));
  assert.ok(!t.includes('fuite') && !t.includes('acp') && !t.includes('fwd'));
});

test('le mail du syndic retrouve le chantier au nom du locataire, pas un autre chantier de la même copropriété', () => {
  assert.equal(pickWorksite(['Fwd: ACP CHAMPS ELYSEE - Fuite appartement Mr SERENELLI - B-BUR-0 ( étage -1 )'], ws), 'a');
});

test('référence R-xxx citée : prioritaire ; plusieurs chantiers aussi plausibles : rien proposé', () => {
  assert.equal(pickWorksite(['RE: R-869 - ACP Edison'], ws), 'd');
  assert.equal(pickWorksite(['Demande pour ACP Champs Elysées'], ws), null);
  assert.equal(pickWorksite(['Tout autre sujet sans rapport'], ws), null);
});
