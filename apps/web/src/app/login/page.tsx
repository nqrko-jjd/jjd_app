'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch {
      setErr('E-mail ou mot de passe incorrect.');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap login-experience">
      <aside className="login-story"><span className="eyebrow">JJD Consult · Votre espace de travail</span><h2>Une équipe.<br/>Tous vos projets.</h2><p>Les chantiers, le planning et les échanges de votre équipe, au même endroit.</p><div className="login-story-footer">Administration · Bureau · Terrain · Dépôt</div></aside>
      <form className="card card-pad login-card grid" onSubmit={submit} style={{ gap: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontWeight: 800, fontSize: '1.1rem' }}>
          <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center' }}>
            <img src="/brand/icon-mono.png" alt="" style={{ width: '90%', height: '90%', objectFit: 'contain' }} />
          </span>
          JJD Consult
        </div>
        <div className="login-heading"><span className="eyebrow">Bon retour</span><h1>Connexion</h1><p className="muted">Retrouvez votre espace JJD.</p></div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="votre@email.be" />
        </div>
        <div className="field">
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {err && <div className="badge crit" style={{ padding: '0.4rem 0.6rem' }}>{err}</div>}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <a className="login-client-link" href="/portail">Vous êtes client ? Ouvrir le portail →</a>
      </form>
    </div>
  );
}
