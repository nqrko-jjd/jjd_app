'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';

interface Tx {
  id: string; bookingDate: string | null; bank: string | null; counterpartyName: string | null;
  description: string | null; amount: number | null; communication: string | null; matchedLedgerId: string | null;
}
interface Suggestion {
  id: string; date: string | null; ttc: number | null; supplierName: string | null; categoryRaw: string | null;
  worksite: { ref: string; title: string } | null;
}

export default function BanquePage() {
  const [matched, setMatched] = useState('0');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ matched });
  if (q) qs.set('q', q);
  const { data, loading, reload } = useApi<{ items: Tx[]; matched: number; total: number }>(`/api/finance/bank?${qs}`);
  const [openTx, setOpenTx] = useState<string | null>(null);
  const { data: sugg } = useApi<{ items: Suggestion[] }>(openTx ? `/api/finance/bank/${openTx}/suggestions` : null);

  async function match(txId: string, ledgerId: string | null) {
    await api(`/api/finance/bank/${txId}/match`, { method: 'POST', body: { ledgerId } });
    setOpenTx(null);
    reload();
  }

  return (
    <>
      <PageHead
        title="Rapprochement bancaire"
        sub={data ? `${data.matched} / ${data.total} transactions rapprochées` : undefined}
        action={<Link href="/finances" className="btn">← Finances</Link>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, communication…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 180 }} value={matched} onChange={(e) => setMatched(e.target.value)}>
          <option value="0">À rapprocher</option>
          <option value="1">Rapprochées</option>
          <option value="">Toutes</option>
        </select>
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Banque</th><th>Contrepartie</th><th>Communication</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr></thead>
            <tbody>
              {data.items.map((t) => (
                <Fragment key={t.id}>
                  <tr>
                    <td className="tnum">{formatDateBE(t.bookingDate)}</td>
                    <td>{t.bank ?? '—'}</td>
                    <td>{t.counterpartyName ?? <span className="muted" style={{ fontSize: '0.8rem' }}>{(t.description ?? '').slice(0, 40)}</span>}</td>
                    <td className="mono" style={{ fontSize: '0.78rem' }}>{(t.communication ?? '').slice(0, 28)}</td>
                    <td style={{ textAlign: 'right' }}><Money value={t.amount} sign /></td>
                    <td>
                      {t.matchedLedgerId ? (
                        <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.76rem' }} onClick={() => match(t.id, null)}>Défaire</button>
                      ) : (
                        <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.76rem' }} onClick={() => setOpenTx(openTx === t.id ? null : t.id)}>
                          {openTx === t.id ? 'Fermer' : 'Rapprocher'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {openTx === t.id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--surface-2)', padding: '0.8rem 0.9rem' }}>
                        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Écritures de montant proche (± 20 jours)</div>
                        {!sugg ? 'Recherche…' : sugg.items.length === 0 ? <span className="muted">Aucune correspondance trouvée.</span> : (
                          <div className="grid" style={{ gap: '0.4rem' }}>
                            {sugg.items.map((s) => (
                              <button key={s.id} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => match(t.id, s.id)}>
                                <span>{s.worksite ? `${s.worksite.ref} · ` : ''}{s.supplierName ?? s.categoryRaw ?? '—'} · {formatDateBE(s.date)}</span>
                                <Money value={s.ttc} />
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
