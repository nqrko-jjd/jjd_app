'use client';
import { tr } from '@/lib/ui-language';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { Money, formatDateBE } from '@/lib/ui';
import { CreditNoteModal } from '@/components/CreditNoteModal';

interface Row { id: string; docNumber: string | null; date: string | null; ht: number; ttc: number | null; paymentStatus: string | null; supplierName: string | null; worksiteRef: string | null }
interface Doc { id: string; number: string | null; totalTtc: number }

/**
 * Factures de vente HISTORIQUES (reprises de l'Excel, sans document dans l'appli) : on peut en tirer un document « facture » (même numéro,
 * mêmes montants, aucun doublon au grand livre) puis faire une note de crédit dessus, comme sur n'importe quelle facture.
 */
export function HistoricalInvoices() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data, loading } = useApi<{ items: Row[]; total: number }>(open ? `/api/finance/ledger-sync/historical${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [credit, setCredit] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toDocument(row: Row): Promise<Doc | null> {
    setBusy(row.id);
    setErr(null);
    try {
      const r = await api<{ document: Doc }>(`/api/documents/from-ledger/${row.id}`, { method: 'POST' });
      return r.document;
    } catch (e) {
      setErr(`${row.docNumber} : ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" style={{ marginBottom: '1.2rem', overflow: 'hidden' }}>
      {credit && <CreditNoteModal invoice={credit} creditedTtc={0} onClose={() => setCredit(null)} onCreated={(id) => router.push(`/app/documents/${id}`)} />}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '0.9rem 1.15rem', cursor: 'pointer', color: 'inherit' }}>
        <strong>Factures historiques (sans document dans l’appli)</strong>{' '}
        <span className="muted" style={{ fontSize: '0.82rem' }}>— faire une note de crédit sur une facture de l’ancien Excel {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 1.15rem 1rem', display: 'grid', gap: '0.7rem' }}>
          <input className="input" placeholder="Chercher par n° de facture (F2026-198), client ou chantier (R-647)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une facture historique" />
          {err && <div className="badge crit" style={{ padding: '0.4rem 0.7rem' }}>{err}</div>}
          {loading && !data && <div className="muted">Chargement…</div>}
          {data && data.items.length === 0 && <div className="muted">Aucune facture historique ne correspond.</div>}
          {data && data.items.length > 0 && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>N°</th><th>Client</th><th>{tr("Chantier")}</th><th>{tr("Date")}</th><th style={{ textAlign: 'right' }}>TTC</th><th>Statut</th><th /></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.docNumber}</td>
                      <td>{r.supplierName ?? '—'}</td>
                      <td className="mono">{r.worksiteRef ?? '—'}</td>
                      <td className="tnum">{formatDateBE(r.date)}</td>
                      <td style={{ textAlign: 'right' }}><Money value={r.ttc ?? r.ht} /></td>
                      <td>{r.paymentStatus ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className="btn" disabled={busy === r.id} onClick={async () => { const d = await toDocument(r); if (d) setCredit(d); }}>
                          {busy === r.id ? '…' : 'Note de crédit…'}
                        </button>{' '}
                        <button className="btn ghost" disabled={busy === r.id} title="Crée le document de cette facture dans l’appli, sans note de crédit" onClick={async () => { const d = await toDocument(r); if (d) router.push(`/app/documents/${d.id}`); }}> {tr("Ouvrir")} </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > data.items.length && <div className="muted" style={{ fontSize: '0.8rem' }}>{data.total} résultats, les {data.items.length} plus récents sont affichés : précisez la recherche.</div>}
        </div>
      )}
    </section>
  );
}
