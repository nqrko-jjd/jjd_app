'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { api, apiBlobUrl } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { Wallet } from 'lucide-react';

interface Sug { worksiteId: string; ref: string; title: string; city: string | null; onDay: boolean; planned: number; people: number; hours: number }
interface Row {
  id: string; date: string | null; supplier: string | null; docNumber: string | null; category: string | null; ht: number; ttc: number | null;
  worksite: { id: string; ref: string; title: string } | null; hasPdf: boolean; suggestions: Sug[];
}
interface Data { items: Row[]; total: number; totalHt: number; page: number; totalPages: number; window: number }

/**
 * Dépenses du poste E-01 « Matériel sans chantier » à imputer : pour chaque dépense, les chantiers actifs le jour de l'achat
 * (planning + heures pointées), d'un clic pour l'imputer. Rien n'est modifié tant qu'on ne clique pas sur un chantier ; « Annuler » remet l'ancien poste.
 */
export default function SansChantierPage() {
  const [q, setQ] = useState('');
  const [win, setWin] = useState(0);
  const [page, setPage] = useState(1);
  const qs = useMemo(() => new URLSearchParams({ window: String(win), page: String(page), pageSize: '40', ...(q.trim() ? { q: q.trim() } : {}) }).toString(), [q, win, page]);
  const { data, error, loading, reload } = useApi<Data>(`/api/finance/expenses/unassigned?${qs}`);
  const { data: pick } = useApi<{ worksites: { id: string; name: string }[] }>('/api/meta/pickers');
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string; undo?: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; title: string } | null>(null); // PDF affiché à côté de la liste

  if (loading && !data) return <SkeletonRows />;
  if (error || !data) return <ErrorState message={error ?? 'Erreur'} onRetry={reload} />;

  async function assign(r: Row, worksiteId: string, label: string) {
    setBusy(r.id); setMsg(null);
    try {
      await api(`/api/finance/expenses/${r.id}`, { method: 'PATCH', body: { worksiteId } });
      setGone((g) => new Set(g).add(r.id));
      const prev = r.worksite?.id ?? null;
      setMsg({ ok: true, text: `${r.supplier ?? 'Dépense'} ${formatEur(r.ht)} HT imputée à ${label}.`, undo: async () => {
        try { await api(`/api/finance/expenses/${r.id}`, { method: 'PATCH', body: { worksiteId: prev } }); setGone((g) => { const n = new Set(g); n.delete(r.id); return n; }); setMsg({ ok: true, text: 'Imputation annulée.' }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
      } });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }
  async function viewPdf(r: Row) {
    try { setPreview({ id: r.id, url: await apiBlobUrl(`/api/finance/expenses/${r.id}/pdf`), title: `${r.supplier ?? 'Dépense'}${r.docNumber ? ` · ${r.docNumber}` : ''}` }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  const items = data.items.filter((r) => !gone.has(r.id));

  return (
    <>
      <PageHead
        eyebrow="Comptabilité"
        title="Dépenses sans chantier"
        sub={`${data.total} dépense${data.total > 1 ? 's' : ''} · ${formatEur(data.totalHt)} HT sur E-01 « Matériel sans chantier » · choisis le chantier où ça a servi`}
        action={<Link className="btn" href="/app/achats">← Achats / Dépenses</Link>}
      />
      {msg && (
        <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <span>{msg.text}</span>{msg.undo && <button className="btn ghost" onClick={msg.undo}>Annuler</button>}
        </div>
      )}
      <div className="row" style={{ gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Fournisseur, n°…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.88rem' }}>
          Chantiers actifs
          <select className="select" style={{ width: 'auto' }} value={win} onChange={(e) => { setWin(Number(e.target.value)); setPage(1); }}>
            <option value={0}>ce jour-là</option><option value={1}>± 1 jour</option><option value={2}>± 2 jours</option><option value={3}>± 3 jours</option>
          </select>
        </label>
      </div>

      <div style={preview ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 46%)', gap: '1rem', alignItems: 'start' } : undefined}>
      <div>
      {items.length === 0 ? <EmptyState icon={Wallet} title="Rien à imputer" text="Aucune dépense sans chantier ne correspond." /> : (
        <div className="panel doc-list">
          {items.map((r) => (
            <div key={r.id} className="doc-item">
              <div className="doc-item-body">
                <div className="doc-item-top" style={{ flexWrap: 'wrap' }}>
                  <span className="mono doc-item-num">{r.date ? formatDateBE(r.date) : 'sans date'}</span>
                  {r.worksite && <span className="chip">{r.worksite.ref}</span>}
                  {r.category && <span className="badge plain">{r.category}</span>}
                  <span className="doc-item-amount" style={{ marginLeft: 'auto' }}>{formatEur(r.ht)} HT{r.ttc != null ? ` · ${formatEur(r.ttc)} TTC` : ''}</span>
                </div>
                <div className="doc-item-title">{r.supplier ?? '—'}{r.docNumber ? ` · ${r.docNumber}` : ''}{r.hasPdf ? <button className="btn" style={{ marginLeft: 8, padding: '0.1rem 0.6rem', fontSize: '0.8rem' }} onClick={() => viewPdf(r)}>📄 Voir le PDF</button> : <span className="muted" style={{ marginLeft: 8, fontSize: '0.78rem' }}>pas de pièce jointe</span>}</div>
                <div className="row" style={{ marginTop: '0.5rem', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {r.suggestions.length === 0 && <span className="muted" style={{ fontSize: '0.84rem' }}>{r.date ? 'Aucun chantier actif ce jour-là dans le planning ni les pointages.' : 'Pas de date : impossible de proposer des chantiers.'}</span>}
                  {r.suggestions.map((s) => (
                    <button key={s.worksiteId} className="btn" disabled={busy === r.id} onClick={() => assign(r, s.worksiteId, `${s.ref} · ${s.title}`)} title={`${s.title}${s.city ? ` — ${s.city}` : ''}`}>
                      <strong>{s.ref}</strong> {s.title.length > 34 ? `${s.title.slice(0, 33)}…` : s.title}
                      <span className="muted" style={{ marginLeft: 6, fontSize: '0.78rem' }}>
                        {s.onDay ? 'ce jour' : 'à côté'}{s.hours ? ` · ${String(s.hours).replace('.', ',')} h` : ''}{s.people ? ` · ${s.people} pers.` : ''}{s.planned ? ` · planning ×${s.planned}` : ''}
                      </span>
                    </button>
                  ))}
                  <select className="select" style={{ width: 'auto', maxWidth: 240 }} value="" disabled={busy === r.id} aria-label="Autre chantier"
                    onChange={(e) => { const w = pick?.worksites.find((x) => x.id === e.target.value); if (w) assign(r, w.id, w.name); }}>
                    <option value="">Autre chantier…</option>
                    {(pick?.worksites ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      </div>
      {preview && (
        <aside className="panel" style={{ position: 'sticky', top: 12, padding: '0.6rem', display: 'grid', gap: '0.5rem' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <strong style={{ fontSize: '0.9rem' }}>{preview.title}</strong>
            <span className="row" style={{ gap: '0.3rem' }}>
              <a className="btn ghost" href={preview.url} target="_blank" rel="noreferrer">Ouvrir dans un onglet</a>
              <button className="btn ghost" onClick={() => setPreview(null)} aria-label="Fermer l’aperçu">✕</button>
            </span>
          </div>
          <iframe title="Pièce jointe" src={preview.url} style={{ width: '100%', height: '78vh', border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
        </aside>
      )}
      </div>

      {data.totalPages > 1 && (
        <div className="row" style={{ justifyContent: 'center', gap: '0.6rem', marginTop: '1rem' }}>
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Précédent</button>
          <span className="muted">Page {data.page} / {data.totalPages}</span>
          <button className="btn" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Suivant →</button>
        </div>
      )}
    </>
  );
}
