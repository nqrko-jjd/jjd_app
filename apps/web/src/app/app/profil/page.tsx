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
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p role="status">{tr('Informations enregistrées.')}</p>}
    </div>
  </>;
}
