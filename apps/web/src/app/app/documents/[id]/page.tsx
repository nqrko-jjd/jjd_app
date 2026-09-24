'use client';
import { SkeletonRows } from '@/components/States';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiBlobUrl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatEur } from '@/lib/ui';
import { DocStatusBadge, DOC_KIND_LABEL, type DocFull, type DocLine } from '@/lib/doc-ui';
import { ContactPicker } from '@/components/ContactPicker';
import { AssigneePicker } from '@/components/AssigneePicker';
import { WorksitePicker, type WsPickerOption } from '@/components/WorksitePicker';
import { computeDocTotals, VAT_RATES } from '@jjd/shared';

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

/** Champ texte qui grandit avec son contenu — on voit toute la désignation, pas seulement le début. */
function AutoText({ value, onChange, placeholder, bold }: { value: string; onChange: (v: string) => void; placeholder?: string; bold?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="input"
      rows={1}
      style={{ resize: 'none', overflow: 'hidden', lineHeight: 1.35, fontWeight: bold ? 700 : undefined }}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

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
  const [billingOpen, setBillingOpen] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [openDesc, setOpenDesc] = useState<Set<number>>(new Set());
  const { data: lib } = useApi<{ items: { id: string; label: string; unit: string | null; unitPriceHt: number; vatRate: number }[] }>(
    libQ.length >= 2 ? `/api/price-items?q=${encodeURIComponent(libQ)}` : null,
  );

  useEffect(() => {
    if (data?.document) {
      setDoc(data.document);
      const initLines = data.document.lines.length ? data.document.lines : [emptyLine()];
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

  const worksiteOpts: WsPickerOption[] = (pick?.worksites ?? []).map(wsToPicker);
  const isQuote = doc.kind === 'quote';
  const isInvoiceLike = doc.kind === 'invoice' || doc.kind === 'deposit_invoice';
  const remaining = Math.max(0, totals.totalTtc - doc.paidAmount);
  const colspan = showDiscount ? 6 : 5;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem' }}>
        <Link href="/app/documents" className="btn ghost">← Devis & factures</Link>
      </div>
      <div className="detail-hero">
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

      {(doc.parent || doc.children.length > 0) && (
      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        {doc.parent && (
          <Link href={`/app/documents/${doc.parent.id}`} className="chip">
            ← {DOC_KIND_LABEL[doc.parent.kind]} {doc.parent.number ?? doc.parent.draftRef}
          </Link>
        )}
        {doc.children.map((c) => (
          <Link key={c.id} href={`/app/documents/${c.id}`} className="chip">
            {DOC_KIND_LABEL[c.kind]} {c.number ?? c.draftRef} →
          </Link>
        ))}
      </div>
      )}

      <div className="doc-layout">
        <div className="doc-main">
          {/* 01 · Client & chantier */}
          <section className="doc-card">
            <div className="doc-card-head"><span className="doc-card-num">01</span><h2>Client & chantier</h2></div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label className="field">
                <span>Client</span>
                <ContactPicker
                  value={doc.contact?.id ?? ''}
                  onChange={(cid, name) => {
                    patch({ contact: cid ? { id: cid, name, vat: null, address: null, postalCode: null, city: null, email: null } : null });
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
          </section>

          {/* 02 · Prestations & fournitures */}
          <section className="doc-card">
            <div className="doc-card-head">
              <span className="doc-card-num">02</span><h2>Prestations & fournitures</h2>
              <label className="row" style={{ marginLeft: 'auto', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-2)' }}>
                <input type="checkbox" checked={showDiscount} onChange={(e) => setShowDiscount(e.target.checked)} /> Remises
              </label>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}></th>
                    <th style={{ minWidth: 220 }}>Désignation</th>
                    <th style={{ minWidth: 80, textAlign: 'right' }}>Qté</th>
                    <th style={{ minWidth: 84 }}>Unité</th>
                    <th style={{ minWidth: 92, textAlign: 'right' }}>Prix HT</th>
                    {showDiscount && <th style={{ width: 60, textAlign: 'right' }}>Rem.%</th>}
                    <th style={{ minWidth: 76 }}>TVA %</th>
                    <th style={{ width: 105, textAlign: 'right' }}>Total HT</th>
                    <th style={{ width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: '0.3rem', whiteSpace: 'nowrap' }}>
                        <button className="btn ghost" style={btnMini} onClick={() => moveLine(i, -1)} aria-label="Monter">↑</button>
                        <button className="btn ghost" style={btnMini} onClick={() => moveLine(i, 1)} aria-label="Descendre">↓</button>
                      </td>
                      <td>
                        <AutoText
                          bold={l.kind === 'section'}
                          placeholder={l.kind === 'section' ? 'Titre de section' : l.kind === 'text' ? 'Texte libre' : 'Désignation'}
                          value={l.label}
                          onChange={(v) => setLine(i, { label: v })}
                        />
                        {l.kind === 'item' && (
                          openDesc.has(i) ? (
                            <input
                              className="input"
                              style={{ marginTop: 4, fontSize: '0.8rem' }}
                              placeholder="Description détaillée (optionnel)"
                              value={l.description ?? ''}
                              onChange={(e) => setLine(i, { description: e.target.value })}
                              onBlur={() => { if (!l.description?.trim()) toggleDesc(i); }}
                              autoFocus
                            />
                          ) : (
                            <button type="button" className="btn ghost" style={{ ...btnMini, marginTop: 4 }} onClick={() => toggleDesc(i)}>
                              + Description détaillée
                            </button>
                          )
                        )}
                      </td>
                      {l.kind === 'item' ? (
                        <>
                          <td><input className="input" type="number" step="any" style={{ textAlign: 'right', minWidth: 70 }} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
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
                              {VAT_RATES.map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }} className="tnum">
                            {formatEur(l.qty * l.unitPriceHt * (1 - l.discountPct / 100))}
                          </td>
                        </>
                      ) : (
                        <td colSpan={colspan}></td>
                      )}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn ghost" style={btnMini} onClick={() => duplicateLine(i)} aria-label="Dupliquer" title="Dupliquer">⧉</button>
                        <button className="btn ghost" style={btnMini} onClick={() => removeLine(i)} aria-label="Supprimer">✕</button>
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
          </section>

          {/* 03 · Règlement */}
          <section className="doc-card">
            <div className="doc-card-head"><span className="doc-card-num">03</span><h2>Règlement</h2></div>
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
          </section>

          {/* Actions secondaires */}
          <section className="doc-card">
            <div className="section-title">Autres actions</div>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              {locked && isInvoiceLike && doc.status !== 'paid' && (
                <button className="btn" disabled={!!busy} onClick={() => act('/mark-paid', {})}>Marquer payée</button>
              )}
              {locked && (
                <button className="btn" disabled={!!busy} onClick={() => act('/send', { peppol: isInvoiceLike })}>
                  {isInvoiceLike ? 'Envoyer (Peppol)' : 'Marquer envoyé'}
                </button>
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
              {isInvoiceLike && locked && (
                <button className="btn" disabled={!!busy} onClick={() => act('/credit-note', {})}>Note de crédit</button>
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
            {isInvoiceLike && (
              <p className="hint" style={{ marginTop: '0.7rem' }}>
                La transmission Peppol réelle n’est pas encore active — TrustUp reste l’émetteur officiel tant que la conformité
                e-facturation n’est pas validée. « Envoyer » met le document en file et le marque envoyé.
              </p>
            )}
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
                <div className="doc-recap-row"><span>Acompte déjà réglé</span><span>− {formatEur(doc.paidAmount)}</span></div>
              )}
              {isInvoiceLike && (
                <div className="doc-recap-row strong"><span>Reste à payer</span><span>{formatEur(remaining)}</span></div>
              )}
              {doc.structuredComm && <div className="doc-recap-row" style={{ marginTop: '0.3rem' }}><span>Communication</span><span className="mono" style={{ fontSize: '0.78rem' }}>{doc.structuredComm}</span></div>}
            </div>

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
    <div className="modal-scrim" onClick={onClose}>
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
