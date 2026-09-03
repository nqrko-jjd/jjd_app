'use client';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiBlobUrl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, formatEur } from '@/lib/ui';
import { DocStatusBadge, DOC_KIND_LABEL, type DocFull, type DocLine } from '@/lib/doc-ui';
import { computeDocTotals, VAT_RATES } from '@jjd/shared';

type Picker = {
  clients: { id: string; name: string }[];
  worksites: { id: string; name: string; clientId: string | null }[];
};

const emptyLine = (): DocLine => ({ kind: 'item', label: '', qty: 1, unit: '', unitPriceHt: 0, discountPct: 0, vatRate: 0.21 });

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
  const { data: lib } = useApi<{ items: { id: string; label: string; unit: string | null; unitPriceHt: number; vatRate: number }[] }>(
    libQ.length >= 2 ? `/api/price-items?q=${encodeURIComponent(libQ)}` : null,
  );

  useEffect(() => {
    if (data?.document) {
      setDoc(data.document);
      setLines(data.document.lines.length ? data.document.lines : [emptyLine()]);
      setDirty(false);
    }
  }, [data]);

  const locked = !!doc?.lockedAt || (!!doc?.number && doc?.source !== 'manual');
  const imported = doc?.source && doc.source !== 'manual';
  const totals = useMemo(() => computeDocTotals(lines), [lines]);

  if (!doc) return <div className="empty">Chargement…</div>;

  const patch = (p: Partial<DocFull>) => { setDoc({ ...doc, ...p }); setDirty(true); };
  const setLine = (i: number, p: Partial<DocLine>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
    setDirty(true);
  };
  const addLine = (kind: DocLine['kind']) => { setLines([...lines, { ...emptyLine(), kind }]); setDirty(true); };
  const removeLine = (i: number) => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); };
  const moveLine = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    setLines(next);
    setDirty(true);
  };

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
          lines: locked ? undefined : lines.filter((l) => l.label.trim()),
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
      if (dirty && !locked) await save();
      const r = await api<{ document?: { id: string }; note?: string; ok?: boolean }>(`/api/documents/${id}${path}`, {
        method: path ? 'POST' : 'PATCH',
        body: body ?? {},
      });
      if (r.note) setMsg(r.note);
      if (path === '' ) return;
      if (path.startsWith('/convert') || path.startsWith('/credit-note') || path.startsWith('/duplicate')) {
        if (r.document) router.push(`/documents/${r.document.id}`);
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
    router.push('/documents');
  }

  const clientOpts = pick?.clients ?? [];
  const worksiteOpts = pick?.worksites ?? [];
  const isQuote = doc.kind === 'quote';
  const isInvoiceLike = doc.kind === 'invoice' || doc.kind === 'deposit_invoice';

  return (
    <>
      <PageHead
        title={`${DOC_KIND_LABEL[doc.kind]} ${doc.number ?? doc.draftRef ?? ''}`}
        sub={locked ? `Émis le ${doc.issuedOn?.slice(0, 10)} — verrouillé` : 'Brouillon modifiable'}
        action={<Link href="/documents" className="btn">← Liste</Link>}
      />

      {msg && <div className="card card-pad" style={{ marginBottom: '1rem', borderLeft: '3px solid var(--primary)' }}>{msg}</div>}
      {imported && (
        <div className="card card-pad muted" style={{ marginBottom: '1rem', fontSize: '0.85rem', borderLeft: '3px solid var(--warn)' }}>
          Document importé de TrustUp — en lecture seule (le détail des lignes n’a pas été repris). Le PDF d’origine reste dans TrustUp.
          Vous pouvez le dupliquer pour repartir d’une base.
        </div>
      )}

      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        <DocStatusBadge status={doc.status} />
        {doc.parent && (
          <Link href={`/documents/${doc.parent.id}`} className="chip">
            ← {DOC_KIND_LABEL[doc.parent.kind]} {doc.parent.number ?? doc.parent.draftRef}
          </Link>
        )}
        {doc.children.map((c) => (
          <Link key={c.id} href={`/documents/${c.id}`} className="chip">
            {DOC_KIND_LABEL[c.kind]} {c.number ?? c.draftRef} →
          </Link>
        ))}
      </div>

      {/* En-tête */}
      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label className="field">
            <span>Client</span>
            <select
              className="select"
              value={doc.contact?.id ?? ''}
              disabled={locked}
              onChange={(e) => {
                const c = clientOpts.find((x) => x.id === e.target.value);
                patch({ contact: c ? { id: c.id, name: c.name, vat: null, address: null, postalCode: null, city: null, email: null } : null });
              }}
            >
              <option value="">—</option>
              {clientOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Chantier</span>
            <select
              className="select"
              value={doc.worksite?.id ?? ''}
              onChange={(e) => {
                const w = worksiteOpts.find((x) => x.id === e.target.value);
                patch({ worksite: w ? { id: w.id, ref: w.name.split(' · ')[0], title: w.name } : null });
              }}
            >
              <option value="">—</option>
              {worksiteOpts.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Objet</span>
            <input className="input" value={doc.title ?? ''} onChange={(e) => patch({ title: e.target.value })} placeholder="Rénovation salle de bain" />
          </label>
          {isQuote && (
            <label className="field">
              <span>Validité</span>
              <input className="input" type="date" value={doc.validUntil?.slice(0, 10) ?? ''} onChange={(e) => patch({ validUntil: e.target.value })} />
            </label>
          )}
          {isInvoiceLike && (
            <label className="field">
              <span>Échéance</span>
              <input className="input" type="date" value={doc.dueOn?.slice(0, 10) ?? ''} onChange={(e) => patch({ dueOn: e.target.value })} />
            </label>
          )}
        </div>
        {isQuote && (
          <label className="field" style={{ marginTop: '0.7rem' }}>
            <span>Texte d’introduction</span>
            <textarea className="input" rows={2} value={doc.intro ?? ''} onChange={(e) => patch({ intro: e.target.value })} />
          </label>
        )}
      </div>

      {/* Lignes */}
      <div className="tbl-wrap" style={{ marginBottom: '1rem' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Désignation</th>
              <th style={{ width: 70, textAlign: 'right' }}>Qté</th>
              <th style={{ width: 60 }}>Unité</th>
              <th style={{ width: 100, textAlign: 'right' }}>P.U. HT</th>
              <th style={{ width: 60, textAlign: 'right' }}>Rem.%</th>
              <th style={{ width: 70 }}>TVA</th>
              <th style={{ width: 110, textAlign: 'right' }}>Total HT</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ padding: '0.3rem', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost" style={btnMini} disabled={locked} onClick={() => moveLine(i, -1)}>↑</button>
                  <button className="btn ghost" style={btnMini} disabled={locked} onClick={() => moveLine(i, 1)}>↓</button>
                </td>
                <td>
                  <input
                    className="input"
                    style={l.kind === 'section' ? { fontWeight: 700 } : undefined}
                    placeholder={l.kind === 'section' ? 'Titre de section' : l.kind === 'text' ? 'Texte libre' : 'Désignation'}
                    value={l.label}
                    disabled={locked}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                  />
                  {l.kind === 'item' && (
                    <input
                      className="input"
                      style={{ marginTop: 4, fontSize: '0.8rem' }}
                      placeholder="Détail (optionnel)"
                      value={l.description ?? ''}
                      disabled={locked}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                  )}
                </td>
                {l.kind === 'item' ? (
                  <>
                    <td><input className="input" type="number" style={{ textAlign: 'right' }} value={l.qty} disabled={locked} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
                    <td><input className="input" value={l.unit ?? ''} disabled={locked} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                    <td><input className="input" type="number" style={{ textAlign: 'right' }} value={l.unitPriceHt} disabled={locked} onChange={(e) => setLine(i, { unitPriceHt: Number(e.target.value) })} /></td>
                    <td><input className="input" type="number" style={{ textAlign: 'right' }} value={l.discountPct} disabled={locked} onChange={(e) => setLine(i, { discountPct: Number(e.target.value) })} /></td>
                    <td>
                      <select className="select" value={l.vatRate} disabled={locked} onChange={(e) => setLine(i, { vatRate: Number(e.target.value) })}>
                        {VAT_RATES.map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }} className="tnum">
                      {formatEur(l.qty * l.unitPriceHt * (1 - l.discountPct / 100))}
                    </td>
                  </>
                ) : (
                  <td colSpan={6}></td>
                )}
                <td style={{ textAlign: 'right' }}>
                  <button className="btn ghost" style={btnMini} disabled={locked} onClick={() => removeLine(i)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!locked && (
        <div style={{ marginBottom: '1rem' }}>
          <div className="row" style={{ gap: '0.4rem' }}>
            <button className="btn" onClick={() => addLine('item')}>+ Ligne</button>
            <button className="btn" onClick={() => addLine('section')}>+ Section</button>
            <button className="btn" onClick={() => addLine('text')}>+ Texte</button>
            <input
              className="input"
              style={{ maxWidth: 220, marginLeft: 'auto' }}
              placeholder="Chercher dans la bibliothèque…"
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
      )}

      {/* Totaux */}
      <div className="card card-pad" style={{ marginBottom: '1rem', maxWidth: 360, marginLeft: 'auto' }}>
        <Row2 label="Total HT" value={formatEur(totals.totalHt)} />
        {Object.entries(totals.vatBreakdown).map(([rate, b]) => (
          <Row2 key={rate} label={`TVA ${Math.round(Number(rate) * 100)}%`} value={formatEur(b.vat)} muted />
        ))}
        <Row2 label="Total TTC" value={formatEur(totals.totalTtc)} strong />
        {doc.paidAmount > 0 && <Row2 label="Payé" value={formatEur(doc.paidAmount)} muted />}
        {doc.structuredComm && <Row2 label="Communication" value={doc.structuredComm} muted />}
      </div>

      {/* Actions */}
      <div className="card card-pad">
        <div className="section-title">Actions</div>
        <div className="row" style={{ gap: '0.5rem' }}>
          {!locked && <button className="btn primary" disabled={busy === 'save'} onClick={save}>Enregistrer</button>}
          {!locked && (
            <button className="btn" disabled={!!busy} onClick={() => act('/issue', {}, 'Émettre : un numéro définitif sera attribué et les lignes verrouillées. Continuer ?')}>
              Émettre {isQuote ? 'le devis' : 'la facture'}
            </button>
          )}
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
          {doc.originalPdf ? (
            <button
              className="btn"
              onClick={async () => {
                try { window.open(await apiBlobUrl(`/api/documents/${id}/original.pdf`), '_blank'); }
                catch (e) { setMsg((e as Error).message); }
              }}
            >
              PDF d’origine (TrustUp)
            </button>
          ) : (
            <a className="btn" href={`/imprimer/${id}`} target="_blank" rel="noreferrer">Imprimer / PDF</a>
          )}
          {!locked && <button className="btn" style={{ marginLeft: 'auto', color: 'var(--crit)' }} onClick={del}>Supprimer</button>}
        </div>
        {isInvoiceLike && (
          <p className="hint" style={{ marginTop: '0.7rem' }}>
            La transmission Peppol réelle n’est pas encore active — TrustUp reste l’émetteur officiel tant que la conformité
            e-facturation n’est pas validée. « Envoyer » met le document en file et le marque envoyé.
          </p>
        )}
      </div>
    </>
  );
}

const btnMini: React.CSSProperties = { padding: '0.15rem 0.4rem', fontSize: '0.75rem', minWidth: 0 };

function Row2({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '0.15rem 0' }}>
      <span className={muted ? 'muted' : undefined} style={strong ? { fontWeight: 800 } : undefined}>{label}</span>
      <span className="tnum" style={strong ? { fontWeight: 800 } : undefined}>{value}</span>
    </div>
  );
}
