import sanitizeHtml from 'sanitize-html';
import { zipSync, strToU8 } from 'fflate';

/**
 * Cahier des charges (CDC) d'un chantier, généré depuis le devis puis édité à la main.
 * But : cadenasser ce qui est compris ou non, la finition attendue et le choix des produits — pas un descriptif d'architecte.
 * Contenu structuré (JSON) : sections de blocs (paragraphe, liste, tableau, remarque). Les points laissés en blanc commencent par « [À compléter ».
 */
export type CdcBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'note'; text: string };
export interface CdcSection { id: string; title: string; blocks: CdcBlock[] }
export interface CdcMeta {
  title: string; reference: string; clientName: string; clientAddress: string; worksiteAddress: string;
  quoteRef: string; quoteDate: string; generatedAt: string;
}
export interface CdcContent { meta: CdcMeta; sections: CdcSection[] }

export interface CdcInput {
  worksite: { ref: string; title: string; address: string | null; postalCode: string | null; city: string | null };
  client: { name: string; address: string | null; postalCode: string | null; city: string | null } | null;
  quote: { number: string | null; issuedOn: Date | null; totalHt: number; title: string | null; lines: { kind: string; label: string; description: string | null; qty: number; unit: string | null; totalHt: number }[] };
}

const TODO = '[À compléter';
export const todoCount = (c: CdcContent) => {
  let n = 0;
  const scan = (s: string) => { if (s.includes(TODO)) n++; };
  for (const sec of c.sections) for (const b of sec.blocks) {
    if (b.type === 'p' || b.type === 'note') scan(b.text);
    else if (b.type === 'ul') b.items.forEach(scan);
    else b.rows.forEach((r) => r.forEach(scan));
  }
  return n;
};

/** Texte brut d'une description de ligne de devis (HTML saisi dans l'éditeur du devis). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  const withBreaks = html.replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n');
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const eurTxt = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });
const dateTxt = (d: Date | null) => (d ? d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' }) : '');
const qtyTxt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));
const addr = (a: string | null, pc: string | null, city: string | null) => [a, [pc, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * Règles par mot-clé : un poste du devis qui parle de carrelage, de peinture, de châssis… déclenche (1) le choix de produit à faire valider
 * par le maître d'ouvrage et (2) les exclusions habituelles de ce corps de métier. C'est ce qui évite « je pensais que c'était compris ».
 */
export interface TradeRule { re: RegExp; trade: string; choice: string; excludes: string[] }
export const TRADE_RULES: TradeRule[] = [
  { re: /carrel|faïenc|faienc|dallage|mosa[iï]que/i, trade: 'Carrelage / faïence', choice: 'Carrelage / faïence : gamme, format, teinte, joints (référence et prix au m² retenus)', excludes: [
    'Fourniture des carreaux au-delà du prix au m² prévu au devis (le surcoût d’un choix plus cher est à charge du maître d’ouvrage)',
    'Pose en diagonale, calepinage particulier, formats supérieurs à 60 × 60 cm ou pièces de découpe spéciales, sauf mention contraire',
    'Chape ou ragréage supplémentaire pour rattraper un support irrégulier découvert à l’exécution'] },
  { re: /peintur|enduit|lissage|crépi intérieur|tapiss/i, trade: 'Peinture / enduits', choice: 'Peinture : teinte (référence RAL / NCS), aspect (mat, satiné) et nombre de couches', excludes: [
    'Peinture des éléments non cités au devis (radiateurs, boiseries, plinthes existantes, escaliers…)',
    'Rebouchage important, décapage ou remise à niveau de supports dégradés au-delà de l’état normal',
    'Changement de teinte demandé après le début des travaux'] },
  { re: /châssis|chassis|fenêtre|fenetre|\bportes?\b|menuiser|vitrage|velux|lanterneau/i, trade: 'Menuiseries', choice: 'Menuiseries : matériau, coloris extérieur / intérieur, vitrage, quincaillerie et sens d’ouverture', excludes: [
    'Volets, stores, moustiquaires et protections solaires, sauf mention contraire',
    'Adaptation ou agrandissement des ouvertures existantes non prévus au devis',
    'Remplacement des appuis de fenêtre et seuils existants dégradés, sauf mention contraire'] },
  { re: /crépi|crepi|etics|façade|facade|isolation par l['’]ext/i, trade: 'Façade / ETICS', choice: 'Façade : épaisseur et type d’isolant, teinte et grain du crépi', excludes: [
    'Échafaudage sur domaine public ou autorisation communale d’occupation de la voie publique, sauf mention contraire',
    'Traitement de fissures structurelles ou de supports instables découverts à l’exécution',
    'Remplacement ou déplacement d’éléments fixés en façade (câbles, boîtes, éclairages), sauf mention contraire'] },
  { re: /toiture|\btoits?\b|étanchéité|etancheite|roofing|epdm|zinc|ardoise|tuile|gouttière|gouttiere/i, trade: 'Toiture / étanchéité', choice: 'Toiture : complexe d’étanchéité / couverture, isolant et accessoires (rives, avaloirs, évacuations)', excludes: [
    'Remplacement de charpente, panneaux de support ou éléments de structure dégradés découverts à l’exécution (devis complémentaire)',
    'Travaux sur les toitures voisines ou mitoyennes',
    'Panneaux photovoltaïques, antennes et équipements en toiture, sauf mention contraire'] },
  { re: /électri|electri|luminaire|tableau|\bprises?\b|interrupt|rgie|éclairage|eclairage/i, trade: 'Électricité', choice: 'Électricité : gamme d’appareillage (prises, interrupteurs), type de luminaires fournis ou non', excludes: [
    'Mise en conformité RGIE de l’installation existante non concernée par les travaux (la visite de contrôle est à charge du maître d’ouvrage)',
    'Luminaires décoratifs, appareils domotiques et appareillage de gamme supérieure, sauf mention contraire',
    'Modification de la puissance ou du compteur auprès du gestionnaire de réseau'] },
  { re: /sanitaire|plomberie|\bwc\b|douche|baignoire|lavabo|salle de bain|robinet|chauffe|chauffage|radiateur/i, trade: 'Plomberie / sanitaire / chauffage', choice: 'Sanitaire : marque, modèle et finition des appareils et de la robinetterie', excludes: [
    'Appareils sanitaires, meubles de salle de bain et accessoires hors gamme prévue au devis',
    'Remplacement de canalisations existantes (alimentation, évacuation, chauffage) non visibles ou non citées, sauf mention contraire',
    'Raccordement au réseau public d’égouttage et à la distribution d’eau (démarches et frais de la compagnie)'] },
  { re: /cuisine/i, trade: 'Cuisine', choice: 'Cuisine : meubles, plan de travail, électroménager et robinetterie (fournis par qui, quelle gamme)', excludes: [
    'Électroménager et meubles non fournis par JJD Consult, sauf mention contraire',
    'Adaptation des alimentations et évacuations à un plan de cuisine modifié après commande'] },
  { re: /isolation|isolant|laine|\b(?:pir|xps|eps)\b|pare-vapeur/i, trade: 'Isolation', choice: 'Isolation : type, épaisseur et valeur R / λ de l’isolant', excludes: [
    'Étude thermique, certificat PEB et démarches de primes, sauf mention contraire',
    'Traitement de l’humidité ou de moisissures préexistantes dans les supports'] },
  { re: /plafond|cloison|gyproc|plaque|placo|ossature/i, trade: 'Plafonds / cloisons', choice: 'Cloisons / plafonds : type de plaques, niveau de finition (joints bandés, enduit complet), isolation acoustique', excludes: [
    'Renforts de fixation pour charges lourdes (meubles suspendus, TV…) non prévus au devis',
    'Finition de peinture, sauf poste dédié au devis'] },
  { re: /parquet|\bsols?\b|chape|plinthe|vinyle|stratifi|moquette|ragréage|ragreage/i, trade: 'Revêtements de sol', choice: 'Revêtement de sol : type, gamme, teinte et plinthes assorties', excludes: [
    'Préparation de support au-delà d’un ragréage normal (réparation de dalle, assèchement, traitement d’humidité)',
    'Seuils, barres de seuil et finitions entre pièces non cités au devis'] },
  { re: /démoli|demoli|dépose|depose|déposer|curage|piquage|évacuation|evacuation/i, trade: 'Démolition / dépose', choice: '', excludes: [
    'Désamiantage : tout matériau amianté découvert fait l’objet d’une procédure et d’un devis spécifiques, hors offre',
    'Évacuation de déchets non cités ou supérieurs aux volumes estimés au devis',
    'Remise en état d’éléments cachés (conduites, câbles, structures) endommagés par un état antérieur non visible'] },
  { re: /terrass|jardin|abords|\bpav[ée]s?\b|klinker|drain|égout|egout|citerne|fosse/i, trade: 'Extérieur / terrassement / égouttage', choice: 'Extérieur : revêtements, pentes et finitions des abords (matériaux retenus)', excludes: [
    'Évacuation de terres excédentaires au-delà du volume prévu au devis',
    'Remise en état des plantations, pelouses et mobilier de jardin',
    'Découverte de pollution des sols, de vestiges ou de réseaux non repérés (devis complémentaire)'] },
  { re: /maçonner|macon|gros œuvre|gros oeuvre|béton|beton|fondation|linteau|\bipn\b|poutre/i, trade: 'Gros œuvre / maçonnerie', choice: '', excludes: [
    'Étude de stabilité et dimensionnement des éléments porteurs, sauf mention contraire (à fournir par un ingénieur)',
    'Fondations et sous-sol supplémentaires si le sol ne correspond pas aux hypothèses'] },
];

export const GENERAL_EXCLUSIONS = [
  'Permis d’urbanisme, autorisations communales et toute démarche administrative, sauf mention contraire',
  'Honoraires d’architecte, d’ingénieur en stabilité, de coordinateur sécurité-santé, de conseiller PEB et de bureau d’études, sauf mention contraire',
  'Raccordements et déplacements de compteurs auprès des gestionnaires de réseau (eau, gaz, électricité, télécom, égouts)',
  'Désamiantage et traitement de tout matériau dangereux ou pollué découvert en cours de chantier',
  'Mobilier, électroménager, luminaires décoratifs et décoration, sauf mention contraire',
  'Dégradations, vices ou éléments cachés de l’existant découverts à l’exécution : ils font l’objet d’un devis complémentaire avant toute intervention',
  'Tout travail non décrit dans le présent cahier des charges ou dans le devis',
  'Les postes marqués « option » au devis, tant qu’ils n’ont pas été acceptés par écrit',
];

const STANDARD_INCLUDED = [
  'Fourniture et pose des matériaux décrits, sauf mention contraire',
  'Petites fournitures et consommables courants (colles, vis, chevilles, joints, visserie)',
  'Protection des éléments existants à conserver (sols, menuiseries, mobilier proche) pendant les travaux',
  'Évacuation des déchets de chantier courants et nettoyage de fin de chantier',
  'Les adaptations mineures de mise en œuvre imposées par la réalité du terrain',
];

const isOption = (label: string) => /^\s*(option|variante)\b/i.test(label);

interface Lot { title: string; intro: string; items: CdcInput['quote']['lines']; texts: string[] }

function groupLots(lines: CdcInput['quote']['lines']): Lot[] {
  const lots: Lot[] = [];
  let cur: Lot | null = null;
  for (const l of lines) {
    if (l.kind === 'section') { cur = { title: l.label.trim(), intro: htmlToText(l.description), items: [], texts: [] }; lots.push(cur); continue; }
    if (!cur) { cur = { title: 'Travaux', intro: '', items: [], texts: [] }; lots.push(cur); }
    if (l.kind === 'text') { const t = htmlToText(l.description) || l.label; if (t.trim()) cur.texts.push(t.trim()); continue; }
    cur.items.push(l);
  }
  return lots.filter((l) => l.items.length > 0 || l.texts.length > 0 || l.intro);
}

const slug = (s: string, i: number) => `s${i}-${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;

export function buildCdc(input: CdcInput): CdcContent {
  const { worksite: w, client, quote } = input;
  const wAddr = addr(w.address, w.postalCode, w.city);
  const quoteRef = quote.number ?? 'brouillon';
  const meta: CdcMeta = {
    title: w.title, reference: w.ref, clientName: client?.name ?? '', clientAddress: client ? addr(client.address, client.postalCode, client.city) : '',
    worksiteAddress: wAddr, quoteRef, quoteDate: dateTxt(quote.issuedOn), generatedAt: new Date().toISOString(),
  };
  const sections: CdcSection[] = [];
  const push = (title: string, blocks: CdcBlock[]) => sections.push({ id: slug(title, sections.length), title, blocks });

  push('Contexte et objet du dossier', [
    { type: 'p', text: `Le présent cahier des charges décrit les travaux à réaliser ${wAddr ? `à ${wAddr}` : 'sur le chantier'} (réf. ${w.ref} — ${w.title})${client ? ` pour le compte de ${client.name}` : ''}.` },
    { type: 'p', text: `Il a pour fonction de préciser le périmètre exact des interventions, les produits et finitions attendus, ainsi que ce qui est compris ou non dans l’offre ${quote.number ? `n° ${quote.number}` : 'de JJD Consult'}${quote.issuedOn ? ` du ${dateTxt(quote.issuedOn)}` : ''}, afin d’éviter toute ambiguïté d’interprétation des postes du devis.` },
    { type: 'p', text: `[À compléter : contexte du projet, état actuel du bâtiment et objectif du maître d’ouvrage en quelques lignes]` },
  ]);

  push('Documents de référence', [
    { type: 'ul', items: [
      `Devis JJD Consult ${quoteRef}${quote.issuedOn ? ` du ${dateTxt(quote.issuedOn)}` : ''} — ${eurTxt(quote.totalHt)} HTVA`,
      '[À compléter : plans, photos de l’état existant, comptes rendus de réunion, avis de l’architecte ou de l’ingénieur]',
      'Prescriptions techniques des fabricants des produits mis en œuvre',
    ] },
  ]);

  push('Bases techniques et règles de mise en œuvre', [
    { type: 'p', text: 'Les travaux sont réalisés conformément :' },
    { type: 'ul', items: [
      'au Cahier des charges type Bâtiments (CCTB) en vigueur ;',
      'aux Spécifications Techniques Unifiées (STS) et aux Notes d’Information Technique (NIT) du CSTC / Buildwise ;',
      'aux normes NBN en vigueur ;',
      'aux prescriptions des fabricants des systèmes utilisés ;',
      'aux règlements en vigueur (sécurité, bien-être au travail, électricité — RGIE) ;',
      'aux règles de l’art généralement admises en Belgique.',
    ] },
    { type: 'p', text: 'Chaque système est mis en œuvre de manière complète et cohérente. Aucun mélange de composants provenant de systèmes différents n’est réalisé sans validation écrite préalable du maître d’ouvrage.' },
  ]);

  push('Prise en compte de l’existant et hypothèses', [
    { type: 'p', text: 'Les prix et les descriptions reposent sur l’état visible lors de la visite et sur les informations communiquées. Les hypothèses suivantes ont été retenues :' },
    { type: 'ul', items: [
      'Les supports existants (murs, dalles, toitures, charpentes) sont supposés sains, stables et adaptés à recevoir les nouveaux ouvrages.',
      'Les réseaux existants (eau, électricité, évacuations) sont supposés conformes et en bon état de fonctionnement là où ils sont conservés.',
      'L’accès au chantier, l’eau et l’électricité sont mis à disposition par le maître d’ouvrage pendant toute la durée des travaux.',
      '[À compléter : contraintes particulières du site (accès, voisins mitoyens, copropriété, horaires, stockage des matériaux)]',
    ] },
    { type: 'note', text: 'Toute adaptation rendue nécessaire par l’état réel du bâtiment découvert à l’exécution est signalée, chiffrée et validée par écrit avant d’être réalisée (avenant).' },
  ]);

  // ---------------------------------------------------------------- lots
  const lots = groupLots(quote.lines);
  const choices: string[][] = [];
  const options: string[] = [];
  lots.forEach((lot, li) => {
    const included = lot.items.filter((i) => !isOption(i.label));
    for (const i of lot.items) if (isOption(i.label)) options.push(`${lot.title} : ${i.label.trim()}`);
    const text = [lot.title, ...lot.items.map((i) => `${i.label} ${i.description ?? ''}`), ...lot.texts].join(' ');
    const rules = TRADE_RULES.filter((r) => r.re.test(text));
    const blocks: CdcBlock[] = [];

    blocks.push({ type: 'p', text: lot.intro || `Le présent lot comprend les travaux suivants, tels que repris au devis ${quoteRef} : ${included.slice(0, 6).map((i) => lowerFirst(i.label.trim())).join(' ; ')}${included.length > 6 ? ' ; …' : ''}.` });
    for (const t of lot.texts) blocks.push({ type: 'p', text: t });

    if (included.length) {
      blocks.push({ type: 'table', head: ['N°', 'Désignation', 'Quantité', 'Unité'], rows: included.map((i, k) => [
        `${li + 1}.${k + 1}`, i.label.trim(), i.qty ? qtyTxt(i.qty) : '', i.unit ?? '',
      ]) });
      const described = included.filter((i) => htmlToText(i.description));
      if (described.length) {
        blocks.push({ type: 'p', text: 'Précisions d’exécution :' });
        blocks.push({ type: 'ul', items: described.map((i) => `${i.label.trim()} — ${htmlToText(i.description).replace(/\n+/g, ' ; ')}`) });
      }
    }

    const choiceRows = rules.filter((r) => r.choice).map((r) => [r.trade, r.choice, `${TODO} : produit, référence, teinte]`]);
    if (choiceRows.length) {
      blocks.push({ type: 'p', text: 'Produits, teintes et finitions attendus (à faire valider par le maître d’ouvrage avant commande) :' });
      blocks.push({ type: 'table', head: ['Corps de métier', 'Choix à arrêter', 'Retenu'], rows: choiceRows });
      choiceRows.forEach((r) => choices.push([lot.title, r[0]!, r[1]!]));
    } else {
      blocks.push({ type: 'p', text: 'Matériaux : gamme courante, équivalents de qualité comparable autorisés, sauf produit imposé au devis ou validé par écrit par le maître d’ouvrage.' });
    }

    blocks.push({ type: 'p', text: 'Compris dans le prix du lot :' });
    blocks.push({ type: 'ul', items: STANDARD_INCLUDED });

    const ex = [...new Set(rules.flatMap((r) => r.excludes))];
    blocks.push({ type: 'p', text: 'Non compris dans ce lot :' });
    blocks.push({ type: 'ul', items: ex.length ? ex : ['Tout poste non décrit ci-dessus ou non repris au devis'] });
    push(`Lot ${li + 1} — ${lot.title}`, blocks);
  });

  push('Ce qui n’est pas compris dans l’offre', [
    { type: 'p', text: 'Sauf mention expresse dans le devis ou dans le présent cahier des charges, l’offre ne comprend pas :' },
    { type: 'ul', items: [...GENERAL_EXCLUSIONS, ...options.map((o) => `Option non retenue à ce stade — ${o}`)] },
  ]);

  push('Choix des produits et finitions à valider', [
    { type: 'p', text: 'Le maître d’ouvrage valide ci-dessous les choix de produits, teintes et finitions. Tant qu’un choix n’est pas validé, JJD Consult ne peut commander ni poser le produit concerné ; un changement après validation donne lieu à un avenant.' },
    { type: 'table', head: ['Lot', 'Poste', 'Choix retenu', 'Validé le / paraphe'], rows: choices.length
      ? choices.map((c) => [c[0]!, c[1]!, `${TODO} : produit, référence, teinte]`, ''])
      : [['—', 'Aucun choix particulier identifié dans le devis', '', '']] },
  ]);

  push('Conditions d’exécution et limites', [
    { type: 'ul', items: [
      'Les délais sont indicatifs et dépendent de la météo, des livraisons et de l’accès au chantier.',
      'Toute modification du périmètre demandée par le maître d’ouvrage fait l’objet d’un avenant écrit (prix et délai) avant exécution.',
      'Les couleurs et aspects sont validés sur échantillon : de légères variations de teinte entre lots de fabrication sont admises.',
      'La réception des travaux se fait contradictoirement en fin de chantier ; les remarques sont consignées dans un procès-verbal.',
      '[À compléter : conditions particulières (présence d’occupants, horaires de chantier, stationnement, benne, échafaudage…)]',
    ] },
  ]);

  push('Planning prévisionnel', [
    { type: 'p', text: 'Le planning prévisionnel est établi en fonction du budget et de l’organisation du chantier, par phase et par lot. Il est ajusté selon les conditions réelles de chantier (météo, livraisons, disponibilité du maître d’ouvrage).' },
    { type: 'p', text: '[À compléter : date de démarrage souhaitée, durée estimée, jalons importants]' },
  ]);

  push('Validation', [
    { type: 'p', text: 'Le maître d’ouvrage reconnaît avoir pris connaissance du présent cahier des charges et en accepte le contenu, y compris les exclusions et les choix de produits mentionnés.' },
    { type: 'table', head: ['Le maître d’ouvrage', 'JJD Consult SRL'], rows: [['Nom : ' + (client?.name ?? ''), 'Nom :'], ['Date :', 'Date :'], ['Signature (« lu et approuvé ») :', 'Signature :']] },
  ]);

  return { meta, sections };
}

// ------------------------------------------------------------------------- rendus
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hl = (s: string) => esc(s).replace(/\[À compléter[^\]]*\]/g, (m) => `<mark>${m}</mark>`);

/** HTML autonome (impression PDF par Chromium, comme les devis). */
export function cdcToHtml(c: CdcContent, company: { name: string; address?: string | null; phone?: string | null; email?: string | null }, logo?: string): string {
  const m = c.meta;
  const body = c.sections.map((s, i) => `<h2>${i + 1}. ${esc(s.title)}</h2>${s.blocks.map((b) => {
    if (b.type === 'p') return `<p>${hl(b.text)}</p>`;
    if (b.type === 'note') return `<p class="note">${hl(b.text)}</p>`;
    if (b.type === 'ul') return `<ul>${b.items.map((x) => `<li>${hl(x)}</li>`).join('')}</ul>`;
    return `<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((x) => `<td>${hl(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }).join('')}`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Cahier des charges ${esc(m.reference)}</title><style>
  @page{size:A4;margin:18mm 16mm 18mm 16mm}
  body{font:10.5pt/1.45 Arial,Helvetica,sans-serif;color:#1d2a25}
  .cover{page-break-after:always;padding-top:30mm}
  .cover img{height:22mm;margin-bottom:12mm}
  .cover h1{font-size:26pt;margin:0 0 4mm;color:#173f34;letter-spacing:.02em}
  .cover h3{font-size:14pt;font-weight:600;margin:0 0 10mm;color:#4a5a54}
  .cover table{width:auto;border:0}.cover td{border:0;padding:1.5mm 6mm 1.5mm 0;vertical-align:top}
  .co{margin-top:28mm;font-size:9pt;color:#4a5a54}
  h2{font-size:13pt;color:#173f34;border-bottom:1.5px solid #c9a24b;padding-bottom:1.5mm;margin:9mm 0 3mm;page-break-after:avoid}
  p{margin:0 0 2.5mm}ul{margin:0 0 3mm 5mm;padding-left:4mm}li{margin-bottom:1mm}
  table{width:100%;border-collapse:collapse;margin:2mm 0 4mm;font-size:9.5pt}th,td{border:1px solid #b9c4be;padding:1.6mm 2.2mm;text-align:left;vertical-align:top}th{background:#eef2ef}
  .note{border-left:3px solid #c9a24b;padding:2mm 3mm;background:#faf6ea}
  mark{background:#fff0b3;padding:0 1mm}
  tr{page-break-inside:avoid}
  </style></head><body>
  <section class="cover">${logo ? `<img src="${logo}" alt="">` : ''}
  <h1>CAHIER DES CHARGES</h1><h3>${esc(m.title)}</h3>
  <table><tr><td><b>Référence</b></td><td>${esc(m.reference)}</td></tr>
  <tr><td><b>Adresse du chantier</b></td><td>${esc(m.worksiteAddress)}</td></tr>
  <tr><td><b>Maître d’ouvrage</b></td><td>${esc(m.clientName)}<br>${esc(m.clientAddress)}</td></tr>
  <tr><td><b>Devis de référence</b></td><td>${esc(m.quoteRef)}${m.quoteDate ? ` du ${esc(m.quoteDate)}` : ''}</td></tr></table>
  <div class="co"><b>${esc(company.name)}</b><br>${esc(company.address ?? '')}<br>${esc([company.phone, company.email].filter(Boolean).join(' · '))}</div></section>
  ${body}</body></html>`;
}

// ------- DOCX minimal (modifiable dans Word) : titres, paragraphes, puces, tableaux
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (t: string, o: { b?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (inner: string, style?: string, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${inner}</w:p>`;
const cell = (t: string, head = false, w = 0) => `<w:tc><w:tcPr>${w ? `<w:tcW w:w="${w}" w:type="dxa"/>` : ''}${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2EF"/>' : ''}</w:tcPr>${para(run(t, { b: head, size: 19 }))}</w:tc>`;

export function cdcToDocx(c: CdcContent, company: { name: string; address?: string | null; phone?: string | null; email?: string | null }): Uint8Array {
  const m = c.meta;
  const body: string[] = [];
  body.push(para(run(company.name, { b: true, size: 20, color: '173F34' })));
  body.push(para(run('CAHIER DES CHARGES', { b: true, size: 52, color: '173F34' }), 'Title'));
  body.push(para(run(m.title, { size: 28 })));
  body.push(para(run(`Référence : ${m.reference}`)));
  if (m.worksiteAddress) body.push(para(run(`Adresse du chantier : ${m.worksiteAddress}`)));
  if (m.clientName) body.push(para(run(`Maître d’ouvrage : ${m.clientName}${m.clientAddress ? ` — ${m.clientAddress}` : ''}`)));
  body.push(para(run(`Devis de référence : ${m.quoteRef}${m.quoteDate ? ` du ${m.quoteDate}` : ''}`)));
  body.push(para(run([company.address, company.phone, company.email].filter(Boolean).join(' · '), { size: 18, color: '4A5A54' })));
  body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  c.sections.forEach((s, i) => {
    body.push(para(run(`${i + 1}. ${s.title}`), 'Heading1'));
    for (const b of s.blocks) {
      if (b.type === 'p') body.push(para(run(b.text)));
      else if (b.type === 'note') body.push(para(run(b.text, { b: true }), undefined, '<w:ind w:left="284"/>'));
      else if (b.type === 'ul') for (const it of b.items) body.push(para(run(`•  ${it}`), undefined, '<w:ind w:left="567" w:hanging="283"/>'));
      else {
        const total = 9600;
        const colW = Math.floor(total / b.head.length);
        body.push(`<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="B9C4BE"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${b.head.map(() => `<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid><w:tr>${b.head.map((h) => cell(h, true, colW)).join('')}</w:tr>${b.rows.map((r) => `<w:tr>${r.map((t) => cell(t, false, colW)).join('')}</w:tr>`).join('')}</w:tbl>`);
        body.push(para(''));
      }
    }
  });
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="600" w:after="200"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="C9A24B"/></w:pBdr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="173F34"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(styles),
    'word/_rels/document.xml.rels': strToU8(docRels),
  });
}
