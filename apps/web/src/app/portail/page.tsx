'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { portalApi, setPortalToken } from '@/lib/portal';

const linkBtn = { background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--p-green-600)', textDecoration: 'underline', font: 'inherit', fontWeight: 700 } as const;

export default function PortalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    setLoginBusy(true);
    try {
      const r = await portalApi<{ token: string }>('/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      });
      setPortalToken(r.token);
      // rechargement complet pour que le PortalProvider relise /me avec le token
      window.location.href = '/portail/accueil';
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : 'Connexion impossible. Réessayez.');
      setLoginBusy(false);
    }
  }

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
      <div className="p-login">
        <div className="brand"><span className="mk"><img src="/brand/icon-mono.png" alt="" /></span> JJD Consult</div>
        <div className="portal-login-heading"><span className="eyebrow">Votre suivi JJD</span><h1>Espace client</h1></div>
        <p className="p-note" style={{ marginTop: '0.3rem' }}>
          Suivez vos chantiers, devis, factures et photos.
        </p>

        {mode === 'password' ? (
          <form onSubmit={login}>
            <div className="p-field">
              <label htmlFor="login-email">Votre e-mail</label>
              <input id="login-email" className="p-input" type="email" name="username" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.be" />
            </div>
            <div className="p-field">
              <label htmlFor="login-password">Mot de passe</label>
              <div style={{ position: 'relative' }}>
                <input id="login-password" className={`p-input${loginErr ? ' error' : ''}`} style={{ width: '100%', paddingRight: '3rem' }} type={show ? 'text' : 'password'} name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={loginErr ? true : undefined} aria-describedby="login-error" />
                <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, display: 'grid', placeItems: 'center', background: 'none', border: 0, cursor: 'pointer', color: 'var(--p-ink-2)' }}>
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div id="login-error" role="alert" aria-live="polite">
              {loginErr && <p className="p-field-error" style={{ marginBottom: '0.7rem' }}>{loginErr}</p>}
            </div>
            <button className="p-btn-primary" style={{ width: '100%' }} disabled={loginBusy}>
              {loginBusy ? 'Connexion…' : 'Se connecter'}
            </button>
            <p className="p-note" style={{ marginTop: '0.9rem', textAlign: 'center' }}>
              <button type="button" onClick={() => setMode('link')} style={linkBtn}>
                Première connexion ou mot de passe oublié ?
              </button>
            </p>
          </form>
        ) : sent ? (
          <div style={{ marginTop: '1.2rem' }}>
            <p>Si un compte existe pour <strong>{email}</strong>, un lien de connexion vient d’être envoyé par e-mail (valable 30 minutes).</p>
            {devToken && (
              <button className="p-btn-primary" style={{ marginTop: '1rem' }} onClick={() => router.push(`/portail/connexion?token=${devToken}`)}>
                (démo) Se connecter directement
              </button>
            )}
            <p className="p-note" style={{ marginTop: '0.9rem' }}>
              <button type="button" onClick={() => { setSent(false); setMode('password'); }} style={linkBtn}>Retour à la connexion</button>
            </p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="p-field">
              <label htmlFor="email">Votre e-mail</label>
              <input id="email" className="p-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.be" />
            </div>
            <button className="p-btn-primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Envoi…' : 'Recevoir mon lien de connexion'}
            </button>
            <p className="p-note" style={{ marginTop: '0.8rem' }}>
              On vous envoie un lien à usage unique. Une fois connecté, vous pourrez choisir un mot de passe.
            </p>
            <p className="p-note" style={{ marginTop: '0.6rem', textAlign: 'center' }}>
              <button type="button" onClick={() => setMode('password')} style={linkBtn}>Se connecter avec un mot de passe</button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
