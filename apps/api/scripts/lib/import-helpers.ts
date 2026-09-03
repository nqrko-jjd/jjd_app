import { normalizeName } from '@jjd/shared';

/** Extrait le syndic d'un nom de contact : « ACP Iris (c/o Baltimo) » -> « Baltimo ». */
export function extractSyndic(name: string): { base: string; syndic: string | null } {
  const m = name.match(/^(.*?)[\s(–-]*c\/o\s+([^)]+?)\)?\s*$/i);
  if (m) {
    return { base: m[1]!.replace(/[\s(–-]+$/, '').trim(), syndic: m[2]!.trim() };
  }
  return { base: name.trim(), syndic: null };
}

/** Devine le type de client d'après son nom. */
export function guessClientKind(name: string): string {
  const s = name.toLowerCase();
  if (/\bacp\b|copropri|\bvme\b/.test(s)) return 'acp';
  if (/syndic|baltimo|kadaner|citya|serenity/.test(s)) return 'syndic';
  if (/\b(srl|sprl|sa|nv|bv|bvba|scrl|asbl)\b/.test(s)) return 'company';
  if (/commune|ville de|cpas|région|region/.test(s)) return 'public';
  return 'individual';
}

/** Un cache de dédoublonnage : renvoie l'id existant pour un nom normalisé, ou null. */
export class DedupeMap {
  private map = new Map<string, string>();
  key(name: string): string {
    return normalizeName(name);
  }
  get(name: string): string | null {
    return this.map.get(this.key(name)) ?? null;
  }
  set(name: string, id: string): void {
    this.map.set(this.key(name), id);
  }
  has(name: string): boolean {
    return this.map.has(this.key(name));
  }
}

export function str(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === '-' || s === '?' || s === '/' || s === '=' ? null : s;
}

const REF_RE = /^(R-|E-)\s*\d+/i;
export function looksLikeRef(s: string | null): boolean {
  return !!s && REF_RE.test(s);
}

export function num(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
