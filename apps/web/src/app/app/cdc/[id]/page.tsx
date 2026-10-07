'use client';
import { SkeletonRows, ErrorState } from '@/components/States';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl } from '@/lib/api';
import { PageHead } from '@/lib/ui';

type Block =
  | { type: 'p'; text: string }
  | { type: 'note'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] };
interface Section { id: string; title: string; blocks: Block[] }
interface Content { meta: Record<string, string>; sections: Section[] }
interface Cdc { id: string; worksiteId: string | null; quoteId: string | null; title: string; status: 'draft' | 'validated'; content: Content; todo: number; updatedAt: string }

const TODO = '[À compléter';
const hasTodo = (s: string) => s.includes(TODO);
const countTodos = (c: Content) => c.sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + (b.type === 'ul' ? b.items.filter(hasTodo).length : b.type === 'table' ? b.rows.flat().filter(hasTodo).length : hasTodo(b.text) ? 1 : 0), 0), 0);
const uid = () => Math.random().toString(36).slice(2, 8);

/**
 * Éditeur du cahier des charges : le brouillon vient du devis (lib/cdc.ts) ; ici on complète les points « [À compléter … ] »,
 * on précise produits et finitions, puis on exporte en PDF ou en Word.
 */
export default function CdcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, reload } = useApi<{ cdc: Cdc }>(`/api/cdc/${id}`);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState<Content | null>(null);
  const [status, setStatus] = useState<'draft' | 'validated'>('draft');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (data && !loaded.current) {
      loaded.current = true;
      setTitle(data.cdc.title); setContent(data.cdc.content); setStatus(data.cdc.status);
    }
  }, [data]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const todo = useMemo(() => (content ? countTodos(content) : 0), [content]);
  function edit(fn: (c: Content) => Content) { setContent((c) => (c ? fn(c) : c)); setDirty(true); setMsg(null); }
  const setSection = (si: number, fn: (s: Section) => Section) => edit((c) => ({ ...c, sections: c.sections.map((s, i) => (i === si ? fn(s) : s)) }));
  const setBlock = (si: number, bi: number, b: Block) => setSection(si, (s) => ({ ...s, blocks: s.blocks.map((x, i) => (i === bi ? b : x)) }));
  const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const n = [...arr]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; };

  async function save(nextStatus?: 'draft' | 'validated') {
    if (!content) return;
    setBusy(true);
    try {
      const r = await api<{ cdc: Cdc }>(`/api/cdc/${id}`, { method: 'PUT', body: { title, content, ...(nextStatus ? { status: nextStatus } : {}) } });
      setStatus(r.cdc.status); setDirty(false);
      setMsg({ ok: true, text: nextStatus === 'validated' ? 'Cahier des charges validé et enregistré.' : 'Enregistré.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Enregistrement impossible.' }); }
    finally { setBusy(false); }
  }
  async function download(kind: 'pdf' | 'docx') {
    if (dirty) await save();
    try {
      const url = await apiBlobUrl(`/api/cdc/${id}/${kind}`);
      if (kind === 'pdf') window.open(url, '_blank');
      else { const a = document.createElement('a'); a.href = url; a.download = `CDC_${content?.meta.reference ?? 'chantier'}.docx`; a.click(); }
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Export impossible.' }); }
  }
  async function regenerate() {
    if (!data?.cdc.quoteId) return;
    if (!window.confirm('Générer une NOUVELLE version depuis le devis ? La version actuelle est conservée (tu pourras la supprimer ensuite).')) return;
    try {
      const r = await api<{ cdc: Cdc }>(`/api/cdc/from-quote/${data.cdc.quoteId}`, { method: 'POST', body: { fresh: true } });
      router.push(`/app/cdc/${r.cdc.id}`);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Génération impossible.' }); }
  }
  async function remove() {
    if (!window.confirm('Supprimer ce cahier des charges ?')) return;
    await api(`/api/cdc/${id}`, { method: 'DELETE' });
    router.push(data?.cdc.worksiteId ? `/app/chantiers/${data.cdc.worksiteId}` : '/app/documents');
  }

  if (loading && !data) return <SkeletonRows />;
  if (error || !data || !content) return <ErrorState message={error ?? 'Cahier des charges introuvable'} onRetry={reload} />;
  const ref = content.meta.reference;

  return (
    <>
      <PageHead
        eyebrow={`Cahier des charges · ${ref}`}
        title={title || 'Cahier des charges'}
        sub={status === 'validated' ? 'Validé' : 'Brouillon à relire et compléter'}
        action={(
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {data.cdc.worksiteId && <Link className="btn" href={`/app/chantiers/${data.cdc.worksiteId}`}>← Chantier</Link>}
            <button className="btn" onClick={() => download('pdf')}>PDF</button>
            <button className="btn" onClick={() => download('docx')}>Word</button>
            <button className="btn primary" disabled={busy || !dirty} onClick={() => save()}>{busy ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</button>
          </div>
        )}
      />

      {msg && <p className={msg.ok ? 'state' : 'state error'} role="status">{msg.text}</p>}

      <div className="card card-pad" style={{ marginBottom: '1rem', display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`badge ${todo > 0 ? 'warn' : 'ok'}`}>{todo > 0 ? `${todo} point${todo > 1 ? 's' : ''} à compléter` : 'Rien à compléter'}</span>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Le but : cadenasser ce qui est compris ou non, les finitions attendues et le choix des produits. Les lignes surlignées en jaune restent à remplir.
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {status === 'draft'
            ? <button className="btn" disabled={busy} onClick={() => save('validated')} title="Marque le document comme définitif (reste modifiable)">Marquer validé</button>
            : <button className="btn" disabled={busy} onClick={() => save('draft')}>Repasser en brouillon</button>}
          {data.cdc.quoteId && <button className="btn" onClick={regenerate} title="Recrée un brouillon depuis le devis (utile si le devis a changé)">Régénérer depuis le devis</button>}
          <button className="btn ghost" onClick={remove}>Supprimer</button>
        </span>
      </div>

      <div className="field full" style={{ marginBottom: '1rem' }}>
        <label>Titre du document</label>
        <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
      </div>

      {content.sections.map((s, si) => (
        <section key={s.id + si} className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.6rem' }}>
            <strong style={{ minWidth: 26 }}>{si + 1}.</strong>
            <input className="input" style={{ fontWeight: 600 }} value={s.title} onChange={(e) => setSection(si, (x) => ({ ...x, title: e.target.value }))} aria-label="Titre de la section" />
            <button className="btn ghost" title="Monter" onClick={() => edit((c) => ({ ...c, sections: move(c.sections, si, -1) }))}>↑</button>
            <button className="btn ghost" title="Descendre" onClick={() => edit((c) => ({ ...c, sections: move(c.sections, si, 1) }))}>↓</button>
            <button className="btn ghost" title="Supprimer la section" onClick={() => { if (window.confirm(`Supprimer la section « ${s.title} » ?`)) edit((c) => ({ ...c, sections: c.sections.filter((_, i) => i !== si) })); }}>✕</button>
          </div>

          {s.blocks.map((b, bi) => (
            <div key={bi} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {(b.type === 'p' || b.type === 'note') && (
                  <textarea
                    className="input" rows={Math.max(2, Math.ceil(b.text.length / 110))} value={b.text}
                    style={{ ...(hasTodo(b.text) ? todoStyle : {}), ...(b.type === 'note' ? { borderLeft: '3px solid var(--gold)' } : {}) }}
                    onChange={(e) => setBlock(si, bi, { ...b, text: e.target.value })}
                    aria-label={b.type === 'note' ? 'Remarque' : 'Paragraphe'}
                  />
                )}
                {b.type === 'ul' && (
                  <>
                    <textarea
                      className="input" rows={Math.max(3, b.items.length + 1)} value={b.items.join('\n')}
                      style={b.items.some(hasTodo) ? todoStyle : undefined}
                      onChange={(e) => setBlock(si, bi, { ...b, items: e.target.value.split('\n') })}
                      aria-label="Liste (une puce par ligne)"
                    />
                    <small className="muted">Une puce par ligne.</small>
                  </>
                )}
                {b.type === 'table' && <TableEditor b={b} onChange={(nb) => setBlock(si, bi, nb)} />}
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                <button className="btn ghost" style={mini} title="Monter" onClick={() => setSection(si, (x) => ({ ...x, blocks: move(x.blocks, bi, -1) }))}>↑</button>
                <button className="btn ghost" style={mini} title="Descendre" onClick={() => setSection(si, (x) => ({ ...x, blocks: move(x.blocks, bi, 1) }))}>↓</button>
                <button className="btn ghost" style={mini} title="Supprimer ce bloc" onClick={() => setSection(si, (x) => ({ ...x, blocks: x.blocks.filter((_, i) => i !== bi) }))}>✕</button>
              </div>
            </div>
          ))}

          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <button className="btn ghost" style={addBtn} onClick={() => setSection(si, (x) => ({ ...x, blocks: [...x.blocks, { type: 'p', text: '' }] }))}>+ Paragraphe</button>
            <button className="btn ghost" style={addBtn} onClick={() => setSection(si, (x) => ({ ...x, blocks: [...x.blocks, { type: 'ul', items: [''] }] }))}>+ Liste</button>
            <button className="btn ghost" style={addBtn} onClick={() => setSection(si, (x) => ({ ...x, blocks: [...x.blocks, { type: 'note', text: '' }] }))}>+ Remarque</button>
            <button className="btn ghost" style={addBtn} onClick={() => setSection(si, (x) => ({ ...x, blocks: [...x.blocks, { type: 'table', head: ['Poste', 'Détail'], rows: [['', '']] }] }))}>+ Tableau</button>
          </div>
        </section>
      ))}

      <button className="btn" onClick={() => edit((c) => ({ ...c, sections: [...c.sections, { id: `s-${uid()}`, title: 'Nouvelle section', blocks: [{ type: 'p', text: '' }] }] }))}>+ Ajouter une section</button>
    </>
  );
}

const todoStyle: React.CSSProperties = { background: '#fff8d6', borderColor: '#e0c24a' };
const mini: React.CSSProperties = { padding: '0.1rem 0.4rem', fontSize: '0.78rem', lineHeight: 1.2 };
const addBtn: React.CSSProperties = { padding: '0.2rem 0.6rem', fontSize: '0.8rem' };

function TableEditor({ b, onChange }: { b: Extract<Block, { type: 'table' }>; onChange: (b: Extract<Block, { type: 'table' }>) => void }) {
  const setCell = (ri: number, ci: number, v: string) => onChange({ ...b, rows: b.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{b.head.map((h, ci) => <th key={ci}><input className="input" style={{ fontWeight: 600 }} value={h} onChange={(e) => onChange({ ...b, head: b.head.map((x, j) => (j === ci ? e.target.value : x)) })} aria-label="En-tête de colonne" /></th>)}<th /></tr></thead>
        <tbody>
          {b.rows.map((r, ri) => (
            <tr key={ri}>
              {b.head.map((_, ci) => (
                <td key={ci}><textarea className="input" rows={1} style={hasTodo(r[ci] ?? '') ? todoStyle : undefined} value={r[ci] ?? ''} onChange={(e) => setCell(ri, ci, e.target.value)} aria-label="Cellule" /></td>
              ))}
              <td style={{ width: 28 }}><button className="btn ghost" style={mini} title="Supprimer la ligne" onClick={() => onChange({ ...b, rows: b.rows.filter((_, i) => i !== ri) })}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn ghost" style={addBtn} onClick={() => onChange({ ...b, rows: [...b.rows, b.head.map(() => '')] })}>+ Ligne</button>
    </div>
  );
}
