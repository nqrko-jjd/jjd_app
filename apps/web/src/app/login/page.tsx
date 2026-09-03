'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('david@jjd-consult.be');
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
    <div className="login-wrap">
      <form className="card card-pad login-card grid" onSubmit={submit}>
        <div className="mono" style={{ fontWeight: 600, letterSpacing: '0.04em' }}>
          JJD<b style={{ color: 'var(--accent)' }}>·</b>App
        </div>
        <h1>Connexion bureau</h1>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {err && <div className="badge crit" style={{ padding: '0.4rem 0.6rem' }}>{err}</div>}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>
          Comptes de démarrage : david@ / julien@ / melvina@ / chef@ / ouvrier@ · mot de passe <span className="mono">jjd</span>
        </p>
      </form>
    </div>
  );
}
