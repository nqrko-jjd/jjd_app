'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { api, apiUpload } from '@/lib/api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';

interface Cand { id: string; date: string | null; supplier: string | null; docNumber: string | null; ht: number; ttc: number | null; worksiteRef: string | null; score: number; reasons: string[] }
interface Item {
  key: string; file: File; state: 'reading' | 'done' | 'error' | 'attached';
  extraction?: { docNumber: string | null; issuedOn: string | null; totalHt: number | null; totalTtc: number | null; contactName: string | null; textExtracted: boolean };
  candidates: Cand[]; chosen: string; error?: string;
}
const STRONG = 7; // n° de facture + montant, ou montant + date + fournisseur : proposé d'office

/**
 * Import en masse de PDF dans les dépenses existantes qui n'en ont pas (ex. factures sorties de Fox) : on dépose les PDF, JJD les lit et propose la
 * dépense qui correspond (n° de facture ou montant). Rien n'est joint sans validation ; les correspondances très sûres sont pré-cochées.
 */
export default function ImporterPdfPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  async function addFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!files.length) { setMsg({ ok: false, text: 'Aucun PDF dans la sélection.' }); return; }
    const fresh: Item[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, file: f, state: 'reading', candidates: [], chosen: '' }));
    setItems((cur) => [...cur, ...fresh]); setMsg(null);
    // 2 lectures à la fois : l'extraction d'un PDF prend un moment
    const queue = [...fresh];
    await Promise.all([0, 1].map(async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        try {
          const fd = new FormData(); fd.append('file', it.file);
          const r = await apiUpload<{ extraction: Item['extraction']; candidates: Cand[] }>('/api/finance/expenses/match-pdf', fd);
          const top = r.candidates[0];
          // les candidates déjà choisies par un autre PDF ne sont pas re-proposées d'office
          patch(it.key, { state: 'done', extraction: r.extraction, candidates: r.candidates, chosen: top && top.score >= STRONG ? top.id : '' });
        } catch (e) { patch(it.key, { state: 'error', error: (e as Error).message }); }
      }
    }));
  }

  const chosenIds = items.filter((i) => i.state === 'done' && i.chosen).map((i) => i.chosen);
  const dup = new Set(chosenIds.filter((id, n) => chosenIds.indexOf(id) !== n));
  const ready = items.filter((i) => i.state === 'done' && i.chosen && !dup.has(i.chosen));

  async function attachAll() {
    setBusy(true); setMsg(null);
    let ok = 0; const failed: string[] = [];
    for (const it of ready) {
      try { const fd = new FormData(); fd.append('file', it.file); await apiUpload(`/api/finance/expenses/${it.chosen}/pdf`, fd); patch(it.key, { state: 'attached' }); ok++; }
      catch (e) { failed.push(`${it.file.name} : ${(e as Error).message}`); }
    }
    setBusy(false);
    setMsg({ ok: failed.length === 0, text: `${ok} PDF joint${ok > 1 ? 's' : ''}.${failed.length ? ` Échecs : ${failed.join(' ; ')}` : ''}` });
  }
  void api;

  return (
    <>
      <PageHead
        eyebrow="Comptabilité"
        title="Importer des PDF dans les dépenses"
        sub="Dépose les factures (par exemple exportées de Fox) : JJD retrouve la dépense qui correspond et y joint le PDF"
        action={<Link className="btn" href="/app/achats">← Achats / Dépenses</Link>}
      />
      {msg && <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg.text}</div>}
      <div
        className="panel" style={{ padding: '1.6rem', textAlign: 'center', borderStyle: 'dashed', marginBottom: '1rem' }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
      >
        <p style={{ margin: '0 0 0.6rem' }}>Glisse ici tes PDF (autant que tu veux), ou</p>
        <button className="btn primary" onClick={() => input.current?.click()}>Choisir des PDF</button>
        <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.84rem' }}>JJD ne propose une dépense que si le n° de facture ou le montant correspond, et seulement parmi celles qui n’ont pas encore de pièce jointe.</p>
      </div>

      {items.length > 0 && (
        <div className="panel" style={{ padding: '0.8rem', overflowX: 'auto' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="muted">{items.filter((i) => i.state === 'attached').length} joint(s) · {ready.length} prêt(s) · {items.filter((i) => i.state === 'done' && !i.chosen).length} sans correspondance choisie</span>
            <span className="row" style={{ gap: '0.4rem' }}>
              <button className="btn ghost" onClick={() => setItems((cur) => cur.filter((i) => i.state !== 'attached'))}>Retirer les joints</button>
              <button className="btn primary" disabled={busy || ready.length === 0} onClick={attachAll}>{busy ? 'Jonction…' : `Joindre ${ready.length} PDF`}</button>
            </span>
          </div>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>PDF</th><th>Lu dans le PDF</th><th>Dépense correspondante</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} style={it.state === 'attached' ? { opacity: 0.55 } : undefined}>
                  <td style={{ maxWidth: 220, wordBreak: 'break-word' }}>{it.file.name}</td>
                  <td style={{ fontSize: '0.84rem' }}>
                    {it.state === 'reading' && <span className="muted">Lecture…</span>}
                    {it.state === 'error' && <span className="badge crit">{it.error}</span>}
                    {it.extraction && (it.extraction.textExtracted
                      ? <>{it.extraction.contactName ?? 'fournisseur ?'}<br />{[it.extraction.docNumber, it.extraction.issuedOn && formatDateBE(it.extraction.issuedOn), it.extraction.totalTtc != null ? `${formatEur(it.extraction.totalTtc)} TTC` : it.extraction.totalHt != null ? `${formatEur(it.extraction.totalHt)} HT` : null].filter(Boolean).join(' · ')}</>
                      : <span className="muted">Texte illisible (scan) : à joindre à la main.</span>)}
                  </td>
                  <td>
                    {it.state === 'attached' && <span className="badge ok">Joint ✓</span>}
                    {it.state === 'done' && (it.candidates.length === 0
                      ? <span className="muted">Aucune dépense sans PDF ne correspond.</span>
                      : (
                        <select className="select" value={it.chosen} onChange={(e) => patch(it.key, { chosen: e.target.value })} style={{ maxWidth: 420 }}>
                          <option value="">— ne pas joindre —</option>
                          {it.candidates.map((c) => <option key={c.id} value={c.id}>{[c.date && formatDateBE(c.date), c.supplier, c.docNumber, c.ttc != null ? formatEur(c.ttc) : formatEur(c.ht), c.worksiteRef, `(${c.reasons.join(', ')})`].filter(Boolean).join(' · ')}</option>)}
                        </select>
                      ))}
                    {it.state === 'done' && it.chosen && dup.has(it.chosen) && <div className="badge warn" style={{ marginTop: 4 }}>Cette dépense est déjà choisie par un autre PDF.</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
