'use client';
import { SkeletonRows } from '@/components/States';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiBlobUrl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatEur, formatDateBE } from '@/lib/ui';
import { DocStatusBadge, DOC_KIND_LABEL, type DocFull, type DocLine } from '@/lib/doc-ui';
import { ContactPicker } from '@/components/ContactPicker';
import { AssigneePicker } from '@/components/AssigneePicker';
import { WorksitePicker, type WsPickerOption } from '@/components/WorksitePicker';
import { DocumentDelivery } from '@/components/DocumentDelivery';
import { CreditNoteModal } from '@/components/CreditNoteModal';
import { RichText } from '@/components/RichText';
import { computeDocTotals, VAT_RATES } from '@jjd/shared';

/** Un <br> ou une balise vide compte comme "rien" — l'utilisateur n'a en réalité rien tapé. */

type Picker = {
  clients: { id: string; name: string }[];
  worksites: { id: string; name: string; clientId: string | null; city?: string | null }[];
  people: { id: string; name: string }[];
};

const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'forfait', label: 'Forfait' }, { value: 'u', label: 'u' }, { value: 'm²', label: 'm²' },
  { value: 'm³', label: 'm³' }, { value: 'ml', label: 'ml' }, { value: 'm', label: 'm' },
  { value: 'h', label: 'h' }, { value: 'jour', label: 'Jour' }, { value: 'kg', label: 'kg' },
  { value: 'L', label: 'L' }, { value: 'lot', label: 'Lot' }, { value: 'sac', label: 'Sac' },
  { value: 'pièce', label: 'Pièce' },
];

const emptyLine = (): DocLine => ({ kind: 'item', label: '', qty: 1, unit: '', unitPriceHt: 0, discountPct: 0, vatRate: 0.21 });
/** « R-047 · Toiture » -> { ref: "R-047", title: "R-047 · Toiture" } — même découpage que côté API (worksiteRef). */
const wsToPicker = (w: { id: string; name: string; city?: string | null }): WsPickerOption => ({ id: w.id, ref: w.name.split(' · ')[0]!, title: w.name, city: w.city ?? null });

export default function DocumentEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, reload } = useApi<{ document: DocFull }>(`/api/documents/${id}`);
  const { data: pick } = useApi<Picker>('/api/meta/pickers');

  const [doc, setDoc] = useState<DocFull | null>(null);
  const [lines, setLines] = useState<DocLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [libQ, setLibQ] = useState('');
  const [tasksModal, setTasksModal] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [openDesc, setOpenDesc] = useState<Set<number>>(new Set());
  const { data: lib } = useApi<{ items: { id: string; label: string; unit: string | null; unitPriceHt: number; vatRate: number }[] }>(
    libQ.length >= 2 ? `/api/price-items?q=${encodeURIComponent(libQ)}` : null,
  );

  useEffect(() => {
    if (data?.document) {
      setDoc(data.document);
      // Document importé sans détail de lignes mais avec un montant stocké : on pré-remplit UNE ligne à ce montant, pour que
      // le récapitulatif affiche le vrai total (et non 0) et que le montant soit modifiable ; sans quoi l'éditeur partait
      // d'une ligne vide à 0 €, et enregistrer sans désignation ne changeait rien.
      const d = data.document;
      // (seulement si le taux de TVA du total stocké est un taux standard : sinon enregistrer fausserait le total)
      const ratio = d.totalHt > 0 ? d.totalVat / d.totalHt : 0;
      const stdRate = [0, 0.06, 0.12, 0.21].find((r) => Math.abs(r - ratio) < 0.003);
      const imported0: DocLine | null = !d.lines.length && d.totalHt > 0 && stdRate !== undefined
        ? { kind: 'item', label: 'Reprise du montant importé', qty: 1, unit: 'forfait', unitPriceHt: d.totalHt, discountPct: 0, vatRate: stdRate }
        : null;
      const initLines = d.lines.length ? d.lines : [imported0 ?? emptyLine()];
      setLines(initLines);
      setDirty(false);
      setBillingOpen(!!(data.document.billingName || data.document.billingVat || data.document.billingAddress || data.document.billingEmail));
      setShowDiscount(initLines.some((l) => l.discountPct > 0));
      setOpenDesc(new Set(initLines.map((l, i) => (l.description ? i : -1)).filter((i) => i >= 0)));
    }
  }, [data]);

  const locked = !!doc?.lockedAt || (!!doc?.number && doc?.source !== 'manual');
  // Documents importés de TrustUp (sans détail de lignes d'origine) : juste une info
  // affichée désormais, ça ne bloque plus l'édition (phase de test — même logique que
  // les documents émis par l'app, voir `locked`).
  const imported = !!doc?.source && doc.source !== 'manual';
  const totals = useMemo(() => computeDocTotals(lines), [lines]);

  if (!doc) return <SkeletonRows />;

  const patch = (p: Partial<DocFull>) => { setDoc({ ...doc, ...p }); setDirty(true); };
  const setLine = (i: number, p: Partial<DocLine>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
    setDirty(true);
  };
  const addLine = (kind: DocLine['kind']) => { setLines([...lines, { ...emptyLine(), kind }]); setDirty(true); };
  const removeLine = (i: number) => {
    setLines(lines.filter((_, j) => j !== i));
    setOpenDesc((s) => new Set([...s].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
    setDirty(true);
  };
  const duplicateLine = (i: number) => {
    setLines([...lines.slice(0, i + 1), { ...lines[i]!, id: undefined }, ...lines.slice(i + 1)]);
    setDirty(true);
  };
  const moveLine = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    setLines(next);
    setDirty(true);
  };
  const toggleDesc = (i: number) => setOpenDesc((s) => { const next = new Set(s); if (next.has(i)) next.delete(i); else next.add(i); return next; });

  async function save() {
    // une ligne avec un prix mais sans désignation était écartée en silence à l'enregistrement (« ça ne change rien »)
    if (lines.some((l) => l.kind === 'item' && !l.label.trim() && (l.unitPriceHt > 0 || l.qty > 1))) {
      setMsg('Chaque ligne avec un montant doit avoir une désignation (colonne « Désignation ») — sinon elle n’est pas enregistrée.');
      return;
    }
    setBusy('save');
    try {
      await api(`/api/documents/${id}`, {
        method: 'PATCH',
        body: {
          contactId: doc!.contact?.id ?? null,
          worksiteId: doc!.worksite?.id ?? null,
          title: doc!.title,
          intro: doc!.intro,
          terms: doc!.terms,
          note: doc!.note,
          issuedOn: doc!.issuedOn,
          dueOn: doc!.dueOn,
          validUntil: doc!.validUntil,
          billingName: doc!.billingName,
          billingVat: doc!.billingVat,
          billingAddress: doc!.billingAddress,
          billingEmail: doc!.billingEmail,
          customerRef: doc!.customerRef,
          paidAmount: doc!.paidAmount,
          lines: lines.filter((l) => l.label.trim()),
        },
      });
      await reload();
      setMsg('Enregistré.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // total déjà crédité par des notes de crédit émises (rattachées à cette facture)
  const creditedTtc = doc ? Math.round(doc.children.filter((c) => c.kind === 'credit_note' && c.lockedAt).reduce((s, c) => s + Math.abs(c.totalTtc ?? 0), 0) * 100) / 100 : 0;
  const creditRemaining = doc ? Math.round((Math.abs(doc.totalTtc) - creditedTtc) * 100) / 100 : 0;

  async function act(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(path);
    try {
      if (dirty) await save();
      const r = await api<{ document?: { id: string }; note?: string; ok?: boolean }>(`/api/documents/${id}${path}`, {
        method: path ? 'POST' : 'PATCH',
        body: body ?? {},
      });
      if (r.note) setMsg(r.note);
      if (path === '' ) return;
      if (path.startsWith('/convert') || path.startsWith('/credit-note') || path.startsWith('/duplicate')) {
        if (r.document) router.push(`/app/documents/${r.document.id}`);
        return;
      }
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    await api(`/api/documents/${id}`, { method: 'DELETE' });
    router.push('/app/documents');
  }

  // /api/meta/pickers n'expose que les chantiers actifs (non archivés) — un document déjà lié
  // à un chantier depuis archivé doit quand même pouvoir afficher son libellé dans le champ,
  // sinon il paraît "sans chantier" alors que le lien existe bel et bien en base.
  const worksiteOpts: WsPickerOption[] = (() => {
    const base = (pick?.worksites ?? []).map(wsToPicker);
    if (doc.worksite && !base.some((w) => w.id === doc.worksite!.id)) {
      base.push({ id: doc.worksite.id, ref: doc.worksite.ref, title: doc.worksite.title, city: null });
    }
    return base;
  })();
  const isQuote = doc.kind === 'quote';
  const isInvoiceLike = doc.kind === 'invoice' || doc.kind === 'deposit_invoice';
  const remaining = Math.max(0, totals.totalTtc - doc.paidAmount);
  const colspan = showDiscount ? 6 : 5;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem' }}>
        <Link href="/app/documents" className="btn ghost">← Devis & factures</Link>
      </div>
      <div className="detail-hero document-reference-heading">
        <div className="eyebrow">{DOC_KIND_LABEL[doc.kind]}</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap', gap: '1rem' }}>
          <h1>{doc.number ?? doc.draftRef ?? `Nouveau·elle ${DOC_KIND_LABEL[doc.kind].toLowerCase()}`}</h1>
          <DocStatusBadge status={doc.status} />
        </div>
        <div className="sub">{locked ? `Émis le ${doc.issuedOn?.slice(0, 10)}` : 'Brouillon modifiable — du travail réalisé à un document clair.'}</div>
      </div>

      {msg && <div className="card card-pad" style={{ marginBottom: '1rem', borderLeft: '3px solid var(--primary)' }}>{msg}</div>}
      {imported && (
        <div className="card card-pad muted" style={{ marginBottom: '1rem', fontSize: '0.85rem', borderLeft: '3px solid var(--warn)' }}>
          Document importé de TrustUp (le détail des lignes n’a pas été repris à l’import — la liste ci-dessous est
          donc vide au départ). Le PDF d’origine reste dans TrustUp. Modifiable comme les autres pendant la phase de
          test.
        </div>
      )}
      {locked && !imported && (
        <div className="card card-pad muted" style={{ marginBottom: '1rem', fontSize: '0.85rem', borderLeft: '3px solid var(--warn)' }}>
          Document déjà émis (n° {doc.number}) — modifier les lignes ici change directement le document émis, sans
          passer par une note de crédit. Autorisé pendant la phase de test ; à repasser en lecture seule une fois en
          production.
        </div>
      )}

      {creditOpen && <CreditNoteModal invoice={{ id: doc.id, number: doc.number, totalTtc: doc.totalTtc }} creditedTtc={creditedTtc} onClose={() => setCreditOpen(false)} onCreated={(nid) => router.push(`/app/documents/${nid}`)} />}

      {(doc.parent || doc.children.length > 0) && (
      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        {doc.parent && (
          <Link href={`/app/documents/${doc.parent.id}`} className="chip">
            ← {DOC_KIND_LABEL[doc.parent.kind]} {doc.parent.number ?? doc.parent.draftRef}
          </Link>
        )}
        {doc.children.map((c) => (
          <Link key={c.id} href={`/app/documents/${c.id}`} className="chip">
            {DOC_KIND_LABEL[c.kind]} {c.number ?? c.draftRef}{c.kind === 'credit_note' && c.totalTtc != null ? ` · ${formatEur(Math.abs(c.totalTtc))}` : ''}{c.kind === 'credit_note' && !c.lockedAt ? ' (brouillon)' : ''} →
          </Link>
        ))}
        {(doc.kind === 'invoice' || doc.kind === 'deposit_invoice') && creditedTtc > 0 && (
          <span className="muted" style={{ fontSize: '0.84rem', alignSelf: 'center' }}>
            Crédité {formatEur(creditedTtc)} sur {formatEur(Math.abs(doc.totalTtc))}{creditRemaining > 0.01 ? ` · reste ${formatEur(creditRemaining)}` : ' · intégralement'}
            {doc.paidAmount > 0.01 ? ` · payé ${formatEur(doc.paidAmount)}` : ''}
            {doc.paidAmount - creditRemaining > 0.01 ? ` · trop-perçu ${formatEur(doc.paidAmount - creditRemaining)} à rembourser ou à imputer sur une autre facture` : ''}
          </span>
        )}
      </div>
      )}

      <div className="doc-layout">
        <div className="doc-main">
          <div className="doc-sheet">
          {/* Client & chantier */}
          <div className="doc-sheet-section">
            <div className="doc-sheet-section-head"><h2>Client & chantier</h2></div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label className="field">
                <span>Client</span>
                <ContactPicker
                  value={doc.contact?.id ?? ''}
                  onChange={(cid, name) => {
                    patch({ contact: cid ? { id: cid, name, vat: null, address: null, box: null, postalCode: null, city: null, email: null } : null });
                  }}
                />
              </label>
              <label className="field">
                <span>Chantier lié</span>
                <WorksitePicker
                  value={doc.worksite?.id ?? ''}
                  onChange={(wid) => {
                    const w = worksiteOpts.find((x) => x.id === wid);
                    patch({ worksite: w ? { id: w.id, ref: w.ref, title: w.title } : null });
                  }}
                  options={worksiteOpts}
                  placeholder="Sans chantier lié"
                />
              </label>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span>Objet {isInvoiceLike ? 'de la facture' : 'du devis'}</span>
                <input className="input" value={doc.title ?? ''} onChange={(e) => patch({ title: e.target.value })} placeholder="Rénovation salle de bain" />
              </label>
            </div>
            {isQuote && (
              <label className="field" style={{ marginTop: '0.7rem' }}>
                <span>Texte d’introduction</span>
                <textarea className="input" rows={2} value={doc.intro ?? ''} onChange={(e) => patch({ intro: e.target.value })} />
              </label>
            )}

            <button type="button" className="doc-billing-toggle" onClick={() => setBillingOpen((o) => !o)}>
              {billingOpen ? '▾' : '▸'} Coordonnées de facturation
              <span className="doc-billing-note">indépendantes de l’adresse du chantier</span>
            </button>
            {billingOpen && (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: '0.7rem' }}>
                <label className="field">
                  <span>Nom / raison sociale à facturer</span>
                  <input className="input" value={doc.billingName ?? ''} onChange={(e) => patch({ billingName: e.target.value || null })} placeholder={doc.contact?.name ?? 'Nom du client'} />
                </label>
                <label className="field">
                  <span>TVA à facturer</span>
                  <input className="input" value={doc.billingVat ?? ''} onChange={(e) => patch({ billingVat: e.target.value || null })} placeholder={doc.contact?.vat ?? 'BE0…'} />
                </label>
                <label className="field" style={{ gridColumn: '1 / -1' }}>
                  <span>Adresse de facturation</span>
                  <textarea className="input" rows={2} value={doc.billingAddress ?? ''} onChange={(e) => patch({ billingAddress: e.target.value || null })} placeholder={doc.contact?.address ?? ''} />
                </label>
                <label className="field">
                  <span>Contact / e-mail de facturation</span>
                  <input className="input" type="email" value={doc.billingEmail ?? ''} onChange={(e) => patch({ billingEmail: e.target.value || null })} placeholder={doc.contact?.email ?? ''} />
                </label>
                <label className="field">
                  <span>Référence client / bon de commande</span>
                  <input className="input" value={doc.customerRef ?? ''} onChange={(e) => patch({ customerRef: e.target.value || null })} />
                </label>
              </div>
            )}
          </div>

          {/* Prestations & fournitures */}
          <div className="doc-sheet-section">
            <div className="doc-sheet-section-head">
              <h2>Prestations & fournitures</h2>
              <label className="row" style={{ marginLeft: 'auto', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-2)' }}>
                <input type="checkbox" checked={showDiscount} onChange={(e) => setShowDiscount(e.target.checked)} /> Remises
              </label>
            </div>
            <div className="tbl-wrap">
              {/* table-layout: fixed + une seule colonne sans largeur (Désignation) : elle absorbe
                  tout l'espace restant au lieu que les colonnes numériques (Qté…) se gonflent.
                  minWidth évite que Désignation s'écrase sur un écran étroit — ça déborde plutôt
                  (le .tbl-wrap défile alors horizontalement) que de devenir illisible. Les icônes
                  d'action (déplacer/dupliquer/supprimer) sont empilées à la verticale plutôt qu'à
                  l'horizontale pour tenir dans une colonne étroite. */}
              <table className="tbl document-lines-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: 1060 }}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Désignation</th>
                    <th style={{ width: 104, textAlign: 'right' }}>Quantité</th>
                    <th style={{ width: 100 }}>Unité</th>
                    <th style={{ width: 122, textAlign: 'right' }}>Prix HT</th>
                    {showDiscount && <th style={{ width: 100, textAlign: 'right' }}>Rem.%</th>}
                    <th style={{ width: 94 }}>TVA %</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Total HT</th>
                    <th style={{ width: 34 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: '0.3rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button className="btn ghost" style={btnMini} onClick={() => moveLine(i, -1)} aria-label="Monter">↑</button>
                          <button className="btn ghost" style={btnMini} onClick={() => moveLine(i, 1)} aria-label="Descendre">↓</button>
                        </div>
                      </td>
                      <td>
                        <RichText
                          bold={l.kind === 'section'}
                          placeholder={l.kind === 'section' ? 'Titre de section' : l.kind === 'text' ? 'Texte libre' : 'Désignation'}
                          value={l.label}
                          onChange={(v) => setLine(i, { label: v })}
                        />
                        {l.kind === 'item' && (
                          openDesc.has(i) ? (
                            <div style={{ marginTop: 4 }}>
                              <RichText
                                placeholder="Description détaillée (optionnel) — Entrée pour aller à la ligne"
                                value={l.description ?? ''}
                                onChange={(v) => setLine(i, { description: v })}
                                autoFocus
                                minHeight={140}
                              />
                            </div>
                          ) : (
                            <button type="button" className="btn ghost" style={{ ...btnMini, marginTop: 4 }} onClick={() => toggleDesc(i)}>
                              + Description détaillée
                            </button>
                          )
                        )}
                      </td>
                      {l.kind === 'item' ? (
                        <>
                          <td><input aria-label={`Quantité ligne ${i + 1}`} className="input" type="number" step="any" style={{ textAlign: 'right' }} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
                          <td>
                            <select className="select" value={l.unit ?? ''} onChange={(e) => setLine(i, { unit: e.target.value })}>
                              <option value="">—</option>
                              {l.unit && !UNIT_OPTIONS.some((o) => o.value === l.unit) && <option value={l.unit}>{l.unit}</option>}
                              {UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td><input className="input" type="number" style={{ textAlign: 'right' }} value={l.unitPriceHt} onChange={(e) => setLine(i, { unitPriceHt: Number(e.target.value) })} /></td>
                          {showDiscount && (
                            <td><input className="input" type="number" style={{ textAlign: 'right' }} value={l.discountPct} onChange={(e) => setLine(i, { discountPct: Number(e.target.value) })} /></td>
                          )}
                          <td>
                            <select className="select" value={l.vatRate} onChange={(e) => setLine(i, { vatRate: Number(e.target.value) })}>
                              {VAT_RATES.map((r) => <option key={r} value={r}>{r === 0 ? 'Cocontractant' : r === 0.06 ? '6 % · rénovation' : `${Math.round(r * 100)} %`}</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }} className="tnum">
                            {formatEur(l.qty * l.unitPriceHt * (1 - l.discountPct / 100))}
                          </td>
                        </>
                      ) : (
                        <td colSpan={colspan}></td>
                      )}
                      <td style={{ padding: '0.3rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button className="btn ghost" style={btnMini} onClick={() => duplicateLine(i)} aria-label="Dupliquer" title="Dupliquer">⧉</button>
                          <button className="btn ghost" style={btnMini} onClick={() => removeLine(i)} aria-label="Supprimer">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ gap: '0.4rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => addLine('item')}>+ Ligne</button>
              <button className="btn" onClick={() => addLine('section')}>+ Section</button>
              <button className="btn" onClick={() => addLine('text')}>+ Texte</button>
              <input
                className="input"
                style={{ maxWidth: 220, marginLeft: 'auto' }}
                placeholder="⌕ Bibliothèque de postes"
                value={libQ}
                onChange={(e) => setLibQ(e.target.value)}
              />
            </div>
            {lib && lib.items.length > 0 && (
              <div className="card" style={{ marginTop: 6, padding: 6 }}>
                {lib.items.slice(0, 8).map((it) => (
                  <button
                    key={it.id}
                    className="btn ghost"
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2 }}
                    onClick={() => {
                      setLines([...lines, { kind: 'item', label: it.label, qty: 1, unit: it.unit ?? '', unitPriceHt: it.unitPriceHt, discountPct: 0, vatRate: it.vatRate, priceItemId: it.id }]);
                      setDirty(true);
                      setLibQ('');
                    }}
                  >
                    {it.label} — {formatEur(it.unitPriceHt)}{it.unit ? ` / ${it.unit}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Règlement */}
          <div className="doc-sheet-section">
            <div className="doc-sheet-section-head"><h2>Règlement</h2></div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label className="field">
                <span>Date {isInvoiceLike ? 'de facture' : 'du devis'}</span>
                <input className="input" type="date" value={doc.issuedOn?.slice(0, 10) ?? ''} onChange={(e) => patch({ issuedOn: e.target.value || null })} />
              </label>
              {isQuote && (
                <label className="field">
                  <span>Validité</span>
                  <input className="input" type="date" value={doc.validUntil?.slice(0, 10) ?? ''} onChange={(e) => patch({ validUntil: e.target.value || null })} />
                </label>
              )}
              {isInvoiceLike && (
                <>
                  <label className="field">
                    <span>Échéance</span>
                    <input className="input" type="date" value={doc.dueOn?.slice(0, 10) ?? ''} onChange={(e) => patch({ dueOn: e.target.value || null })} />
                  </label>
                  <label className="field">
                    <span>Acompte déjà réglé (€ TTC)</span>
                    <input className="input" type="number" min={0} step="0.01" value={doc.paidAmount} onChange={(e) => patch({ paidAmount: Number(e.target.value) })} />
                  </label>
                </>
              )}
            </div>
          </div>
          </div>

          <DocumentDelivery doc={doc} busy={!!busy} onExternal={() => act('/send', { confirmedExternal: true })} onError={setMsg} />

          {/* Actions secondaires */}
          <section className="doc-card">
            <div className="section-title">Autres actions</div>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              {locked && isInvoiceLike && doc.status !== 'paid' && (
                <button className="btn" disabled={!!busy} onClick={() => act('/mark-paid', {})}>Marquer payée</button>
              )}
              {isQuote && (
                <button className="btn" disabled={!!busy} onClick={() => act('/convert', {})}>Convertir en facture</button>
              )}
              {isQuote && doc.worksite && (
                <button className="btn" disabled={!!busy} onClick={() => setTasksModal(true)}>Créer des tâches depuis ce devis</button>
              )}
              {isQuote && locked && (
                <>
                  <button className="btn" disabled={!!busy} onClick={() => act('/status', { status: 'accepted' })}>Accepté</button>
                  <button className="btn" disabled={!!busy} onClick={() => act('/status', { status: 'declined' })}>Refusé</button>
                </>
              )}
              {isInvoiceLike && locked && doc.status !== 'credited' && creditRemaining > 0.01 && (
                <button className="btn" disabled={!!busy} onClick={() => setCreditOpen(true)}>Note de crédit…</button>
              )}
              <button className="btn" disabled={!!busy} onClick={() => act('/duplicate', {})}>Dupliquer</button>
              <button
                className="btn"
                onClick={async () => {
                  try { window.open(await apiBlobUrl(`/api/documents/${id}/pdf`), '_blank'); }
                  catch (e) { setMsg((e as Error).message); }
                }}
              >
                Télécharger le PDF
              </button>
              {doc.originalPdf && (
                <button
                  className="btn"
                  onClick={async () => {
                    try { window.open(await apiBlobUrl(`/api/documents/${id}/original.pdf`), '_blank'); }
                    catch (e) { setMsg((e as Error).message); }
                  }}
                >
                  PDF d’origine (TrustUp)
                </button>
              )}
              {!locked && <button className="btn" style={{ marginLeft: 'auto', color: 'var(--crit)' }} onClick={del}>Supprimer</button>}
            </div>
          </section>
        </div>

        {/* Récapitulatif — sticky */}
        <aside className="doc-recap">
          <div className="doc-card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
              <span className="eyebrow" style={{ margin: 0 }}>Récapitulatif</span>
              <DocStatusBadge status={doc.status} />
            </div>
            <div className="kpi hero" style={{ marginBottom: '0.9rem' }}>
              <div className="kpi-head"><span className="label">Total TTC</span></div>
              <div className="value">{formatEur(totals.totalTtc)}</div>
            </div>
            <div className="doc-recap-rows">
              <div className="doc-recap-row"><span>Total HT</span><span>{formatEur(totals.totalHt)}</span></div>
              {Object.entries(totals.vatBreakdown).map(([rate, b]) => (
                <div className="doc-recap-row" key={rate}><span>TVA {Math.round(Number(rate) * 100)}%</span><span>{formatEur(b.vat)}</span></div>
              ))}
              {isInvoiceLike && doc.paidAmount > 0 && (
                <div className="doc-recap-row"><span>{doc.status === 'paid' ? 'Réglé' : 'Acompte déjà réglé'}</span><span>− {formatEur(doc.paidAmount)}</span></div>
              )}
              {isInvoiceLike && (
                <div className="doc-recap-row strong"><span>Reste à payer</span><span>{formatEur(remaining)}</span></div>
              )}
              {doc.structuredComm && <div className="doc-recap-row" style={{ marginTop: '0.3rem' }}><span>Communication</span><span className="mono" style={{ fontSize: '0.78rem' }}>{doc.structuredComm}</span></div>}
            </div>

            {isInvoiceLike && locked && (
              <div className={doc.status === 'paid' ? (doc.hasBankMatch ? 'doc-recap-paid ok' : 'doc-recap-paid warn') : doc.status === 'partial' ? 'doc-recap-paid warn' : 'doc-recap-paid'}>
                {doc.status === 'paid' && (
                  <span>
                    {doc.hasBankMatch ? '✓ Payée intégralement' : '⚠ Marquée payée'}
                    {doc.paidOn && (
                      <> le <Link href={`/app/finances/banque?documentId=${id}`} style={{ textDecoration: 'underline' }}>{formatDateBE(doc.paidOn)}</Link></>
                    )}
                    {!doc.hasBankMatch && ' — aucune transaction bancaire retrouvée, date non confirmée'}
                  </span>
                )}
                {doc.status === 'partial' && (
                  <span>
                    ◐ Paiement partiel — {formatEur(doc.paidAmount)} reçu
                    {doc.paidOn && (
                      <> (dernier le <Link href={`/app/finances/banque?documentId=${id}`} style={{ textDecoration: 'underline' }}>{formatDateBE(doc.paidOn)}</Link>)</>
                    )}
                    , {formatEur(remaining)} restant
                    {!doc.hasBankMatch && ' — aucune transaction bancaire retrouvée'}
                  </span>
                )}
                {doc.status !== 'paid' && doc.status !== 'partial' && (
                  <span>Aucun paiement enregistré — {formatEur(remaining)} dû</span>
                )}
              </div>
            )}

            {isInvoiceLike && (doc.payments?.length ?? 0) > 0 && (
              <div className="doc-recap-rows" style={{ marginTop: '0.6rem' }}>
                <div className="eyebrow" style={{ margin: '0 0 0.3rem' }}>Paiements reçus ({doc.payments!.length})</div>
                {doc.payments!.map((p) => (
                  <div key={p.matchId} className="doc-recap-row" style={{ alignItems: 'baseline' }}>
                    <span style={{ minWidth: 0 }}>
                      <Link href={`/app/finances/banque?documentId=${id}`} style={{ textDecoration: 'underline' }}>{p.date ? formatDateBE(p.date) : '—'}</Link>
                      <span className="muted" style={{ fontSize: '0.76rem' }}> · {[p.bank, p.counterparty].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span>{formatEur(p.amount)}</span>
                  </div>
                ))}
                {doc.payments!.length > 1 && (
                  <div className="doc-recap-row strong"><span>Total encaissé</span><span>{formatEur(doc.payments!.reduce((s, p) => s + p.amount, 0))}</span></div>
                )}
              </div>
            )}

            {dirty && <div className="doc-recap-dirty">Modifications non enregistrées</div>}

            <div className="doc-recap-actions">
              <button className="btn primary" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>
              {!locked && (
                <button className="btn" disabled={!!busy} onClick={() => act('/issue', {}, 'Émettre : un numéro définitif sera attribué et les lignes verrouillées. Continuer ?')}>
                  Émettre {isQuote ? 'le devis' : 'la facture'} →
                </button>
              )}
              <a className="btn" href={`/imprimer/${id}`} target="_blank" rel="noreferrer">Aperçu du document</a>
            </div>
          </div>
        </aside>
      </div>

      {tasksModal && (
        <TasksFromLinesModal
          docId={id}
          lines={lines.filter((l) => l.kind === 'item' && l.label.trim())}
          people={pick?.people ?? []}
          onClose={() => setTasksModal(false)}
          onDone={(count) => { setTasksModal(false); setMsg(`${count} tâche(s) créée(s) sur le chantier — visibles dans l'onglet Tâches de sa fiche.`); }}
        />
      )}
    </>
  );
}

const btnMini: React.CSSProperties = { padding: '0.15rem 0.4rem', fontSize: '0.75rem', minWidth: 0 };

function TasksFromLinesModal({
  docId,
  lines,
  people,
  onClose,
  onDone,
}: {
  docId: string;
  lines: DocLine[];
  people: { id: string; name: string }[];
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const linesWithId = lines.filter((l): l is DocLine & { id: string } => !!l.id);
  const [checked, setChecked] = useState<Set<string>>(new Set(linesWithId.map((l) => l.id)));
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!checked.size) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ tasks: unknown[] }>(`/api/documents/${docId}/tasks-from-lines`, {
        method: 'POST',
        body: { lineIds: [...checked], assigneeIds },
      });
      onDone(r.tasks.length);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Créer des tâches depuis ce devis</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          {linesWithId.length === 0 ? (
            <p className="muted">Ce devis n’a pas encore de ligne enregistrée — enregistre-le d’abord.</p>
          ) : (
            <div className="grid" style={{ gap: '0.3rem' }}>
              {linesWithId.map((l) => (
                <label key={l.id} className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} />
                  <span>{l.label}</span>
                </label>
              ))}
            </div>
          )}
          <div className="field" style={{ marginTop: '0.9rem' }}>
            <label>Assigner à (optionnel)</label>
            <AssigneePicker people={people} value={assigneeIds} onChange={setAssigneeIds} />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn primary" disabled={busy || !checked.size} onClick={submit}>
            {busy ? 'Création…' : `Créer ${checked.size} tâche${checked.size > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
