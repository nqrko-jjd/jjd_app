'use client';
import { useState } from 'react';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

export default function PasswordPage() {
  const { me, loading } = usePortalGuard();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOk(false);
    if (next.length < 10) return setErr('Le nouveau mot de passe doit contenir au moins 10 caractères.');
    if (next.length > 200) return setErr('Le mot de passe est trop long (200 caractères maximum).');
    if (next !== confirm) return setErr('La confirmation ne correspond pas au nouveau mot de passe.');
    setErr(null);
    setBusy(true);
    try {
      await portalApi('/password', { method: 'POST', body: { password: next, ...(current ? { currentPassword: current } : {}) } });
      setOk(true);
      setCurrent(''); setNext(''); setConfirm('');
      try { localStorage.setItem('jjd_portal_pw_banner', 'done'); } catch { /* */ }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Une erreur est survenue. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !me) return null;
  const type = show ? 'text' : 'password';
  return (
    <PortalShell title="Mon mot de passe" subtitle="Connectez-vous plus vite, sans attendre un lien par e-mail.">
      <div className="p-card p-card-pad" style={{ maxWidth: 520 }}>
        <form onSubmit={submit}>
          <input type="email" name="username" autoComplete="username" value={me.email} readOnly hidden />
          <div className="p-field">
            <label htmlFor="pw-current">Mot de passe actuel (facultatif)</label>
            <input id="pw-current" className="p-input" type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <span className="p-note">À remplir seulement si vous en avez déjà un.</span>
          </div>
          <div className="p-field">
            <label htmlFor="pw-new">Nouveau mot de passe</label>
            <input id="pw-new" className={`p-input${err && next.length < 10 ? ' error' : ''}`} type={type} autoComplete="new-password" minLength={10} maxLength={200} required value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="pw-hint" />
            <span id="pw-hint" className="p-note">10 caractères minimum.</span>
          </div>
          <div className="p-field">
            <label htmlFor="pw-confirm">Confirmer le nouveau mot de passe</label>
            <input id="pw-confirm" className="p-input" type={type} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', margin: '0.4rem 0 1rem' }}>
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Afficher les mots de passe
          </label>
          <div role="alert" aria-live="polite">
            {err && <p className="p-field-error" style={{ marginBottom: '0.7rem' }}>{err}</p>}
          </div>
          <div role="status" aria-live="polite">
            {ok && <p className="p-notice" style={{ marginBottom: '0.8rem' }}>Votre mot de passe a bien été enregistré. Vous pouvez l’utiliser dès la prochaine connexion.</p>}
          </div>
          <button className="p-btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
        </form>
      </div>
    </PortalShell>
  );
}
