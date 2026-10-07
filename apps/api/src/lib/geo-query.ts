/**
 * Requêtes de géocodage à partir de l'adresse d'un chantier. Beaucoup d'adresses ont été saisies AVANT le contrôle d'adresse du formulaire :
 * tout dans une seule ligne (« Rue de Menin 53, 1080 Molenbeek »), code postal / ville vides, « bte 3 » ou étage collés au numéro…
 * On accepte ces formes, mais on refuse les adresses ambiguës (une rue sans aucune commune) : un point faux fausserait le contrôle de pointage.
 */
export interface GeoAddress {
  address: string | null;
  postalCode: string | null;
  city: string | null;
  acp?: { address: string | null; postalCode: string | null; city: string | null } | null;
}

const POSTAL = /\b[1-9]\d{3}\b/;

export function buildGeoQueries(a: GeoAddress): { queries: string[]; postal: string | null } | null {
  const raw = (a.address || a.acp?.address || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  // « bte 3 », « app 2.2 », « étage 1 »… sont inconnus d'OpenStreetMap et font échouer la recherche
  const street = raw.replace(/[,\s]*(?<![A-Za-zÀ-ÿ])(bte|bt|boite|boîte|box|app|appt|appartement|étage|etage)(?![A-Za-zÀ-ÿ])\.?[^,]*/gi, '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  if (!street) return null;
  const city = (a.city || a.acp?.city || '').trim() || null;
  const postal = (a.postalCode || a.acp?.postalCode || '').trim() || POSTAL.exec(street)?.[0] || null;
  // une rue seule, sans code postal, ni ville, ni « , Commune » : trop ambigu en Belgique
  const hasLocality = !!(postal || city || /,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{2,}$/.test(street));
  if (!hasLocality) return null;

  const lower = street.toLowerCase();
  const townPart = [
    postal && !street.includes(postal) ? postal : null,
    city && !lower.includes(city.toLowerCase()) ? city : null,
  ].filter(Boolean).join(' ');
  const full = [street, townPart, 'Belgique'].filter(Boolean).join(', ');
  const queries = [full];
  // le code postal d'OpenStreetMap diffère parfois : seconde chance avec la commune seule
  if (postal && city) {
    const alt = [street.replace(postal, '').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/[,\s]+$/g, '').trim(), city, 'Belgique'].join(', ');
    if (alt !== full) queries.push(alt);
  }
  return { queries, postal };
}

/** Le résultat d'OpenStreetMap doit être dans le bon code postal : s'il en annonce un autre, c'est un homonyme (même rue dans une autre commune). */
export function labelFitsPostal(label: string, postal: string | null): boolean {
  if (!postal) return true;
  const codes = label.match(/\b[1-9]\d{3}\b/g);
  return !codes || codes.includes(postal);
}
