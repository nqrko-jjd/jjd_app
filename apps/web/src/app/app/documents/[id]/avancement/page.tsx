'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiBlobUrl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState } from '@/components/States';

interface Item { id: string; label: string; qty: number; unit: string | null; totalHt: number }
interface Statement {
  id: string; seq: number; number: string; status: 'draft' | 'validated' | 'invoiced'; invoiceId: string | null; createdAt: string; totalHt: number;
  invoice: { id: string; number: string | null; draftRef: string | null; status: string } | null;
  lines: { quoteLineId: string; cumulativePct: number; amountHt: number }[];
}
interface Data {
  quote: { id: string; number: string | null; draftRef: string | null; title: string | null; lockedAt: string | null; worksite: { ref: string; title: string } | null; contact: { name: string } | null };
  items: Item[]; statements: Statement[]; depositRatio: number; quoteTotalHt: number;
}
const STATUS: Record<string, { label: string; tone: string }> = { draft: { label: 'Brouillon', tone: 'plain' }, validated: { label: 'Validé', tone: 'ok' }, invoiced: { label: 'Facturé', tone: 'primary' } };
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * États d'avancement d'un devis : on saisit l'avancement CUMULÉ (%) de chaque ligne ; le montant de l'état = total de la ligne × (cumulé − précédent).
 * « Facturer » crée une facture brouillon (acomptes déjà facturés déduits au prorata).
 */
export default function ProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Data>(`/api/progress/quote/${id}`);
  const [sel, setSel] = useState<string | null>(null);
  const [pcts, setPcts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const statements = data?.statements ?? [];
  const current = statements.find((s) => s.id === sel) ?? statements[statements.length - 1] ?? null;
  const prev = current ? statements.find((s) => s.seq === current.seq - 1) ?? null : null;

  // (ré)initialise les champs quand on change d'état ou que les données se rechargent
  useEffect(() => {
    if (!current) return;
    setPcts(Object.fromEntries(current.lines.map((l) => [l.quoteLineId, String(l.cumulativePct)])));
  }, [current?.id, data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <SkeletonRows />;
  if (error || !data) return <ErrorState message={error ?? 'Introuvable'} onRetry={reload} />;

  const editable = current?.status === 'draft';
  const prevPct = (lineId: string) => prev?.lines.find((l) => l.quoteLineId === lineId)?.cumulativePct ?? 0;
  const num = (v: string | undefined) => { const n = Number((v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const liveAmount = (it: Item) => round2((it.totalHt * (num(pcts[it.id]) - prevPct(it.id))) / 100);
  const liveTotal = round2(data.items.reduce((s, it) => s + liveAmount(it), 0));
  const cumTotal = round2(data.items.reduce((s, it) => s + (it.totalHt * num(pcts[it.id])) / 100, 0));
  const dedRatio = data.depositRatio;

  async function run<T>(key: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(key); setMsg(null);
    try { const r = await fn(); after?.(r); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  }
  const save = () => run('save', () => api(`/api/progress/${current!.id}`, { method: 'PATCH', body: { lines: data.items.map((it) => ({ quoteLineId: it.id, cumulativePct: num(pcts[it.id]) })) } }));

  return (
    <>
      <PageHead
        eyebrow="Facturation"
        title={`États d’avancement · devis ${data.quote.number ?? data.quote.draftRef}`}
        sub={[data.quote.title, data.quote.worksite && `${data.quote.worksite.ref}`, data.quote.contact?.name].filter(Boolean).join(' · ')}
        action={<div className="row">
          <Link className="btn" href={`/app/documents/${id}`}>← Retour au devis</Link>
          <button className="btn primary" disabled={!!busy || !data.quote.lockedAt || statements.some((s) => s.status === 'draft')} onClick={() => run('new', () => api(`/api/progress/quote/${id}`, { method: 'POST', body: {} }), () => setSel(null))}>
            + Nouvel état d’avancement
          </button>
        </div>}
      />
      {!data.quote.lockedAt && <div className="badge warn" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>Émettez d’abord le devis pour pouvoir créer des états d’avancement.</div>}
      {msg && <div className="badge crit" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg}</div>}

      {statements.length === 0 ? (
        <div className="panel" style={{ padding: '1.2rem' }}>
          <p style={{ margin: 0 }}>Aucun état d’avancement pour l’instant. Un état permet de facturer le client au fil de l’avancement, ligne par ligne (par exemple « gros œuvre : 80 % »).</p>
          <p className="muted" style={{ margin: '0.5rem 0 0' }}>Les acomptes déjà facturés sont déduits <strong>au prorata</strong> de chaque état.</p>
        </div>
      ) : (
        <>
          <div className="seg" style={{ marginBottom: '1rem' }}>
            {statements.map((s) => (
              <button key={s.id} className={current?.id === s.id ? 'on' : ''} onClick={() => setSel(s.id)}>
                {s.number} · {STATUS[s.status]!.label}
              </button>
            ))}
          </div>

          {current && (
            <div className="panel" style={{ padding: '1rem', overflowX: 'auto' }}>
              <div className="row" style={{ marginBottom: '0.8rem', alignItems: 'center', gap: '0.6rem' }}>
                <strong>{current.number}</strong>
                <span className={`badge ${STATUS[current.status]!.tone}`}>{STATUS[current.status]!.label}</span>
                <span className="muted" style={{ fontSize: '0.84rem' }}>créé le {formatDateBE(current.createdAt)}</span>
                {current.invoice && <Link className="chip" href={`/app/documents/${current.invoice.id}`}>Facture {current.invoice.number ?? current.invoice.draftRef} →</Link>}
              </div>
              <table className="tbl" style={{ minWidth: 720 }}>
                <thead>
                  <tr><th>Désignation</th><th style={{ textAlign: 'right' }}>Devis HT</th><th style={{ textAlign: 'right' }}>Déjà</th><th style={{ textAlign: 'right' }}>Avancement cumulé</th><th style={{ textAlign: 'right' }}>Cet état HT</th><th style={{ textAlign: 'right' }}>Total cumulé HT</th></tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.label}</td>
                      <td style={{ textAlign: 'right' }}>{formatEur(it.totalHt)}</td>
                      <td style={{ textAlign: 'right' }} className="muted">{prevPct(it.id)} %</td>
                      <td style={{ textAlign: 'right' }}>
                        {editable
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><input className="input" inputMode="decimal" style={{ width: 70, textAlign: 'right' }} value={pcts[it.id] ?? ''} onChange={(e) => setPcts((p) => ({ ...p, [it.id]: e.target.value }))} aria-label={`Avancement de ${it.label}`} />%</span>
                          : `${num(pcts[it.id])} %`}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatEur(liveAmount(it))}</td>
                      <td style={{ textAlign: 'right' }}>{formatEur(round2((it.totalHt * num(pcts[it.id])) / 100))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 800 }}>
                    <td>Total</td><td style={{ textAlign: 'right' }}>{formatEur(data.quoteTotalHt)}</td><td /><td style={{ textAlign: 'right' }}>{data.quoteTotalHt > 0 ? round2((cumTotal / data.quoteTotalHt) * 100) : 0} %</td>
                    <td style={{ textAlign: 'right' }}>{formatEur(liveTotal)}</td><td style={{ textAlign: 'right' }}>{formatEur(cumTotal)}</td>
                  </tr>
                </tfoot>
              </table>
              {dedRatio > 0 && (
                <p className="muted" style={{ margin: '0.8rem 0 0', fontSize: '0.86rem' }}>
                  Acompte déjà facturé : {round2(dedRatio * 100)} % du devis → déduit au prorata sur la facture : <strong>− {formatEur(round2(liveTotal * dedRatio))} HT</strong>, soit <strong>{formatEur(round2(liveTotal * (1 - dedRatio)))} HT à facturer</strong> pour cet état.
                </p>
              )}
              <div className="row" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                {editable && <button className="btn" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}</button>}
                {editable && <button className="btn" disabled={!!busy} onClick={() => run('validate', async () => { await save_(); return api(`/api/progress/${current.id}/validate`, { method: 'POST', body: {} }); })}>Valider</button>}
                {current.status !== 'invoiced' && (
                  <button className="btn primary" disabled={!!busy} onClick={() => run('invoice', async () => { if (editable) await save_(); return api<{ document: { id: string } }>(`/api/progress/${current.id}/invoice`, { method: 'POST', body: {} }); }, (r) => router.push(`/app/documents/${r.document.id}`))}>Facturer</button>
                )}
                {current.status === 'validated' && current.seq === statements.length && <button className="btn ghost" disabled={!!busy} onClick={() => run('reopen', () => api(`/api/progress/${current.id}/reopen`, { method: 'POST', body: {} }))}>Rouvrir</button>}
                <button className="btn ghost" onClick={async () => { try { window.open(await apiBlobUrl(`/api/progress/${current.id}/pdf`), '_blank'); } catch (e) { setMsg((e as Error).message); } }}>Télécharger le PDF</button>
                {editable && <button className="btn ghost" style={{ color: 'var(--crit)' }} disabled={!!busy} onClick={() => { if (window.confirm('Supprimer cet état en brouillon ?')) run('del', () => api(`/api/progress/${current.id}`, { method: 'DELETE' }), () => setSel(null)); }}>Supprimer le brouillon</button>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  async function save_() {
    await api(`/api/progress/${current!.id}`, { method: 'PATCH', body: { lines: data!.items.map((it) => ({ quoteLineId: it.id, cumulativePct: num(pcts[it.id]) })) } });
  }
}
