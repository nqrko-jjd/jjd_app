'use client';
import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, formatDateBE } from '@/lib/ui';

interface Tx {
  id: string; bookingDate: string | null; bank: string | null; counterpartyName: string | null;
  description: string | null; amount: number | null; communication: string | null;
  matchedLedgerId: string | null; matchConfidence: string | null;
  matchedLedger: { docNumber: string | null; supplierName: string | null; worksite: { ref: string } | null } | null;
}
interface Suggestion {
  id: string; date: string | null; ttc: number | null; supplierName: string | null; categoryRaw: string | null;
  worksite: { ref: string; title: string } | null;
}
interface PontoStatus {
  configured: boolean; connected: boolean; redirectUri: string;
  accounts: { id: string; iban: string | null; label: string | null; balance: number | null; lastSyncAt: string | null }[];
}

const CONF_LABEL: Record<string, string> = { strong: 'auto ✓✓', good: 'auto ✓', manual: 'manuel' };

export default function BanquePage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <BanqueInner />
    </Suspense>
  );
}

function BanqueInner() {
  const { user } = useAuth();
  const sp = useSearchParams();
  const [matched, setMatched] = useState('0');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const qs = new URLSearchParams({ matched });
  if (q) qs.set('q', q);
  const { data, loading, reload } = useApi<{ items: Tx[]; matched: number; total: number }>(`/api/finance/bank?${qs}`);
  const { data: ponto, reload: reloadPonto } = useApi<PontoStatus>('/api/ponto/status');
  const [openTx, setOpenTx] = useState<string | null>(null);
  const { data: sugg } = useApi<{ items: Suggestion[] }>(openTx ? `/api/finance/bank/${openTx}/suggestions` : null);

  useEffect(() => {
    const p = sp.get('ponto');
    if (p === 'connected') { setFlash('Banque connectée. Lance une synchronisation.'); reloadPonto(); }
    else if (p === 'error') setFlash(`Échec de la connexion Ponto : ${sp.get('msg') ?? ''}`);
  }, [sp, reloadPonto]);

  async function match(txId: string, ledgerId: string | null) {
    await api(`/api/finance/bank/${txId}/match`, { method: 'POST', body: { ledgerId } });
    setOpenTx(null);
    reload();
  }
  async function connect() {
    const r = await api<{ url: string }>('/api/ponto/connect');
    window.location.href = r.url;
  }
  async function sync() {
    setBusy('sync'); setFlash(null);
    try {
      const r = await api<{ imported: number; match: { strong: number; good: number } }>('/api/ponto/sync', { method: 'POST' });
      setFlash(`${r.imported} nouvelle(s) transaction(s) · ${r.match.strong + r.match.good} rapprochée(s) automatiquement.`);
      reload(); reloadPonto();
    } catch (e) { setFlash((e as Error).message); }
    finally { setBusy(null); }
  }
  async function autoMatch() {
    setBusy('match'); setFlash(null);
    try {
      const r = await api<{ strong: number; good: number; scanned: number }>('/api/finance/bank/auto-match', { method: 'POST' });
      setFlash(`${r.strong + r.good} transaction(s) rapprochée(s) (${r.strong} sûres, ${r.good} probables) sur ${r.scanned} examinées.`);
      reload();
    } catch (e) { setFlash((e as Error).message); }
    finally { setBusy(null); }
  }

  const admin = user?.role === 'admin';

  return (
    <>
      <PageHead
        title="Rapprochement bancaire"
        sub={data ? `${data.matched} / ${data.total} transactions rapprochées` : undefined}
        action={<Link href="/app/finances" className="btn">← Finances</Link>}
      />

      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.7rem' }}>
          <div>
            <strong>Connexion bancaire (Ponto)</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {!ponto ? 'Chargement…'
                : !ponto.configured ? 'Non configurée — voir docs/ponto.md (certificats + client_id).'
                : !ponto.connected ? 'Configurée, pas encore connectée à une banque.'
                : `${ponto.accounts.length} compte(s) · ${ponto.accounts.map((a) => a.label ?? a.iban).filter(Boolean).join(', ') || '—'}`}
            </div>
            {ponto?.connected && ponto.accounts.some((a) => a.lastSyncAt) && (
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Dernière synchro : {formatDateBE(ponto.accounts.map((a) => a.lastSyncAt).filter(Boolean).sort().at(-1) ?? null)}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: '0.4rem' }}>
            {ponto?.configured && !ponto.connected && admin && (
              <button className="btn primary" onClick={connect}>Connecter une banque</button>
            )}
            {ponto?.connected && (
              <button className="btn primary" disabled={busy === 'sync'} onClick={sync}>
                {busy === 'sync' ? 'Synchro…' : 'Synchroniser'}
              </button>
            )}
            <button className="btn" disabled={busy === 'match'} onClick={autoMatch}>
              {busy === 'match' ? 'Rapprochement…' : 'Rapprocher automatiquement'}
            </button>
          </div>
        </div>
        {flash && <div className="muted" style={{ marginTop: '0.6rem', fontSize: '0.85rem' }}>{flash}</div>}
      </div>

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
            <thead><tr><th>Date</th><th>Banque</th><th>Contrepartie</th><th>Communication</th><th style={{ textAlign: 'right' }}>Montant</th><th>Rapprochement</th><th></th></tr></thead>
            <tbody>
              {data.items.map((t) => (
                <Fragment key={t.id}>
                  <tr>
                    <td className="tnum">{formatDateBE(t.bookingDate)}</td>
                    <td>{t.bank ?? '—'}</td>
                    <td>{t.counterpartyName ?? <span className="muted" style={{ fontSize: '0.8rem' }}>{(t.description ?? '').slice(0, 40)}</span>}</td>
                    <td className="mono" style={{ fontSize: '0.78rem' }}>{(t.communication ?? '').slice(0, 28)}</td>
                    <td style={{ textAlign: 'right' }}><Money value={t.amount} sign /></td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {t.matchedLedgerId ? (
                        <span>
                          <span className={`badge ${t.matchConfidence === 'strong' ? 'ok' : t.matchConfidence === 'good' ? 'warn' : 'plain'}`}>
                            {CONF_LABEL[t.matchConfidence ?? ''] ?? 'lié'}
                          </span>{' '}
                          {t.matchedLedger && (
                            <span className="muted">
                              {t.matchedLedger.worksite ? `${t.matchedLedger.worksite.ref} · ` : ''}
                              {t.matchedLedger.docNumber ?? t.matchedLedger.supplierName ?? ''}
                            </span>
                          )}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
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
                      <td colSpan={7} style={{ background: 'var(--surface-2)', padding: '0.8rem 0.9rem' }}>
                        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Écritures proposées</div>
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
