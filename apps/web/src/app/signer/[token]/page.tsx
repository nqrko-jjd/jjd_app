'use client';
import { use, useEffect, useState } from 'react';

interface View {
  status: 'pending' | 'signed' | 'declined' | 'expired';
  expiresAt: string; signedAt: string | null; signerName: string | null; declinedComment: string | null;
  document: { number: string | null; title: string | null; issuedOn: string | null; validUntil: string | null; totalHt: number; totalTtc: number; clientName: string | null; worksite: { title: string; city: string | null } | null };
  company: { name: string; email: string; phone: string };
}
const BASE = '/jjd-api/api/public/sign';
const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const dateTime = (s: string | null) => (s ? `${date(s)} à ${new Date(s).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}` : '');

/** Page publique (sans compte) : le client lit son devis, l'accepte et le signe en ligne, ou le refuse. */
export default function SignQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [ok, setOk] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`${BASE}/${token}`);
      if (!r.ok) throw new Error(r.status === 404 ? 'Ce lien n’est plus valable. Demandez-en un nouveau à JJD Consult.' : 'Chargement impossible, réessayez dans un instant.');
      setView(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  }
  useEffect(() => { load(); }); // eslint-disable-line react-hooks/exhaustive-deps -- une seule fois au montage (le jeton ne change pas)

  async function post(path: string, body: unknown) {
    setBusy(true); setFlash(null);
    try {
      const r = await fetch(`${BASE}/${token}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Envoi impossible, réessayez.');
      await load();
    } catch (e) { setFlash(e instanceof Error ? e.message : 'Envoi impossible.'); }
    finally { setBusy(false); }
  }

  if (error) return <main style={wrap}><p style={{ color: '#9b2c2c' }}>{error}</p></main>;
  if (!view) return <main style={wrap}><p>Chargement…</p></main>;
  const d = view.document;
  const pdfUrl = `${BASE}/${token}/pdf`;

  return (
    <main style={wrap}>
      <header style={{ marginBottom: '1.2rem' }}>
        <div style={{ color: '#173f34', fontWeight: 700, letterSpacing: '.04em', fontSize: '0.85rem' }}>{view.company.name.toUpperCase()}</div>
        <h1 style={{ margin: '0.3rem 0', fontSize: '1.6rem', color: '#173f34' }}>{view.status === 'signed' ? 'Devis signé' : 'Votre devis à signer'}</h1>
        <p style={{ margin: 0, color: '#4a5a54' }}>{d.number ? `Devis ${d.number}` : 'Devis'}{d.clientName ? ` · ${d.clientName}` : ''}</p>
      </header>

      <section style={card}>
        {d.title && <div style={{ fontWeight: 600, marginBottom: 6 }}>{d.title}</div>}
        {d.worksite && <div style={{ color: '#4a5a54', fontSize: '0.9rem' }}>Chantier : {d.worksite.title}{d.worksite.city ? ` · ${d.worksite.city}` : ''}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem', marginTop: 10 }}>
          <div><div style={lbl}>Montant HT</div><div style={{ fontSize: '1.1rem' }}>{eur(d.totalHt)}</div></div>
          <div><div style={lbl}>Montant TTC</div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#173f34' }}>{eur(d.totalTtc)}</div></div>
          {d.validUntil && <div><div style={lbl}>Valable jusqu’au</div><div style={{ fontSize: '1.1rem' }}>{date(d.validUntil)}</div></div>}
        </div>
      </section>

      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <iframe title="Devis" src={`${pdfUrl}#toolbar=0&navpanes=0`} style={{ width: '100%', height: '70vh', minHeight: 460, border: 0, display: 'block', background: '#f4f4f0' }} />
        <div style={{ padding: '0.6rem 1rem', fontSize: '0.88rem', borderTop: '1px solid #e5e7df' }}>
          Le PDF ne s’affiche pas bien ? <a href={pdfUrl} target="_blank" rel="noreferrer noopener">Ouvrez-le dans un nouvel onglet</a>. Les conditions générales sont jointes à la dernière page.
        </div>
      </section>

      {view.status === 'pending' && (
        <section style={{ ...card, borderColor: '#173f34' }}>
          <h2 style={{ margin: '0 0 0.6rem', fontSize: '1.1rem', color: '#173f34' }}>Accepter et signer</h2>
          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ marginTop: 4, width: 18, height: 18 }} />
            <span>J’ai lu le devis et les conditions générales jointes, et je les accepte.</span>
          </label>
          <label style={{ display: 'block', marginTop: '0.9rem' }}>
            <span style={lbl}>Votre nom et prénom (vaut signature)</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom Nom" autoComplete="name" style={{ width: '100%', marginTop: 4, fontSize: '1rem' }} />
          </label>
          {flash && <p role="alert" style={{ color: '#9b2c2c', margin: '0.7rem 0 0' }}>{flash}</p>}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            <button className="btn primary" disabled={busy || !ok || name.trim().length < 3} onClick={() => post('sign', { name, accepted: ok })} style={{ fontSize: '1rem', padding: '0.7rem 1.4rem' }}>
              {busy ? 'Enregistrement…' : 'Accepter et signer le devis'}
            </button>
            <button className="btn" disabled={busy} onClick={() => setRefusing((v) => !v)}>Je refuse ce devis</button>
          </div>
          {refusing && (
            <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.5rem' }}>
              <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Dites-nous pourquoi (facultatif) : prix, délai, modification souhaitée…" />
              <div><button className="btn" disabled={busy} onClick={() => post('decline', { comment })}>Confirmer le refus</button></div>
            </div>
          )}
          <p style={{ color: '#6b7a73', fontSize: '0.8rem', margin: '1rem 0 0' }}>
            En signant, vous acceptez ce devis. Votre nom, la date et l’heure, ainsi que votre adresse IP sont enregistrés comme preuve de votre accord. Ce lien est valable jusqu’au {date(view.expiresAt)}.
          </p>
        </section>
      )}

      {view.status === 'signed' && (
        <section style={{ ...card, background: '#eef6ef', borderColor: '#b8d8bd' }}>
          <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem', color: '#2f6b3b' }}>✓ Devis signé</h2>
          <p style={{ margin: 0 }}>Signé par <strong>{view.signerName}</strong> le {dateTime(view.signedAt)}. Merci pour votre confiance : nous revenons vers vous pour planifier les travaux. Une confirmation avec le devis signé vous est envoyée par e-mail.</p>
        </section>
      )}
      {view.status === 'declined' && (
        <section style={card}>
          <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem' }}>Devis refusé</h2>
          <p style={{ margin: 0 }}>Nous avons bien noté votre refus{view.declinedComment ? ` (« ${view.declinedComment} »)` : ''}. N’hésitez pas à nous contacter si vous souhaitez une autre proposition.</p>
        </section>
      )}
      {view.status === 'expired' && (
        <section style={{ ...card, background: '#fbf3e4', borderColor: '#e6cf9f' }}>
          <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem' }}>Ce lien a expiré</h2>
          <p style={{ margin: 0 }}>Contactez-nous pour recevoir un nouveau lien de signature.</p>
        </section>
      )}

      <footer style={{ color: '#4a5a54', fontSize: '0.85rem', marginTop: '2rem' }}>Une question ? {view.company.email}{view.company.phone ? ` · ${view.company.phone}` : ''}</footer>
    </main>
  );
}
const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '1.5rem 1rem 3rem', background: '#fff', minHeight: '100vh', color: '#26372f' };
const card: React.CSSProperties = { border: '1px solid #e5e7df', borderRadius: 12, padding: '1rem', marginBottom: '1rem', background: '#fff' };
const lbl: React.CSSProperties = { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#788078', fontWeight: 700 };
