'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalHeader } from '../PortalHeader';

export default function DemandePage() {
  const { me, loading } = usePortalGuard();
  const router = useRouter();
  const [buildings, setBuildings] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ title: '', buildingId: '', details: '', urgent: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (me?.isSyndic) portalApi<{ buildings: { id: string; name: string }[] }>('/buildings').then((r) => setBuildings(r.buildings)).catch(() => {});
  }, [me]);

  if (loading || !me) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.title.trim().length < 3) return;
    setBusy(true);
    await portalApi('/requests', {
      method: 'POST',
      body: { title: f.title.trim(), buildingId: f.buildingId || null, details: f.details || null, urgent: f.urgent },
    });
    setDone(true);
  }

  return (
    <>
      <PortalHeader />
      <main className="p-main">
        <Link href="/portail/accueil" className="p-back">← Retour</Link>
        <div className="p-hero"><h1>Nouvelle demande d’intervention</h1></div>

        {done ? (
          <div className="p-card p-card-pad">
            <p>Votre demande a bien été transmise à JJD Consult. Nous revenons vers vous rapidement.</p>
            <button className="p-btn primary" style={{ marginTop: '1rem' }} onClick={() => router.push('/portail/accueil')}>Retour à l’accueil</button>
          </div>
        ) : (
          <form className="p-card p-card-pad" onSubmit={submit}>
            <div className="p-field">
              <label>Objet de la demande *</label>
              <input className="p-input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Fuite dans le local technique, peinture couloir…" />
            </div>
            {me.isSyndic && buildings.length > 0 && (
              <div className="p-field">
                <label>Immeuble concerné</label>
                <select className="p-select" value={f.buildingId} onChange={(e) => setF({ ...f, buildingId: e.target.value })}>
                  <option value="">—</option>
                  {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="p-field">
              <label>Détails</label>
              <textarea className="p-textarea" rows={4} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Localisation, contexte, disponibilités…" />
            </div>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.4rem 0 1rem' }}>
              <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} />
              C’est urgent
            </label>
            <button className="p-btn primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button>
          </form>
        )}
      </main>
    </>
  );
}
