'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { portalApi, portalUpload, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';
import { INTERVENTION_PROBLEM_TYPES, INTERVENTION_PROBLEM_TYPE_LABEL, type InterventionProblemType } from '@jjd/shared';

const TYPE_ICON: Record<InterventionProblemType, string> = {
  fuite: '💧', electricite: '⚡', chauffage: '🔥', porte: '🚪', peinture: '🎨', toiture: '🏠', autre: '✏️',
};

const STEPS = ['Immeuble', 'Problème', 'Accès', 'Vérification'] as const;

interface Building { id: string; name: string; address: string }
interface Photo { url: string; thumbUrl: string | null }

export default function DemandePage() {
  return (
    <Suspense fallback={null}>
      <DemandeInner />
    </Suspense>
  );
}

function DemandeInner() {
  const { me, loading } = usePortalGuard();
  const router = useRouter();
  const sp = useSearchParams();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [step, setStep] = useState(1);
  const [f, setF] = useState({
    buildingId: sp.get('building') ?? '',
    unitLabel: '',
    title: '',
    problemType: '' as InterventionProblemType | '',
    details: '',
    urgent: false,
    onSiteContactName: '',
    onSiteContactPhone: '',
    accessNotes: '',
    visitPreference: '',
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (me?.isSyndic) portalApi<{ buildings: Building[] }>('/buildings').then((r) => setBuildings(r.buildings)).catch(() => {});
  }, [me]);

  if (loading || !me) return null;

  const selectedBuilding = buildings.find((b) => b.id === f.buildingId) ?? null;
  const canNext = step === 2 ? f.title.trim().length >= 3 && f.problemType !== '' : true;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const p = await portalUpload<Photo>('/requests/photos', fd);
        setPhotos((prev) => [...prev, p]);
      }
    } catch {
      alert('Échec de l’envoi d’une photo.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await portalApi('/requests', {
        method: 'POST',
        body: {
          title: f.title.trim(),
          buildingId: f.buildingId || null,
          unitLabel: f.unitLabel.trim() || null,
          details: f.details.trim() || null,
          urgent: f.urgent,
          problemType: f.problemType || null,
          onSiteContactName: f.onSiteContactName.trim() || null,
          onSiteContactPhone: f.onSiteContactPhone.trim() || null,
          accessNotes: f.accessNotes.trim() || null,
          visitPreference: f.visitPreference.trim() || null,
          photos,
        },
      });
      setDone(true);
    } catch {
      alert('Échec de l’envoi de la demande — réessaie dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell title="Nouvelle demande d’intervention" subtitle="Décrivez le besoin, nous revenons vers vous">
      <Link href="/portail/accueil" className="p-back">← Retour</Link>
      <div style={{ maxWidth: 640 }}>
        {done ? (
          <div className="p-card p-card-pad">
            <p>Votre demande a bien été transmise à JJD Consult. Nous revenons vers vous rapidement.</p>
            <button className="p-btn-primary" style={{ marginTop: '1rem' }} onClick={() => router.push('/portail/accueil')}>Retour à l’accueil</button>
          </div>
        ) : (
          <div className="p-card p-card-pad">
            <div className="p-steps">
              {STEPS.map((label, i) => (
                <div key={label} className={`p-step${i + 1 === step ? ' active' : i + 1 < step ? ' done' : ''}`}>
                  <div className="bar" />
                  <span className="lbl">{i + 1}. {label}</span>
                </div>
              ))}
            </div>

            {step === 1 && (
              <>
                {me.isSyndic && buildings.length > 0 ? (
                  <div className="p-field">
                    <label>Immeuble concerné *</label>
                    <select className="p-select" value={f.buildingId} onChange={(e) => setF({ ...f, buildingId: e.target.value })}>
                      <option value="">Choisir un immeuble…</option>
                      {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {selectedBuilding?.address && <p className="p-note" style={{ marginTop: '0.4rem' }}>{selectedBuilding.address}</p>}
                  </div>
                ) : (
                  <p className="p-note">Cette demande concerne : <strong>{me.scopeLabel ?? me.label}</strong></p>
                )}
                <div className="p-field">
                  <label>Lot, appartement ou zone précise</label>
                  <input className="p-input" value={f.unitLabel} onChange={(e) => setF({ ...f, unitLabel: e.target.value })} placeholder="ex. Appartement 3B, local technique, hall d’entrée…" />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <label style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--p-ink-2)' }}>Type de problème *</label>
                <div className="p-type-grid">
                  {INTERVENTION_PROBLEM_TYPES.map((t) => (
                    <button key={t} type="button" className={`p-type-btn${f.problemType === t ? ' on' : ''}`} onClick={() => setF({ ...f, problemType: t })}>
                      <span className="ic">{TYPE_ICON[t]}</span>
                      {INTERVENTION_PROBLEM_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                <div className="p-field">
                  <label>Objet de la demande *</label>
                  <input className="p-input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="ex. Fuite dans le local technique" />
                </div>
                <div className="p-field">
                  <label>Description</label>
                  <textarea className="p-textarea" rows={4} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Localisation précise, depuis quand, contexte…" />
                </div>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.4rem 0 1rem' }}>
                  <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} />
                  C’est urgent
                </label>
                <div className="p-field">
                  <label>Photos</label>
                  <div className="p-photo-grid">
                    {photos.map((p, i) => (
                      <div key={i} className="p-photo-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbUrl ?? p.url} alt="" />
                        <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Retirer">✕</button>
                      </div>
                    ))}
                    <label className="p-photo-add">
                      {uploading ? '…' : '+'}
                      <input type="file" accept="image/*" multiple hidden disabled={uploading} onChange={(e) => addPhotos(e.target.files)} />
                    </label>
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="p-field-2col">
                  <div className="p-field">
                    <label>Personne sur place</label>
                    <input className="p-input" value={f.onSiteContactName} onChange={(e) => setF({ ...f, onSiteContactName: e.target.value })} placeholder="Nom" />
                  </div>
                  <div className="p-field">
                    <label>Téléphone</label>
                    <input className="p-input" value={f.onSiteContactPhone} onChange={(e) => setF({ ...f, onSiteContactPhone: e.target.value })} placeholder="0470 00 00 00" />
                  </div>
                </div>
                <div className="p-field">
                  <label>Consignes d’accès</label>
                  <textarea className="p-textarea" rows={3} value={f.accessNotes} onChange={(e) => setF({ ...f, accessNotes: e.target.value })} placeholder="Code, clé chez le concierge, étage…" />
                </div>
                <div className="p-field">
                  <label>Préférence de passage</label>
                  <input className="p-input" value={f.visitPreference} onChange={(e) => setF({ ...f, visitPreference: e.target.value })} placeholder="ex. Matinée, après 17h, peu importe…" />
                </div>
              </>
            )}

            {step === 4 && (
              <div style={{ margin: '0.5rem 0 1rem' }}>
                {selectedBuilding && <div className="p-recap-row"><span className="k">Immeuble</span><span className="v">{selectedBuilding.name}</span></div>}
                {f.unitLabel && <div className="p-recap-row"><span className="k">Lot / zone</span><span className="v">{f.unitLabel}</span></div>}
                <div className="p-recap-row"><span className="k">Type</span><span className="v">{f.problemType ? `${TYPE_ICON[f.problemType]} ${INTERVENTION_PROBLEM_TYPE_LABEL[f.problemType]}` : '—'}</span></div>
                <div className="p-recap-row"><span className="k">Objet</span><span className="v">{f.title}</span></div>
                {f.details && <div className="p-recap-row"><span className="k">Description</span><span className="v">{f.details}</span></div>}
                <div className="p-recap-row"><span className="k">Urgent</span><span className="v">{f.urgent ? 'Oui' : 'Non'}</span></div>
                {photos.length > 0 && (
                  <div className="p-recap-row">
                    <span className="k">Photos</span>
                    <div className="v p-photo-grid" style={{ margin: 0 }}>
                      {photos.map((p, i) => (
                        <div key={i} className="p-photo-thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.thumbUrl ?? p.url} alt="" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {f.onSiteContactName && <div className="p-recap-row"><span className="k">Contact sur place</span><span className="v">{f.onSiteContactName}{f.onSiteContactPhone ? ` · ${f.onSiteContactPhone}` : ''}</span></div>}
                {f.accessNotes && <div className="p-recap-row"><span className="k">Accès</span><span className="v">{f.accessNotes}</span></div>}
                {f.visitPreference && <div className="p-recap-row"><span className="k">Préférence de passage</span><span className="v">{f.visitPreference}</span></div>}
              </div>
            )}

            <div className="p-wizard-nav">
              {step > 1 ? <button className="p-btn-line" onClick={() => setStep((s) => s - 1)}>← Précédent</button> : <span />}
              {step < 4 ? (
                <button className="p-btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Suivant →</button>
              ) : (
                <button className="p-btn-primary" disabled={busy} onClick={submit}>{busy ? 'Envoi…' : 'Confirmer la demande'}</button>
              )}
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
