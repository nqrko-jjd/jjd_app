import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToReadable, isPrivateAddress } from '../src/lib/web-reader.js';

test('adresses privées refusées, publiques acceptées', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.0.4', '172.20.0.1', '169.254.1.1', '::1', '::ffff:10.0.0.1', 'fd00::1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '136.144.209.157', '2a00:1450::1']) assert.equal(isPrivateAddress(ip), false, ip);
});
test('HTML en texte lisible : titre, texte principal, liens absolus, sans menus ni scripts', () => {
  const r = htmlToReadable('<title>A &amp; B</title><nav>menu</nav><main><h2>Prix</h2><p>99 € <a href="/tarifs">tarifs</a></p><script>x()</script></main>', 'https://ex.be/p');
  assert.equal(r.titre, 'A & B');
  assert.match(r.texte, /## Prix\n99 € tarifs/);
  assert.ok(!/menu|x\(\)/.test(r.texte));
  assert.deepEqual(r.liens, [{ texte: 'tarifs', url: 'https://ex.be/tarifs' }]);
});
