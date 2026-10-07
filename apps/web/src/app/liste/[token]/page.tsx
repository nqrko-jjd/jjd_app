'use client';
import { use, useEffect, useState } from 'react';

interface Item { id: string; lot: string; label: string; proposal: string; detail: string; priceTtc: number | null; url: string; clientChoice: 'ok' | 'other' | null; clientComment: string }
interface Data { title: string; worksite: { title: string; city: string | null } | null; company: { name: string; email: string; phone: string }; items: Item[] }
const BASE = '/jjd-api/api/public/purchase-list';
const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });

/** Page publique (sans compte) : le client voit les produits proposés par JJD Consult, les valide ou dit ce qu'il préfère. */
export default function PublicListPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState<Record<string, string>>({});
  const [openOther, setOpenOther] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`${BASE}/${token}`);
      if (!r.ok) throw new Error(r.status === 404 ? 'Ce lien n’est plus valable. Demandez-en un nouveau à JJD Consult.' : 'Chargement impossible, réessayez dans un instant.');
      setData(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- une seule fois au montage (le jeton ne change pas)

  async function answer(itemId: string, choice: 'ok' | 'other' | null, comment?: string) {
    setBusy(itemId); setFlash(null);
    try {
      const r = await fetch(`${BASE}/${token}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId, choice, comment }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Envoi impossible.');
      setOpenOther(null); setFlash('Merci, votre réponse est enregistrée.');
      await load();
    } catch (e) { setFlash(e instanceof Error ? e.message : 'Envoi impossible.'); }
    finally { setBusy(null); }
  }

  if (error) return <main style={wrap}><p style={{ color: '#9b2c2c' }}>{error}</p></main>;
  if (!data) return <main style={wrap}><p>Chargement…</p></main>;
  const lots = [...new Set(data.items.map((i) => i.lot))];
  const done = data.items.filter((i) => i.clientChoice).length;

  return (
    <main style={wrap}>
      <header style={{ marginBottom: '1.4rem' }}>
        <div style={{ color: '#173f34', fontWeight: 700, letterSpacing: '.04em', fontSize: '0.85rem' }}>{data.company.name.toUpperCase()}</div>
        <h1 style={{ margin: '0.3rem 0', fontSize: '1.6rem', color: '#173f34' }}>Produits proposés pour votre chantier</h1>
        <p style={{ margin: 0, color: '#4a5a54' }}>{data.worksite?.title}{data.worksite?.city ? ` · ${data.worksite.city}` : ''}</p>
        <p style={{ margin: '0.8rem 0 0' }}>Merci de valider chaque produit ou de nous dire ce que vous préférez : nous commandons seulement une fois votre choix confirmé.</p>
        <p style={{ margin: '0.4rem 0 0', color: '#4a5a54', fontSize: '0.9rem' }}>{done}/{data.items.length} produit{data.items.length > 1 ? 's' : ''} traité{done > 1 ? 's' : ''}</p>
      </header>
      {flash && <p role="status" style={{ background: '#eef6ef', border: '1px solid #b8d8bd', padding: '0.6rem 0.8rem', borderRadius: 8 }}>{flash}</p>}
      {data.items.length === 0 && <p>Aucun produit à valider pour le moment.</p>}
      {lots.map((lot) => (
        <section key={lot} style={{ marginBottom: '1.4rem' }}>
          <h2 style={{ fontSize: '1.05rem', color: '#173f34', borderBottom: '2px solid #c9a24b', paddingBottom: 4 }}>{lot}</h2>
          {data.items.filter((i) => i.lot === lot).map((i) => (
            <article key={i.id} className="card card-pad" style={{ marginBottom: '0.7rem' }}>
              <div style={{ fontWeight: 600 }}>{i.label}</div>
              <div style={{ marginTop: 4 }}>{i.proposal || <em>Proposition à venir</em>}{i.priceTtc != null && <strong style={{ marginLeft: 8 }}>{eur(i.priceTtc)} TTC</strong>}</div>
              {i.detail && <p style={{ color: '#4a5a54', margin: '0.4rem 0', fontSize: '0.9rem' }}>{i.detail}</p>}
              {i.url && /^https?:\/\//i.test(i.url) && <p style={{ margin: '0.2rem 0' }}><a href={i.url} target="_blank" rel="noreferrer noopener">Voir le produit</a></p>}
              {i.clientChoice === 'ok' && <p style={{ color: '#2f6b3b', fontWeight: 600, margin: '0.5rem 0 0' }}>✓ Vous avez validé ce produit.</p>}
              {i.clientChoice === 'other' && <p style={{ color: '#8a6a12', margin: '0.5rem 0 0' }}>Votre souhait : « {i.clientComment} »</p>}
              {i.proposal && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                  <button className="btn primary" disabled={busy === i.id} onClick={() => answer(i.id, 'ok')}>{i.clientChoice === 'ok' ? 'Validé ✓' : 'Je valide'}</button>
                  <button className="btn" disabled={busy === i.id} onClick={() => setOpenOther(openOther === i.id ? null : i.id)}>Je préfère autre chose</button>
                </div>
              )}
              {openOther === i.id && (
                <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.4rem' }}>
                  <textarea className="input" rows={3} placeholder="Dites-nous ce que vous préférez (teinte, modèle, budget…)" value={other[i.id] ?? ''} onChange={(e) => setOther((o) => ({ ...o, [i.id]: e.target.value }))} />
                  <div><button className="btn primary" disabled={busy === i.id || !(other[i.id] ?? '').trim()} onClick={() => answer(i.id, 'other', other[i.id])}>Envoyer</button></div>
                </div>
              )}
            </article>
          ))}
        </section>
      ))}
      <footer style={{ color: '#4a5a54', fontSize: '0.85rem', marginTop: '2rem' }}>Une question ? {data.company.email}{data.company.phone ? ` · ${data.company.phone}` : ''}</footer>
    </main>
  );
}
const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem 3rem', background: '#fff', minHeight: '100vh' };
