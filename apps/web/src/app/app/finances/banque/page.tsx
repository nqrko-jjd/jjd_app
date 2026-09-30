'use client';
import { SkeletonRows, ErrorState } from '@/components/States';
import { Fragment, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiUpload, apiBlobUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { PaginationBar } from '@/components/PaginationBar';

interface Match {
  id: string;
  ledgerEntry: { id: string; docNumber: string | null; supplierName: string | null; direction: string; ttc: number | null; ht: number; worksite: { ref: string } | null } | null;
  document: { id: string; number: string | null; kind: string; totalTtc: number | null; contact: { name: string } | null; worksite: { ref: string } | null } | null;
}
interface Tx {
  id: string; bookingDate: string | null; bank: string | null; counterpartyName: string | null;
  description: string | null; amount: number | null; communication: string | null;
  matchConfidence: string | null;
  // plusieurs factures possibles pour une même transaction — un acompte réglé en une fois,
  // décompté ensuite par le fournisseur sur plusieurs factures reçues
  matches: Match[];
}
interface Suggestion {
  kind: 'ledger' | 'document';
  id: string; label: string; amount: number | null; date: string | null;
  direction: string; worksiteRef: string | null; status?: string;
}
interface PontoStatus {
  configured: boolean; connected: boolean; redirectUri: string;
  accounts: { id: string; iban: string | null; label: string | null; balance: number | null; lastSyncAt: string | null }[];
}

const CONF_LABEL: Record<string, string> = { strong: 'auto ✓✓', good: 'auto ✓', manual: 'manuel' };

function matchAmount(m: Match): number {
  if (m.ledgerEntry) return m.ledgerEntry.ttc ?? m.ledgerEntry.ht;
  if (m.document) return m.document.totalTtc ?? 0;
  return 0;
}
function matchLabel(m: Match): string {
  if (m.ledgerEntry) {
    const l = m.ledgerEntry;
    return [l.worksite?.ref, l.docNumber ?? l.supplierName].filter(Boolean).join(' · ');
  }
  if (m.document) {
    const d = m.document;
    return [d.worksite?.ref, `facture ${d.number ?? ''}`, d.contact?.name].filter(Boolean).join(' · ');
  }
  return '';
}

export default function BanquePage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <BanqueInner />
    </Suspense>
  );
}

function BanqueInner() {
  const { user } = useAuth();
  const sp = useSearchParams();
  const [matched, setMatched] = useState('0');
  const [q, setQ] = useState('');
  const [bank, setBank] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Arrivée depuis la fiche d'une facture ("payée le …", cliquable) : ne montre que les
  // transactions qui l'ont réglée, prioritaire sur le filtre "matched" habituel.
  const [documentFilter, setDocumentFilter] = useState<string | null>(null);
  useEffect(() => { setDocumentFilter(sp.get('documentId')); }, [sp]);

  useEffect(() => { setPage(1); }, [q, bank, matched, documentFilter]);

  const qs = new URLSearchParams({ matched, page: String(page), pageSize: String(pageSize) });
  if (q) qs.set('q', q);
  if (bank) qs.set('bank', bank);
  if (documentFilter) qs.set('documentId', documentFilter);
  const { data, loading, error, reload } = useApi<{
    items: Tx[]; matched: number; total: number; byBank: { bank: string | null; _count: number }[];
    page: number; totalPages: number; totalCount: number;
  }>(`/api/finance/bank?${qs}`);
  const { data: ponto, reload: reloadPonto } = useApi<PontoStatus>('/api/ponto/status');
  const { data: aiStatus } = useApi<{ enabled: boolean }>('/api/assistant/status');
  const [openTx, setOpenTx] = useState<string | null>(null);
  const [manualQ, setManualQ] = useState('');
  const suggQs = manualQ.trim() ? `?q=${encodeURIComponent(manualQ.trim())}` : '';
  const { data: sugg, loading: suggLoading, reload: reloadSugg } = useApi<{ items: Suggestion[]; remaining: number }>(openTx ? `/api/finance/bank/${openTx}/suggestions${suggQs}` : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = sp.get('ponto');
    if (p === 'connected') { setFlash('Banque connectée. Lance une synchronisation.'); reloadPonto(); }
    else if (p === 'error') setFlash(`Échec de la connexion Ponto : ${sp.get('msg') ?? ''}`);
  }, [sp, reloadPonto]);

  // laisse le tiroir ouvert après l'ajout : un paiement peut couvrir plusieurs factures
  // (acompte décompté ensuite) — on peut donc en ajouter une autre tout de suite
  async function addMatch(txId: string, body: { ledgerId?: string | null; documentId?: string | null }) {
    await api(`/api/finance/bank/${txId}/matches`, { method: 'POST', body });
    setManualQ('');
    reload();
    reloadSugg();
  }
  async function removeMatch(txId: string, matchId: string) {
    await api(`/api/finance/bank/${txId}/matches/${matchId}`, { method: 'DELETE' });
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
  async function renameBank(from: string) {
    const to = window.prompt(`Renommer « ${from} » en :`, from);
    if (!to || !to.trim() || to.trim() === from) return;
    try {
      const r = await api<{ renamed: number }>('/api/finance/bank/rename', { method: 'POST', body: { from, to: to.trim() } });
      setFlash(`${r.renamed} transaction(s) renommée(s) « ${from} » → « ${to.trim()} ».`);
      setBank(to.trim());
      reload();
    } catch (e) { setFlash((e as Error).message); }
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
  async function importFile(file: File) {
    setBusy('csv'); setFlash(null);
    const label = window.prompt('Libellé de ce relevé (ex. « Visa Belfius ») :', file.name.replace(/\.(csv|pdf)$/i, ''));
    if (label === null) { setBusy(null); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bank', label);
      const r = await apiUpload<{ imported: number; duplicates: number; skipped?: number; period?: string; match: { strong: number; good: number } }>('/api/finance/bank/import', fd);
      const parts = [
        `${r.imported} ligne(s) importée(s)`,
        `${r.duplicates} déjà présente(s)`,
        r.skipped ? `${r.skipped} ignorée(s)` : null,
        `${r.match.strong + r.match.good} rapprochée(s)`,
      ].filter(Boolean);
      setFlash((r.period ? `Relevé ${r.period} — ` : '') + parts.join(' · ') + '.');
      reload();
    } catch (e) { setFlash((e as Error).message); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function importScreenshots(files: FileList) {
    setBusy('screenshot'); setFlash(null);
    const label = window.prompt('Libellé de cette carte (ex. « Visa Belfius ») :', 'Carte (capture)');
    if (label === null) { setBusy(null); return; }
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('bank', label);
      const r = await apiUpload<{ imported: number; duplicates: number; match: { strong: number; good: number } }>('/api/finance/bank/import-screenshot', fd);
      setFlash(`${r.imported} dépense(s) lue(s) sur ${files.length} capture(s) · ${r.duplicates} déjà présente(s) · ${r.match.strong + r.match.good} rapprochée(s).`);
      reload();
    } catch (e) { setFlash((e as Error).message); }
    finally { setBusy(null); if (screenshotRef.current) screenshotRef.current.value = ''; }
  }

  const admin = user?.role === 'admin';

  return (
    <>
      <PageHead
        title="Rapprochement bancaire"
        sub={data ? `${data.matched} / ${data.total} transactions rapprochées · page ${data.page}/${data.totalPages}` : undefined}
        action={<Link href="/app/finances" className="btn">← Finances</Link>}
      />

      {documentFilter && (
        <div
          className="card card-pad"
          style={{
            marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.7rem',
            ...(data && data.totalCount === 0 ? { background: 'var(--warn-soft)', color: 'var(--warn)' } : {}),
          }}
        >
          {!data ? (
            <span>Recherche de la transaction ayant réglé cette facture…</span>
          ) : data.totalCount === 0 ? (
            <span>⚠ Aucune transaction bancaire trouvée pour cette facture — la date affichée sur la facture n'est donc pas confirmée par un rapprochement réel (souvent un import historique dont on n'a pas retrouvé le paiement exact).</span>
          ) : (
            <span>Filtré : {data.totalCount} transaction(s) ayant réglé cette facture.</span>
          )}
          <button type="button" className="btn" onClick={() => setDocumentFilter(null)}>Retirer le filtre</button>
        </div>
      )}

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
            <button className="btn" disabled={busy === 'csv'} onClick={() => fileRef.current?.click()}>
              {busy === 'csv' ? 'Import…' : 'Importer un relevé'}
            </button>
            <input
              ref={fileRef} type="file" accept=".csv,text/csv,.pdf,application/pdf" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); }}
            />
            <button
              className="btn"
              disabled={busy === 'screenshot' || !aiStatus?.enabled}
              onClick={() => screenshotRef.current?.click()}
              title={aiStatus?.enabled ? 'Photo(s) de l’historique de l’appli carte — pour rapprocher avant l’arrivée du relevé PDF officiel du mois' : 'Lecture IA non configurée côté serveur (clé Anthropic absente)'}
            >
              {busy === 'screenshot' ? 'Lecture…' : '📸 Importer une capture d’écran'}
            </button>
            <input
              ref={screenshotRef} type="file" accept="image/png,image/jpeg" multiple hidden
              onChange={(e) => { const files = e.target.files; if (files?.length) importScreenshots(files); }}
            />
          </div>
        </div>
        <div className="muted" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
          « Importer un relevé » = pour les paiements absents du flux Ponto (cartes Visa/Mastercard). CSV, ou PDF « État des dépenses » de carte. « Capture d’écran » = photo de l’historique de l’appli carte, lue par IA — utile avant l’arrivée du relevé PDF officiel du mois. Ré-importer les mêmes lignes ne crée pas de doublons.
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
        <select className="select" style={{ maxWidth: 150 }} value={bank} onChange={(e) => setBank(e.target.value)}>
          <option value="">Tous les comptes</option>
          {(data?.byBank ?? []).filter((b) => b.bank).map((b) => (
            <option key={b.bank} value={b.bank!}>{b.bank} ({b._count})</option>
          ))}
        </select>
        {bank && (
          <button className="btn" title="Renomme ce libellé pour toutes ses transactions" onClick={() => renameBank(bank)}>
            Renommer
          </button>
        )}
      </div>

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
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
                      {t.matches.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div className="grid" style={{ gap: '0.25rem' }}>
                          {t.matches.map((m) => (
                            <div key={m.id} className="bank-match-card">
                              <span className={`badge ${t.matchConfidence === 'strong' ? 'ok' : t.matchConfidence === 'good' ? 'warn' : 'plain'}`}>
                                {CONF_LABEL[t.matchConfidence ?? ''] ?? 'lié'}
                              </span>
                              <div className="bank-match-document"><strong>{matchLabel(m)}</strong><div className="row">
                                {m.document && <Link className="bank-document-link" href={`/app/documents/${m.document.id}`}>Ouvrir la facture</Link>}
                                {m.ledgerEntry && <Link className="bank-document-link" href={`/app/achats?q=${encodeURIComponent(m.ledgerEntry.docNumber || m.ledgerEntry.supplierName || '')}`}>Voir l’achat</Link>}
                                <button className="bank-document-link" onClick={async()=>{try {const url=await apiBlobUrl(m.document?`/api/documents/${m.document.id}/pdf`:`/api/finance/expenses/${m.ledgerEntry!.id}/pdf`);window.open(url,'_blank','noopener');}catch(e){setFlash((e as Error).message);}}}>Voir le justificatif</button>
                              </div></div>
                              <span className="tnum" style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}><Money value={matchAmount(m)} /></span>
                              <button
                                className="btn ghost"
                                style={{ padding: '0.1rem 0.35rem', fontSize: '0.72rem' }}
                                onClick={() => removeMatch(t.id, m.id)}
                                title="Détacher cette facture"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          {t.matches.length > 1 && (
                            <div className="muted" style={{ fontSize: '0.74rem' }}>
                              Total rapproché : <Money value={t.matches.reduce((s, m) => s + matchAmount(m), 0)} /> / <Money value={Math.abs(t.amount ?? 0)} />
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.76rem' }} onClick={() => { setOpenTx(openTx === t.id ? null : t.id); setManualQ(''); }}>
                        {openTx === t.id ? 'Fermer' : t.matches.length ? '+ Ajouter' : 'Rapprocher'}
                      </button>
                    </td>
                  </tr>
                  {openTx === t.id && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--surface-2)', padding: '0.8rem 0.9rem' }}>
                        <div className="row" style={{ marginBottom: '0.6rem', gap: '0.5rem', alignItems: 'center' }}>
                          <div className="eyebrow" style={{ margin: 0 }}>{manualQ.trim() ? 'Recherche' : 'Factures proposées (achat & vente)'}</div>
                          {!manualQ.trim() && sugg && t.matches.length > 0 && (
                            <span className="muted" style={{ fontSize: '0.8rem' }}>reste à affecter : <Money value={sugg.remaining} /></span>
                          )}
                          <input
                            className="input"
                            style={{ maxWidth: 260, marginLeft: 'auto' }}
                            placeholder="Chercher toi-même : n°, fournisseur, chantier…"
                            value={manualQ}
                            onChange={(e) => setManualQ(e.target.value)}
                          />
                        </div>
                        {suggLoading ? 'Recherche…' : !sugg ? 'Recherche…' : sugg.items.length === 0 ? (
                          <span className="muted">
                            {manualQ.trim() ? 'Aucune correspondance.' : 'Aucune proposition automatique — cherche toi-même ci-dessus.'}
                          </span>
                        ) : (
                          <div className="grid" style={{ gap: '0.4rem' }}>
                            {sugg.items.map((s) => (
                              <button
                                key={`${s.kind}-${s.id}`}
                                className="btn"
                                style={{ justifyContent: 'space-between' }}
                                onClick={() => addMatch(t.id, s.kind === 'ledger' ? { ledgerId: s.id } : { documentId: s.id })}
                              >
                                <span>
                                  <span className={`badge ${s.direction === 'sale' ? 'ok' : 'plain'}`} style={{ marginRight: 6 }}>
                                    {s.direction === 'sale' ? 'Vente' : 'Achat'}
                                  </span>
                                  {s.worksiteRef ? `${s.worksiteRef} · ` : ''}{s.label} · {formatDateBE(s.date)}
                                </span>
                                <Money value={s.amount} />
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

      {data && (
        <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      )}
    </>
  );
}
