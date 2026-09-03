'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { portalApi } from '@/lib/portal';

export default function PortalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await portalApi<{ ok: boolean; devToken?: string }>('/request-link', {
      method: 'POST',
      body: { email: email.trim().toLowerCase() },
    });
    setSent(true);
    setDevToken(r.devToken ?? null);
    setBusy(false);
  }

  return (
    <div className="p-login-wrap">
      <div className="p-card p-card-pad p-login">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1.1rem' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--p-primary)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '0.85rem' }}>J</span>
          JJD Consult
        </div>
        <h1 style={{ fontSize: '1.35rem', marginTop: '1rem' }}>Espace client</h1>
        <p className="p-note" style={{ marginTop: '0.3rem' }}>
          Suivez vos chantiers, devis, factures et photos.
        </p>

        {sent ? (
          <div style={{ marginTop: '1.2rem' }}>
            <p>Si un compte existe pour <strong>{email}</strong>, un lien de connexion vient d’être envoyé par e-mail (valable 30 minutes).</p>
            {devToken && (
              <button className="p-btn primary" style={{ marginTop: '1rem' }} onClick={() => router.push(`/portail/connexion?token=${devToken}`)}>
                (démo) Se connecter directement
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="p-field">
              <label htmlFor="email">Votre e-mail</label>
              <input id="email" className="p-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.be" />
            </div>
            <button className="p-btn primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Envoi…' : 'Recevoir mon lien de connexion'}
            </button>
            <p className="p-note" style={{ marginTop: '0.8rem' }}>
              Pas de mot de passe : on vous envoie un lien à usage unique.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
