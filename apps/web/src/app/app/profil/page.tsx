'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';
import { tr, UI_LANGUAGES, isUiLocale } from '@/lib/ui-language';
import { loginLabel } from '@jjd/shared';

export default function ProfilePage() {
  const { user, person, refresh, changeLocale } = useAuth();
  const [firstName, setFirstName] = useState(person?.firstName ?? '');
  const [lastName, setLastName] = useState(person?.lastName ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = !!person && (firstName !== person.firstName || lastName !== (person.lastName ?? '') || phone !== (person.phone ?? '') || email !== (person.email ?? ''));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      await api('/api/auth/profile', { method: 'PATCH', body: { firstName, lastName, phone, email } });
      await refresh(); setSaved(true);
    } catch { setError(tr('Impossible d’enregistrer les modifications. Réessayez.')); }
    finally { setBusy(false); }
  }
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setPwMsg(null);
    if (pw.next.length < 6) return setPwMsg({ ok: false, text: tr('Le nouveau mot de passe doit faire au moins 6 caractères.') });
    if (pw.next !== pw.again) return setPwMsg({ ok: false, text: tr('Les deux nouveaux mots de passe sont différents.') });
    setBusy(true);
    try {
      await api('/api/auth/password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: '', next: '', again: '' });
      setPwMsg({ ok: true, text: tr('Mot de passe modifié.') });
    } catch (e) { setPwMsg({ ok: false, text: (e as Error).message || tr('Impossible de modifier le mot de passe.') }); }
    finally { setBusy(false); }
  }
  async function language(locale: string) {
    if (!isUiLocale(locale)) return;
    setBusy(true); setError('');
    try { await changeLocale(locale); }
    catch { setError(tr('Impossible d’enregistrer les modifications. Réessayez.')); }
    finally { setBusy(false); }
  }
  return <>
    <PageHead title={tr('Mon profil')} sub={person?.displayName || person?.firstName || loginLabel(user?.email)} />
    <div style={{ maxWidth: 720, display: 'grid', gap: '1rem' }}>
      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>{tr('Langue de l’application')}</h2>
        <label className="field" htmlFor="profile-language">{tr('Langue')}
          <select id="profile-language" className="input" value={user?.locale ?? 'fr'} disabled={busy || dirty} onChange={e => void language(e.target.value)}>
            {UI_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <p className="muted">{tr('Cette langue est enregistrée dans votre compte et utilisée sur le site et dans l’application mobile.')}</p>
        {dirty && <p role="status">{tr('Enregistrez vos informations avant de changer de langue.')}</p>}
      </section>
      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>{tr('Mes informations')}</h2>
        <p className="muted">{tr('Identifiant de connexion')} : {loginLabel(user?.email)}</p>
        {person && <form onSubmit={save} style={{ display: 'grid', gap: '1rem' }}>
          <label className="field" htmlFor="profile-first-name">{tr('Prénom')}<input id="profile-first-name" className="input" autoComplete="given-name" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} disabled={busy} /></label>
          <label className="field" htmlFor="profile-last-name">{tr('Nom')}<input id="profile-last-name" className="input" autoComplete="family-name" maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} disabled={busy} /></label>
          <label className="field" htmlFor="profile-phone">{tr('Téléphone')}<input id="profile-phone" className="input" type="tel" autoComplete="tel" maxLength={50} value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} /></label>
          <label className="field" htmlFor="profile-email">{tr('E-mail de contact')}<input id="profile-email" className="input" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
          <div><button className="btn primary" type="submit" disabled={busy}>{tr(busy ? 'Enregistrement…' : 'Enregistrer')}</button></div>
        </form>}
      </section>
      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>{tr('Mot de passe')}</h2>
        <form onSubmit={changePassword} style={{ display: 'grid', gap: '1rem' }}>
          <label className="field" htmlFor="pw-current">{tr('Mot de passe actuel')}<input id="pw-current" className="input" type="password" autoComplete="current-password" required value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} disabled={busy} /></label>
          <label className="field" htmlFor="pw-new">{tr('Nouveau mot de passe')}<input id="pw-new" className="input" type="password" autoComplete="new-password" required minLength={6} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} disabled={busy} /></label>
          <label className="field" htmlFor="pw-again">{tr('Répéter le nouveau mot de passe')}<input id="pw-again" className="input" type="password" autoComplete="new-password" required minLength={6} value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} disabled={busy} /></label>
          <div><button className="btn primary" type="submit" disabled={busy}>{tr('Changer mon mot de passe')}</button></div>
          {pwMsg && <p className={pwMsg.ok ? undefined : 'error'} role={pwMsg.ok ? 'status' : 'alert'}>{pwMsg.text}</p>}
        </form>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p role="status">{tr('Informations enregistrées.')}</p>}
    </div>
  </>;
}
