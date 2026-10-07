'use client';
import { SkeletonRows, ErrorState } from '@/components/States';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl } from '@/lib/api';
import { PageHead, Kpi, formatEur } from '@/lib/ui';
import { Wallet, ShoppingCart, PackageCheck } from 'lucide-react';

interface InternalItem { id: string; lot: string; label: string; qty: number; unit: string; estCostHt: number; supplier: string; status: 'todo' | 'ordered' | 'received'; note: string }
interface ClientItem { id: string; lot: string; label: string; proposal: string; detail: string; priceTtc: number | null; url: string; clientChoice: 'ok' | 'other' | null; clientComment: string; answeredAt: string | null }
interface List { id: string; worksiteId: string | null; quoteId: string | null; title: string; shared: boolean; shareToken: string | null; internalItems: InternalItem[]; clientItems: ClientItem[]; spentHt: number }

const STATUS: Record<InternalItem['status'], string> = { todo: 'À commander', ordered: 'Commandé', received: 'Reçu' };
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Liste d'achats d'un chantier. Onglet « Interne » : tout le matériel à acheter (budget estimé, fournisseur, avancement).
 * Onglet « Client » : les produits proposés au client, partageables par un lien public (aucun prix de revient ni fournisseur).
 */
export default function PurchaseListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, reload } = useApi<{ list: List }>(`/api/purchase-lists/${id}`);
  const [tab, setTab] = useState<'internal' | 'client'>('internal');
  const [title, setTitle] = useState('');
  const [internal, setInternal] = useState<InternalItem[]>([]);
  const [client, setClient] = useState<ClientItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (data && !loaded.current) { loaded.current = true; setTitle(data.list.title); setInternal(data.list.internalItems); setClient(data.list.clientItems); setShareToken(data.list.shareToken); }
  }, [data]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const total = useMemo(() => internal.reduce((s, i) => s + (Number(i.estCostHt) || 0), 0), [internal]);
  const lots = useMemo(() => [...new Set(internal.map((i) => i.lot))], [internal]);
  const clientLots = useMemo(() => [...new Set(client.map((i) => i.lot))], [client]);
  const received = internal.filter((i) => i.status === 'received').length;
  const spent = data?.list.spentHt ?? 0;

  const upInternal = (iid: string, patch: Partial<InternalItem>) => { setInternal((l) => l.map((i) => (i.id === iid ? { ...i, ...patch } : i))); setDirty(true); setMsg(null); };
  const upClient = (cid: string, patch: Partial<ClientItem>) => { setClient((l) => l.map((i) => (i.id === cid ? { ...i, ...patch } : i))); setDirty(true); setMsg(null); };

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ list: List }>(`/api/purchase-lists/${id}`, { method: 'PUT', body: { title, internalItems: internal, clientItems: client } });
      setClient(r.list.clientItems); setDirty(false); setMsg({ ok: true, text: 'Enregistré.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Enregistrement impossible.' }); }
    finally { setBusy(false); }
  }
  async function pdf(kind: 'internal' | 'client') {
    if (dirty) await save();
    try { window.open(await apiBlobUrl(`/api/purchase-lists/${id}/pdf?kind=${kind}`), '_blank'); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Export impossible.' }); }
  }
  async function share() {
    if (dirty) await save();
    try { const r = await api<{ token: string }>(`/api/purchase-lists/${id}/share`, { method: 'POST', body: {} }); setShareToken(r.token); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Impossible de créer le lien.' }); }
  }
  async function unshare() {
    if (!window.confirm('Désactiver le lien ? Le client ne pourra plus ouvrir la liste.')) return;
    await api(`/api/purchase-lists/${id}/share`, { method: 'DELETE' });
    setShareToken(null);
  }
  async function remove() {
    if (!window.confirm('Supprimer cette liste d’achats ?')) return;
    await api(`/api/purchase-lists/${id}`, { method: 'DELETE' });
    router.push(data?.list.worksiteId ? `/app/chantiers/${data.list.worksiteId}` : '/app/documents');
  }

  if (loading && !data) return <SkeletonRows />;
  if (error || !data) return <ErrorState message={error ?? 'Liste introuvable'} onRetry={reload} />;
  const url = shareToken && typeof window !== 'undefined' ? `${window.location.origin}/liste/${shareToken}` : '';
  const answered = client.filter((c) => c.clientChoice).length;

  return (
    <>
      <PageHead
        eyebrow="Liste d’achats"
        title={title || 'Liste d’achats'}
        sub="Tout le matériel du chantier (interne) et les produits proposés au client"
        action={(
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {data.list.worksiteId && <Link className="btn" href={`/app/chantiers/${data.list.worksiteId}`}>← Chantier</Link>}
            <button className="btn" onClick={() => pdf(tab)}>PDF</button>
            <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</button>
          </div>
        )}
      />
      {msg && <p className={msg.ok ? 'state' : 'state error'} role="status">{msg.text}</p>}

      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'internal' ? 'on' : ''} onClick={() => setTab('internal')}>Interne · {internal.length} article{internal.length > 1 ? 's' : ''}</button>
        <button className={tab === 'client' ? 'on' : ''} onClick={() => setTab('client')}>Client · {client.length} produit{client.length > 1 ? 's' : ''}{answered ? ` · ${answered} réponse${answered > 1 ? 's' : ''}` : ''}</button>
      </div>

      {tab === 'internal' && (
        <>
          <div className="kpis" style={{ marginBottom: '1.2rem' }}>
            <Kpi ic={ShoppingCart} label="Budget matériel estimé" value={formatEur(total)} sub="HT, part « fourniture » des postes du devis" hero />
            <Kpi ic={Wallet} label="Déjà acheté" value={formatEur(spent)} sub="Achats du chantier au grand livre (HT)" />
            <Kpi ic={PackageCheck} label="Reçus" value={`${received}/${internal.length}`} sub={total - spent < 0 ? `Dépassement de ${formatEur(spent - total)}` : `Reste estimé : ${formatEur(total - spent)}`} warn={total - spent < 0} />
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Le budget par article est une estimation (50 % du montant du poste) : corrige-le avec le vrai prix d’achat dès que tu as l’offre du fournisseur. Document interne : ne jamais l’envoyer au client.
          </p>
          {lots.map((lot) => (
            <div key={lot} className="card" style={{ marginBottom: '1rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.7rem 1rem', fontWeight: 600 }}>{lot}</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Article</th><th style={{ width: 80 }}>Qté</th><th style={{ width: 80 }}>Unité</th><th>Fournisseur</th><th style={{ width: 120, textAlign: 'right' }}>Budget HT</th><th style={{ width: 130 }}>Statut</th><th>Note</th><th /></tr></thead>
                  <tbody>
                    {internal.filter((i) => i.lot === lot).map((i) => (
                      <tr key={i.id}>
                        <td><input className="input" value={i.label} onChange={(e) => upInternal(i.id, { label: e.target.value })} aria-label="Article" /></td>
                        <td><input className="input" inputMode="decimal" value={String(i.qty)} onChange={(e) => upInternal(i.id, { qty: Number(e.target.value.replace(',', '.')) || 0 })} aria-label="Quantité" /></td>
                        <td><input className="input" value={i.unit} onChange={(e) => upInternal(i.id, { unit: e.target.value })} aria-label="Unité" /></td>
                        <td><input className="input" value={i.supplier} placeholder="Fournisseur" onChange={(e) => upInternal(i.id, { supplier: e.target.value })} aria-label="Fournisseur" /></td>
                        <td><input className="input" style={{ textAlign: 'right' }} inputMode="decimal" value={String(i.estCostHt)} onChange={(e) => upInternal(i.id, { estCostHt: Number(e.target.value.replace(',', '.')) || 0 })} aria-label="Budget HT" /></td>
                        <td>
                          <select className="select" value={i.status} onChange={(e) => upInternal(i.id, { status: e.target.value as InternalItem['status'] })} aria-label="Statut">
                            {(Object.keys(STATUS) as InternalItem['status'][]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
                          </select>
                        </td>
                        <td><input className="input" value={i.note} onChange={(e) => upInternal(i.id, { note: e.target.value })} aria-label="Note" /></td>
                        <td><button className="btn ghost" title="Retirer" onClick={() => { setInternal((l) => l.filter((x) => x.id !== i.id)); setDirty(true); }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '0.5rem 1rem' }}>
                <button className="btn ghost" style={{ fontSize: '0.8rem' }} onClick={() => { setInternal((l) => [...l, { id: uid(), lot, label: '', qty: 1, unit: '', estCostHt: 0, supplier: '', status: 'todo', note: '' }]); setDirty(true); }}>+ Article</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'client' && (
        <>
          <div className="card card-pad" style={{ marginBottom: '1rem' }}>
            <strong>Lien à envoyer au client</strong>
            <p className="muted" style={{ margin: '0.3rem 0 0.6rem', fontSize: '0.85rem' }}>
              Le client voit seulement les produits que tu as renseignés (nom, détail, prix TTC, lien). Il valide chaque produit ou dit ce qu’il préfère ; ses réponses apparaissent ici. Aucun prix de revient ni fournisseur n’est visible.
            </p>
            {shareToken ? (
              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <input className="input" readOnly value={url} style={{ flex: 1, minWidth: 240 }} onFocus={(e) => e.currentTarget.select()} aria-label="Lien public" />
                <button className="btn" onClick={() => navigator.clipboard?.writeText(url).then(() => setMsg({ ok: true, text: 'Lien copié.' }))}>Copier</button>
                <a className="btn" href={`/liste/${shareToken}`} target="_blank" rel="noreferrer">Voir comme le client</a>
                <button className="btn ghost" onClick={unshare}>Désactiver le lien</button>
              </div>
            ) : <button className="btn primary" onClick={share}>Créer le lien public</button>}
          </div>

          {clientLots.length === 0 && <p className="muted">Aucun produit à proposer pour l’instant. Ajoute-en avec « + Produit ».</p>}
          {clientLots.map((lot) => (
            <div key={lot} className="card" style={{ marginBottom: '1rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.7rem 1rem', fontWeight: 600 }}>{lot}</div>
              {client.filter((c) => c.lot === lot).map((c) => (
                <div key={c.id} style={{ padding: '0.7rem 1rem', borderTop: '1px solid var(--line)', display: 'grid', gap: '0.5rem' }}>
                  <div className="wiz-grid">
                    <div className="field"><label>Poste</label><input className="input" value={c.label} onChange={(e) => upClient(c.id, { label: e.target.value })} /></div>
                    <div className="field"><label>Produit proposé (marque, modèle, teinte)</label><input className="input" value={c.proposal} onChange={(e) => upClient(c.id, { proposal: e.target.value })} placeholder="À proposer au client" /></div>
                    <div className="field"><label>Prix TTC (facultatif)</label><input className="input" inputMode="decimal" value={c.priceTtc ?? ''} onChange={(e) => upClient(c.id, { priceTtc: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0 })} /></div>
                    <div className="field"><label>Lien du produit (facultatif)</label><input className="input" value={c.url} onChange={(e) => upClient(c.id, { url: e.target.value })} placeholder="https://…" /></div>
                  </div>
                  <div className="field full"><label>Ce que le client doit savoir / choisir</label><textarea className="input" rows={2} value={c.detail} onChange={(e) => upClient(c.id, { detail: e.target.value })} /></div>
                  <div className="row" style={{ justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span>
                      {c.clientChoice === 'ok' && <span className="badge ok">Validé par le client</span>}
                      {c.clientChoice === 'other' && <span className="badge warn">Autre souhait : « {c.clientComment} »</span>}
                      {!c.clientChoice && <span className="muted" style={{ fontSize: '0.82rem' }}>Pas encore de réponse</span>}
                    </span>
                    <button className="btn ghost" style={{ fontSize: '0.8rem' }} onClick={() => { setClient((l) => l.filter((x) => x.id !== c.id)); setDirty(true); }}>Retirer</button>
                  </div>
                </div>
              ))}
              <div style={{ padding: '0.5rem 1rem' }}>
                <button className="btn ghost" style={{ fontSize: '0.8rem' }} onClick={() => { setClient((l) => [...l, { id: uid(), lot, label: '', proposal: '', detail: '', priceTtc: null, url: '', clientChoice: null, clientComment: '', answeredAt: null }]); setDirty(true); }}>+ Produit</button>
              </div>
            </div>
          ))}
        </>
      )}

      <p style={{ marginTop: '1.5rem' }}><button className="btn ghost" onClick={remove}>Supprimer cette liste</button></p>
    </>
  );
}
