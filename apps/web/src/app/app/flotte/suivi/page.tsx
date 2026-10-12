'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { MapPin } from 'lucide-react';

interface Vehicle { id: string; code: string | null; name: string | null; plate: string | null; brand: string | null; model: string | null; pajDeviceId: string | null; lastLat: number | null; lastLng: number | null; lastSeenAt: string | null; lastSpeed: number | null; lastBattery: number | null }
interface Settings { enabled: boolean; radiusKm: number; maxPositionAgeMin: number; copyToSelf: boolean; testTo: string; subject: string; body: string }
interface Arrival { eventId: string; worksiteRef: string; client: string; to: string | null; startAt: string; vehicle: string; km: number; minutes: number; blocked: string | null }
interface Hist { id: string; status: string; toEmail: string | null; etaMinutes: number | null; sentAt: string | null; error: string | null; createdAt: string; event: { startAt: string; worksite: { ref: string; client: { name: string } | null } } | null }
interface Data { pajConfigured: boolean; emailConfigured: boolean; vehicles: Vehicle[]; settings: Settings; arrivals: Arrival[]; history: Hist[] }
interface Device { id: string; name: string }
const PLACEHOLDERS = '{client} {minutes} {chantier} {heure} {societe} {telephone}';
const label = (v: Vehicle) => [v.code, v.name ?? [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || 'Véhicule';
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : formatDateBE(iso); };

/** Suivi GPS (traceurs PAJ) : relier les traceurs aux véhicules, voir les dernières positions, régler les avis d'arrivée aux clients. */
export default function SuiviGps() {
  const { data, error, loading, reload } = useApi<Data>('/api/gps');
  const [tab, setTab] = useState<'vehicles' | 'arrivals' | 'settings'>('vehicles');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <SkeletonRows />;
  if (error || !data) return <ErrorState message={error ?? 'Erreur'} onRetry={reload} />;
  async function run(fn: () => Promise<string | void>) {
    setBusy(true); setMsg(null);
    try { const t = await fn(); setMsg({ ok: true, text: t || 'Fait.' }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const loadDevices = () => run(async () => { const r = await api<{ devices: Device[] }>('/api/gps/devices'); setDevices(r.devices); return `Connexion PAJ réussie : ${r.devices.length} traceur(s) trouvé(s).`; });
  const link = (v: Vehicle, pajDeviceId: string | null) => run(async () => { await api(`/api/gps/vehicles/${v.id}`, { method: 'PATCH', body: { pajDeviceId } }); return pajDeviceId ? 'Traceur relié.' : 'Traceur retiré.'; });

  return (
    <>
      <PageHead
        eyebrow="Flotte"
        title="Suivi GPS"
        sub={`${data.vehicles.filter((v) => v.pajDeviceId).length} véhicule(s) relié(s) à un traceur · avis d’arrivée ${data.settings.enabled ? 'activés' : 'désactivés'}`}
        action={<div className="row"><Link className="btn" href="/app/flotte">← Flotte</Link>{data.pajConfigured && <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api<{ updated: number }>('/api/gps/refresh', { method: 'POST', body: {} }); return `${r.updated} position(s) mise(s) à jour.`; })}>Actualiser les positions</button>}</div>}
      />
      {!data.pajConfigured && <div className="badge warn" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>Le compte PAJ GPS n’est pas encore configuré sur le serveur (PAJ_EMAIL et PAJ_PASSWORD) : aucune position ne peut être lue.</div>}
      {msg && <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg.text}</div>}
      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'vehicles' ? 'on' : ''} onClick={() => setTab('vehicles')}>Véhicules</button>
        <button className={tab === 'arrivals' ? 'on' : ''} onClick={() => setTab('arrivals')}>Avis d’arrivée · {data.arrivals.length}</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Réglages</button>
      </div>

      {tab === 'vehicles' && (
        <div className="panel" style={{ padding: '1rem', display: 'grid', gap: '0.8rem' }}>
          <div className="row" style={{ gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy || !data.pajConfigured} onClick={loadDevices}>Tester la connexion et lister les traceurs</button>
            <span className="muted" style={{ fontSize: '0.84rem' }}>Reliez chaque véhicule à son traceur PAJ ; la position est lue toutes les 2 minutes.</span>
          </div>
          {data.vehicles.map((v) => (
            <div key={v.id} className="row" style={{ gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: '0.7rem' }}>
              <strong style={{ minWidth: 200 }}>{label(v)}</strong>
              <select className="select" style={{ width: 'auto', minWidth: 190 }} value={v.pajDeviceId ?? ''} disabled={busy || (!devices && !v.pajDeviceId)} onChange={(e) => link(v, e.target.value || null)} aria-label={`Traceur de ${label(v)}`}>
                <option value="">{devices || v.pajDeviceId ? '— aucun traceur —' : 'Listez d’abord les traceurs'}</option>
                {(devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
                {v.pajDeviceId && !(devices ?? []).some((d) => d.id === v.pajDeviceId) && <option value={v.pajDeviceId}>Traceur {v.pajDeviceId}</option>}
              </select>
              {v.pajDeviceId && (v.lastSeenAt && v.lastLat != null && v.lastLng != null
                ? <span style={{ fontSize: '0.86rem' }}><MapPin size={14} style={{ verticalAlign: '-2px' }} /> <a href={`https://www.openstreetmap.org/?mlat=${v.lastLat}&mlon=${v.lastLng}#map=16/${v.lastLat}/${v.lastLng}`} target="_blank" rel="noreferrer">Voir sur la carte</a> · {ago(v.lastSeenAt)}{v.lastSpeed != null ? ` · ${Math.round(v.lastSpeed)} km/h` : ''}{v.lastBattery != null ? ` · batterie ${Math.round(v.lastBattery)} %` : ''}</span>
                : <span className="muted" style={{ fontSize: '0.86rem' }}>Pas encore de position</span>)}
            </div>
          ))}
          {data.vehicles.length === 0 && <EmptyState icon={MapPin} title="Aucun véhicule" text="Ajoutez d’abord vos véhicules dans la flotte." />}
        </div>
      )}

      {tab === 'arrivals' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="panel" style={{ padding: '1rem' }}>
            <strong>À envoyer maintenant</strong>
            {data.arrivals.length === 0 ? <p className="muted" style={{ margin: '0.4rem 0 0' }}>Aucun véhicule d’intervention n’est actuellement à moins de {data.settings.radiusKm} km de son chantier.</p> : data.arrivals.map((a) => (
              <div key={a.eventId} style={{ borderTop: '1px solid var(--line)', marginTop: '0.6rem', paddingTop: '0.6rem' }}>
                <strong>{a.worksiteRef}</strong> · {a.client} · {a.vehicle} à {a.km} km (~{a.minutes} min) → {a.to ?? '—'} {a.blocked && <span className="badge plain">{a.blocked}</span>} {!data.settings.enabled && <span className="badge plain">avis désactivés : rien ne part</span>}
              </div>
            ))}
          </div>
          <div className="panel" style={{ padding: '1rem' }}>
            <strong>Historique</strong>
            {data.history.length === 0 ? <p className="muted" style={{ margin: '0.4rem 0 0' }}>Aucun avis d’arrivée envoyé.</p> : data.history.map((h) => (
              <div key={h.id} style={{ borderTop: '1px solid var(--line)', marginTop: '0.6rem', paddingTop: '0.6rem' }}>
                <span className={`badge ${h.status === 'sent' ? 'ok' : 'crit'}`}>{h.status === 'sent' ? 'Envoyé' : 'Échec'}</span> {h.event?.worksite.ref} · {h.event?.worksite.client?.name ?? '—'} → {h.toEmail ?? '—'} · ~{h.etaMinutes} min · {formatDateBE(h.sentAt ?? h.createdAt)}
                {h.error && <div style={{ color: 'var(--crit)', fontSize: '0.82rem' }}>{h.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'settings' && <SettingsForm initial={data.settings} emailConfigured={data.emailConfigured} onSaved={() => { setMsg({ ok: true, text: 'Réglages enregistrés.' }); reload(); }} onError={(t) => setMsg({ ok: false, text: t })} />}
    </>
  );
}

function SettingsForm({ initial, emailConfigured, onSaved, onError }: { initial: Settings; emailConfigured: boolean; onSaved: () => void; onError: (t: string) => void }) {
  const [s, setS] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/api/gps/settings', { method: 'PUT', body: s }); onSaved(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
      {!emailConfigured && <div className="badge warn" style={{ padding: '0.5rem 0.8rem' }}>L’envoi par e-mail n’est pas configuré sur ce serveur.</div>}
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} style={{ marginTop: 4 }} />
        <span><strong>Prévenir le client à l’approche de l’équipe</strong><br /><span className="muted" style={{ fontSize: '0.86rem' }}>Quand le véhicule affecté à une intervention du jour passe sous le seuil ci-dessous, le client du chantier reçoit un e-mail, une seule fois par intervention. Il ne reçoit jamais la position ni le trajet.</span></span>
      </label>
      <div className="field"><label>Adresse de test (facultatif)</label><input className="input" type="email" value={s.testTo} onChange={(e) => setS({ ...s, testTo: e.target.value })} placeholder="vous@jjd-consult.be" /><span className="muted" style={{ fontSize: '0.8rem' }}>Si renseignée, tous les avis partent à cette adresse au lieu du client : pratique pour essayer sans prévenir personne. Videz-la pour passer en réel.</span></div>
      <div className="row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div className="field"><label>Distance de déclenchement (km)</label><input className="input" inputMode="decimal" style={{ width: 120 }} value={s.radiusKm} onChange={(e) => setS({ ...s, radiusKm: Number(e.target.value.replace(',', '.')) || 1 })} /></div>
        <div className="field"><label>Position récente de moins de (min)</label><input className="input" inputMode="numeric" style={{ width: 120 }} value={s.maxPositionAgeMin} onChange={(e) => setS({ ...s, maxPositionAgeMin: Number(e.target.value) || 2 })} /></div>
      </div>
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}><input type="checkbox" checked={s.copyToSelf} onChange={(e) => setS({ ...s, copyToSelf: e.target.checked })} /> Recevoir une copie de chaque avis (Cci)</label>
      <div className="field"><label>Objet</label><input className="input" value={s.subject} onChange={(e) => setS({ ...s, subject: e.target.value })} /></div>
      <div className="field"><label>Message</label><textarea className="input" rows={9} value={s.body} onChange={(e) => setS({ ...s, body: e.target.value })} /></div>
      <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>Variables utilisables : <span className="mono">{PLACEHOLDERS}</span>. Le délai annoncé est une estimation (≈ 27 km/h de moyenne, arrondie à 5 minutes).</p>
      <div><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer les réglages'}</button></div>
    </div>
  );
}
