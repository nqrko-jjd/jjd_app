/**
 * Recherche d'une entreprise par n° de TVA via VIES (VAT Information Exchange System,
 * service officiel et gratuit de la Commission européenne — pas de clé requise).
 * Limité à la Belgique pour l'instant (c'est la quasi-totalité des contacts JJD).
 *
 * Le point d'accès belge répond parfois "MS_MAX_CONCURRENT_REQ" (surcharge temporaire,
 * pas une vraie erreur) -> quelques tentatives avec un court délai avant d'abandonner.
 */

export interface ViesCompany {
  vatNumber: string; // "BE0850775221"
  name: string | null;
  address: string | null; // rue + n°
  postalCode: string | null;
  city: string | null;
}

const RETRYABLE = new Set(['MS_MAX_CONCURRENT_REQ', 'MS_UNAVAILABLE', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'SERVER_BUSY']);

/** "Gieterijstraat 49\n1601 Sint-Pieters-Leeuw" -> rue/n°, code postal, ville. */
export function splitAddress(raw: string | null): { address: string | null; postalCode: string | null; city: string | null } {
  if (!raw || raw === '---') return { address: null, postalCode: null, city: null };
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const address = lines[0] ?? null;
  const cityLine = lines[1] ?? '';
  const m = cityLine.match(/^(\d{4})\s+(.+)$/); // code postal belge : 4 chiffres
  return {
    address,
    postalCode: m ? m[1]! : null,
    city: m ? m[2]!.trim() : cityLine.trim() || null,
  };
}

export async function lookupBelgianVat(vatNumberRaw: string): Promise<ViesCompany | { error: string }> {
  const clean = vatNumberRaw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const m = clean.match(/^BE?(\d{9,10})$/);
  if (!m) return { error: 'N° de TVA belge invalide (attendu : BE + 9 ou 10 chiffres).' };
  const digits = m[1]!.padStart(10, '0');

  interface ViesResponse { isValid?: boolean; userError?: string; name?: string; address?: string }
  const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BE/vat/${digits}`;

  async function attemptOnce(): Promise<ViesResponse | null> {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      return r.ok ? ((await r.json()) as ViesResponse) : null;
    } catch {
      return null;
    }
  }

  let lastError = 'Service VIES indisponible, réessaie dans un instant.';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const json = await attemptOnce();
    if (!json) continue;
    if (json.userError && json.userError !== 'VALID') {
      if (RETRYABLE.has(json.userError)) { lastError = 'Service VIES temporairement surchargé, réessaie dans un instant.'; continue; }
      return { error: `N° de TVA introuvable (${json.userError}).` };
    }
    if (!json.isValid) return { error: 'N° de TVA non valide selon VIES.' };
    const { address, postalCode, city } = splitAddress(json.address ?? null);
    return {
      vatNumber: `BE${digits}`,
      name: json.name && json.name !== '---' ? json.name : null,
      address, postalCode, city,
    };
  }
  return { error: lastError };
}
