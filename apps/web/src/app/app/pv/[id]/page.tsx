'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, apiBlobUrl } from '@/lib/api';
import { PageHead, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState } from '@/components/States';
import { SignaturePad } from '@/components/SignaturePad';

interface Reserve { id: string; description: string; liftedAt: string | null; liftedNote: string | null }
interface Pv {
  id: string; status: string; date: string; receptionResult: string | null; presentParties: string | null; quoteRef: string | null; placeSigned: string | null; notes: string | null;
  clientName: string | null; signedAt: string | null; reserves: Reserve[];
  worksite: { id: string; ref: string; title: string; client: { name: string } | null };
}
const RESULTS = [['none', 'Réception sans réserve'], ['with_reserves', 'Réception avec réserve(s)'], ['refused', 'Réception refusée']] as const;
const toDay = (iso: string) => iso.slice(0, 10);

/**
 * PV de réception des travaux, à la demande : on choisit le résultat, on liste les réserves, le client signe, puis PDF.
 * Après signature, seules les réserves peuvent encore être levées (et donner un PV de levée des réserves).
 */
export default function PvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sp = useSearchParams();
  const [pv, setPv] = useState<Pv | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reserve, setReserve] = useState('');
  const [signing, setSigning] = useState(false);
  const [clientName, setClientName] = useState('');

  // /app/pv/new?worksite=… : crée le PV puis ouvre sa page
  useEffect(() => {
    if (id !== 'new') return;
    const worksiteId = sp.get('worksite');
    if (!worksiteId) { setErr('Chantier manquant.'); return; }
    api<{ report: { id: string } }>('/api/pv', { method: 'POST', body: { worksiteId } }).then((r) => router.replace(`/app/pv/${r.report.id}`)).catch((e) => setErr((e as Error).message));
  }, [id, sp, router]);
  useEffect(() => {
    if (id === 'new') return;
    api<{ report: Pv }>(`/api/pv/${id}`).then((r) => { setPv(r.report); setClientName(r.report.clientName ?? r.report.worksite.client?.name ?? ''); }).catch((e) => setErr((e as Error).message));
  }, [id]);

  if (err) return <ErrorState message={err} onRetry={() => location.reload()} />;
  if (!pv) return <SkeletonRows />;
  const signed = pv.status === 'signed';
  const open = pv.reserves.filter((r) => !r.liftedAt).length;

  async function run(fn: () => Promise<{ report?: Pv } | void>, ok?: string) {
    setBusy(true); setMsg(null);
    try { const r = await fn(); if (r && 'report' in r && r.report) setPv(r.report); if (ok) setMsg(ok); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const patch = (body: object) => run(() => api<{ report: Pv }>(`/api/pv/${pv.id}`, { method: 'PATCH', body }));
  const pdf = async (lifted: boolean) => { try { window.open(await apiBlobUrl(`/api/pv/${pv.id}/pdf${lifted ? '?lifted=1' : ''}`), '_blank'); } catch (e) { setMsg((e as Error).message); } };

  return (
    <>
      <PageHead
        eyebrow="Chantier"
        title="PV de réception des travaux"
        sub={`${pv.worksite.ref} — ${pv.worksite.title}${pv.worksite.client ? ` · ${pv.worksite.client.name}` : ''}`}
        action={<div className="row"><Link className="btn" href={`/app/chantiers/${pv.worksite.id}`}>← Chantier</Link><button className="btn" onClick={() => pdf(false)}>PDF du PV</button></div>}
      />
      {msg && <div className="badge warn" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg}</div>}
      {signed && <div className="badge ok" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>✓ Signé par {pv.clientName} le {pv.signedAt ? formatDateBE(pv.signedAt) : ''}{open ? ` · ${open} réserve(s) à lever` : pv.reserves.length ? ' · toutes les réserves sont levées' : ''}</div>}

      <div className="panel" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
        <div className="row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
          <div className="field"><label>Date de réception</label><input className="input" type="date" disabled={signed} defaultValue={toDay(pv.date)} onBlur={(e) => e.target.value && patch({ date: e.target.value })} /></div>
          <div className="field"><label>Devis / marché concerné</label><input className="input" disabled={signed} defaultValue={pv.quoteRef ?? ''} placeholder="ex. D2026-277" onBlur={(e) => patch({ quoteRef: e.target.value })} /></div>
        </div>
        <div className="field"><label>Résultat de la réception</label>
          <div className="seg">{RESULTS.map(([k, label]) => <button key={k} type="button" disabled={signed} className={pv.receptionResult === k ? 'on' : ''} onClick={() => patch({ receptionResult: k })}>{label}</button>)}</div>
        </div>
        <div className="field"><label>Personnes présentes</label><input className="input" disabled={signed} defaultValue={pv.presentParties ?? ''} placeholder="ex. M. Dupont (propriétaire), Julien (JJD)" onBlur={(e) => patch({ presentParties: e.target.value })} /></div>

        <div>
          <strong>Réserves ({pv.reserves.length})</strong>
          <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.5rem' }}>
            {pv.reserves.length === 0 && <span className="muted">Aucune réserve.</span>}
            {pv.reserves.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.4rem 0', borderBottom: '1px solid var(--line)' }}>
                <span className="mono" style={{ width: 24 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 200, textDecoration: r.liftedAt ? 'line-through' : undefined }}>{r.description}</span>
                {r.liftedAt ? <span className="badge ok">Levée le {formatDateBE(r.liftedAt)}</span> : <span className="badge warn">À lever</span>}
                {signed || r.liftedAt
                  ? <button className="btn ghost" disabled={busy} onClick={() => run(() => api<{ report: Pv }>(`/api/pv/${pv.id}/reserves/${r.id}`, { method: 'PATCH', body: { lifted: !r.liftedAt } }))}>{r.liftedAt ? 'Rouvrir' : 'Marquer levée'}</button>
                  : <><button className="btn ghost" disabled={busy} onClick={() => run(() => api<{ report: Pv }>(`/api/pv/${pv.id}/reserves/${r.id}`, { method: 'PATCH', body: { lifted: true } }))}>Marquer levée</button><button className="btn ghost" disabled={busy} aria-label="Supprimer la réserve" onClick={() => run(() => api<{ report: Pv }>(`/api/pv/${pv.id}/reserves/${r.id}`, { method: 'DELETE' }))}>✕</button></>}
              </div>
            ))}
          </div>
          {!signed && (
            <form className="row" style={{ gap: '0.5rem', marginTop: '0.6rem' }} onSubmit={(e) => { e.preventDefault(); if (reserve.trim().length < 3) return; run(() => api<{ report: Pv }>(`/api/pv/${pv.id}/reserves`, { method: 'POST', body: { description: reserve } })).then(() => setReserve('')); }}>
              <input className="input" style={{ flex: 1 }} placeholder="Décrire la réserve (ex. joint de la douche à reprendre)" value={reserve} onChange={(e) => setReserve(e.target.value)} />
              <button className="btn" type="submit" disabled={busy}>+ Ajouter la réserve</button>
            </form>
          )}
        </div>

        <div className="field"><label>Remarques</label><textarea className="input" rows={3} disabled={signed} defaultValue={pv.notes ?? ''} onBlur={(e) => patch({ notes: e.target.value })} /></div>
        <div className="field"><label>Fait à</label><input className="input" style={{ maxWidth: 260 }} disabled={signed} defaultValue={pv.placeSigned ?? ''} placeholder="ville" onBlur={(e) => patch({ placeSigned: e.target.value })} /></div>

        {!signed && (signing ? (
          <div className="panel" style={{ padding: '1rem' }}>
            <div className="field"><label>Nom de la personne qui signe</label><input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
            <p className="muted" style={{ margin: '0.4rem 0' }}>Signature du maître d’ouvrage :</p>
            <SignaturePad onEmpty={() => setMsg('Signez d’abord dans le cadre.')} onDone={(signature) => { if (clientName.trim().length < 2) { setMsg('Indiquez le nom du signataire.'); return; } run(() => api<{ report: Pv }>(`/api/pv/${pv.id}/sign`, { method: 'POST', body: { clientName, signature } }), 'PV signé.').then(() => setSigning(false)); }} />
          </div>
        ) : <div><button className="btn primary" onClick={() => setSigning(true)}>Faire signer le client</button> <span className="muted" style={{ fontSize: '0.84rem' }}>Une fois signé, le PV ne se modifie plus ; seules les réserves peuvent être levées.</span></div>)}

        {signed && pv.reserves.length > 0 && (
          <div><button className="btn" onClick={() => pdf(true)}>PDF du PV de levée des réserves</button></div>
        )}
      </div>
    </>
  );
}
