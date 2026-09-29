#!/usr/bin/env node
/**
 * Bootstrap DeepL : traduit messages/fr.json (source) vers les autres langues du site
 * (messages/en.json, messages/nl.json) — à lancer à la main après avoir ajouté/modifié des
 * clés en français. Ne réécrit jamais une clé déjà traduite, sauf --force.
 *
 * Usage :  DEEPL_API_KEY=... node scripts/translate-messages.mjs [--force]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(dir, '..', 'messages');
const force = process.argv.includes('--force');

const DEEPL_KEY = process.env.DEEPL_API_KEY;
const DEEPL_HOST = DEEPL_KEY?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
// DeepL attend "EN-GB"/"EN-US" en cible mais "EN" seul en source ; NL est identique dans les deux sens.
const TARGET_LANG = { en: 'EN-GB', nl: 'NL' };

if (!DEEPL_KEY) {
  console.error('DEEPL_API_KEY manquante — voir deploy/.env.production.example');
  process.exit(1);
}

async function deeplTranslate(texts, target) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('text', t);
  body.set('source_lang', 'FR');
  body.set('target_lang', TARGET_LANG[target]);
  body.set('tag_handling', 'xml');
  body.set('ignore_tags', 'em');
  const res = await fetch(`${DEEPL_HOST}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.translations.map((t) => t.text);
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
function setPath(obj, key, value) {
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ??= {};
  cur[parts.at(-1)] = value;
}

const fr = JSON.parse(readFileSync(path.join(messagesDir, 'fr.json'), 'utf8'));
const frFlat = flatten(fr);

for (const locale of Object.keys(TARGET_LANG)) {
  const file = path.join(messagesDir, `${locale}.json`);
  let existing = {};
  try { existing = JSON.parse(readFileSync(file, 'utf8')); } catch { /* pas encore de fichier */ }
  const existingFlat = flatten(existing);

  const todoKeys = Object.keys(frFlat).filter((k) => force || !existingFlat[k]);
  console.log(`[${locale}] ${todoKeys.length} clé(s) à traduire sur ${Object.keys(frFlat).length}`);
  if (todoKeys.length === 0) continue;

  // DeepL free = 50 segments/appel confortable ; on lot par 50 pour rester large.
  const out = { ...existingFlat };
  for (let i = 0; i < todoKeys.length; i += 50) {
    const batch = todoKeys.slice(i, i + 50);
    const translated = await deeplTranslate(batch.map((k) => frFlat[k]), locale);
    batch.forEach((k, j) => { out[k] = translated[j]; });
  }

  const nested = {};
  for (const [k, v] of Object.entries(out)) setPath(nested, k, v);
  writeFileSync(file, JSON.stringify(nested, null, 2) + '\n', 'utf8');
  console.log(`[${locale}] écrit dans ${file}`);
}
