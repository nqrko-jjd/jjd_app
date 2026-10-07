import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLineHtml } from '../src/lib/sanitize.js';

test('sanitizeLineHtml : conserve le gras/italique/souligné', () => {
  assert.equal(sanitizeLineHtml('<b>Nettoyage</b> <i>façade</i> <u>pierre</u>'), '<b>Nettoyage</b> <i>façade</i> <u>pierre</u>');
});

test('sanitizeLineHtml : conserve <font color> (sortie réelle de execCommand foreColor sous Chromium)', () => {
  assert.equal(sanitizeLineHtml('<font color="#ad4a41">façade</font>'), '<font color="#ad4a41">façade</font>');
});

test('sanitizeLineHtml : rejette une valeur de couleur qui n’est pas une couleur (attribut simple, non validé par allowedStyles)', () => {
  assert.equal(sanitizeLineHtml('<font color="javascript:alert(1)">x</font>'), '<font>x</font>');
});

test('sanitizeLineHtml : conserve <span style="color/font-size"> dans les formats autorisés', () => {
  assert.equal(
    sanitizeLineHtml('<span style="color: rgb(1,2,3); font-size: 14px;">x</span>'),
    '<span style="color:rgb(1,2,3);font-size:14px">x</span>',
  );
});

test('sanitizeLineHtml : supprime script/on* et le style non autorisé', () => {
  const dirty = '<script>alert(1)</script><span onclick="alert(1)" style="position:fixed">x</span><img src=x onerror=alert(1)>';
  const clean = sanitizeLineHtml(dirty);
  assert.doesNotMatch(clean, /script|onclick|onerror|position/i);
  assert.match(clean, /<span>x<\/span>/);
});

test('sanitizeLineHtml : le texte brut sans balise passe inchangé (rétrocompat des anciennes lignes)', () => {
  assert.equal(sanitizeLineHtml('Nettoyage façade'), 'Nettoyage façade');
});

test('sanitizeLineHtml : conserve listes à puces/numérotées et le barré', () => {
  const html = '<ul><li>Un</li><li>Deux</li></ul><ol><li>Un</li></ol><strike>ancien prix</strike><s>autre</s>';
  assert.equal(sanitizeLineHtml(html), html);
});

test('sanitizeLineHtml : les lignes de l’éditeur (<div> de Chromium) deviennent des sauts de ligne, pas un seul bloc de texte', () => {
  assert.equal(sanitizeLineHtml('Installation<div>Percement</div><div>Pose du WC</div>'), 'Installation<br />Percement<br />Pose du WC');
  assert.equal(sanitizeLineHtml('a<div>b</div><div><br></div><div>c</div>'), 'a<br />b<br /><br />c');
  assert.equal(sanitizeLineHtml('<div>un</div><div>deux</div>'), 'un<br />deux');
  assert.equal(sanitizeLineHtml('<p>un</p><p>deux</p>'), 'un<br />deux');
  assert.equal(sanitizeLineHtml('ligne 1<br>ligne 2'), 'ligne 1<br />ligne 2');
  assert.equal(sanitizeLineHtml('<ul><li>a</li></ul><div>b</div>'), '<ul><li>a</li></ul>b');
});
