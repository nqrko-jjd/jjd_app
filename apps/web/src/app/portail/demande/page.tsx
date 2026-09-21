'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, AlertTriangle } from 'lucide-react';
import { portalApi, portalUpload, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';
import { INTERVENTION_PROBLEM_TYPES, INTERVENTION_PROBLEM_TYPE_LABEL, type InterventionProblemType } from '@jjd/shared';

const TYPE_ICON: Record<InterventionProblemType, string> = {
  fuite: '💧', electricite: '⚡', chauffage: '🔥', porte: '🚪', peinture: '🎨', toiture: '🏠', autre: '✏️',
};

const STEPS = ['Immeuble', 'Problème', 'Accès', 'Vérification'] as const;

type Urgency = 'normal' | 'soon' | 'urgent';
const URGENCIES: { key: Urgency; label: string; hint: string }[] = [
  { key: 'normal', label: 'Normal', hint: 'Sans échéance particulière' },
  { key: 'soon', label: 'Rapide', hint: 'À traiter cette semaine' },
  { key: 'urgent', label: 'Urgent', hint: 'Dégât en cours ou sécurité' },
];

interface Building { id: string; name: string; address: string }
interface Photo { url: string; thumbUrl: string | null }
type FieldKey = 'buildingId' | 'problemType' | 'title';
/** Un champ obligatoire manquant : le champ + l'étape où le corriger (nommés dans le bandeau). */
interface Blocker { field: FieldKey; label: string; step: number }

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
    urgency: 'normal' as Urgency,
    onSiteContactName: '',
    onSiteContactPhone: '',
    accessNotes: '',
    visitPreference: '',
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string } | null>(null);
  const [blocked, setBlocked] = useState<Blocker | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (me?.isSyndic) portalApi<{ buildings: Building[] }>('/buildings').then((r) => setBuildings(r.buildings)).catch(() => {});
  }, [me]);

  // à chaque changement d'étape, on remonte en haut de la carte (mobile : le formulaire est long)
  // (uniquement si le haut de la carte est sorti de l'écran, jamais au premier affichage)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const top = cardRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) window.scrollBy({ top: top - 16, behavior: 'smooth' });
  }, [step]);

  if (loading || !me) return null;

  const selectedBuilding = buildings.find((b) => b.id === f.buildingId) ?? null;
  const needsBuilding = me.isSyndic && buildings.length > 0;

  /** Champs obligatoires manquants pour les étapes jusqu'à `upTo` (dans l'ordre du parcours). */
  function missing(upTo: number): Blocker[] {
    const out: Blocker[] = [];
    if (upTo >= 1 && needsBuilding && !f.buildingId) out.push({ field: 'buildingId', label: 'Immeuble concerné', step: 1 });
    if (upTo >= 2 && f.problemType === '') out.push({ field: 'problemType', label: 'Type de problème', step: 2 });
    if (upTo >= 2 && f.title.trim().length < 3) out.push({ field: 'title', label: 'Objet de la demande (3 caractères minimum)', step: 2 });
    return out;
  }
  const fieldErr = (k: FieldKey) => (blocked?.field === k ? blocked : null);

  function goNext() {
    const first = missing(step)[0];
    if (first) { setBlocked(first); return; }
    setBlocked(null);
    setStep((s) => s + 1);
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setFailure(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const p = await portalUpload<Photo>('/requests/photos', fd);
        setPhotos((prev) => [...prev, p]);
      }
    } catch {
      setFailure('Une photo n’a pas pu être envoyée. Vérifiez sa taille (image uniquement) puis réessayez.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const first = missing(3)[0];
    if (first) { setBlocked(first); return; }
    setBusy(true);
    setFailure(null);
    try {
      const r = await portalApi<{ id: string; reference: string }>('/requests', {
        method: 'POST',
        body: {
          title: f.title.trim(),
          buildingId: f.buildingId || null,
          unitLabel: f.unitLabel.trim() || null,
          details: f.details.trim() || null,
          urgency: f.urgency,
          urgent: f.urgency === 'urgent',
          problemType: f.problemType || null,
          onSiteContactName: f.onSiteContactName.trim() || null,
          onSiteContactPhone: f.onSiteContactPhone.trim() || null,
          accessNotes: f.accessNotes.trim() || null,
          visitPreference: f.visitPreference.trim() || null,
          photos,
        },
      });
      setDone({ reference: r.reference ?? '' });
    } catch {
      setFailure('La demande n’a pas pu être envoyée. Vos informations sont conservées : réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  const urgencyLabel = URGENCIES.find((u) => u.key === f.urgency)!;
  const edit = (to: number) => <button type="button" className="edit" onClick={() => { setBlocked(null); setStep(to); }}>Modifier</button>;

  return (
    <PortalShell title="Nouvelle demande d’intervention" subtitle="Décrivez le besoin, nous revenons vers vous">
      <Link href="/portail/accueil" className="p-back">← Retour</Link>
      <div style={{ maxWidth: 640 }}>
        {done ? (
          <div className="p-card p-card-pad">
            <div className="p-done" role="status">
              <div className="ok"><Check size={26} strokeWidth={2.4} /></div>
              <h2>Demande transmise à JJD Consult</h2>
              <p className="p-note" style={{ marginTop: '0.4rem' }}>Nous revenons vers vous rapidement. Gardez cette référence pour tout échange.</p>
              {done.reference && <span className="ref">{done.reference}</span>}
              <div className="acts">
                <button className="p-btn-primary" onClick={() => router.push('/portail/interventions')}>Suivre l’intervention</button>
                <button className="p-btn-line" onClick={() => router.push('/portail/accueil')}>Retour à l’accueil</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-card p-card-pad" ref={cardRef} style={{ scrollMarginTop: '1rem' }}>
            <div className="p-steps">
              {STEPS.map((label, i) => (
                <div key={label} className={`p-step${i + 1 === step ? ' active' : i + 1 < step ? ' done' : ''}`}>
                  <div className="bar" />
                  <span className="lbl">{i + 1}. {label}</span>
                </div>
              ))}
            </div>

            {blocked && (
              <div className="p-banner crit" role="alert">
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Envoi bloqué : « {blocked.label} » manque</strong>
                  À renseigner à l’étape {blocked.step} — {STEPS[blocked.step - 1]}.
                </div>
                {blocked.step !== step && <button type="button" className="p-btn-line" onClick={() => { setStep(blocked.step); }}>Aller à l’étape {blocked.step}</button>}
              </div>
            )}
            {failure && (
              <div className="p-banner warn" role="alert">
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>{failure}</div>
              </div>
            )}

            {step === 1 && (
              <>
                {needsBuilding ? (
                  <div className="p-field">
                    <label htmlFor="dem-building">Immeuble concerné *</label>
                    <select id="dem-building" className={`p-select${fieldErr('buildingId') ? ' error' : ''}`} value={f.buildingId} onChange={(e) => { setF({ ...f, buildingId: e.target.value }); setBlocked(null); }}>
                      <option value="">Choisir un immeuble…</option>
                      {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {fieldErr('buildingId') && <span className="p-field-error">Choisissez l’immeuble concerné pour continuer.</span>}
                    {selectedBuilding?.address && <p className="p-note" style={{ marginTop: '0.2rem' }}>📍 {selectedBuilding.address}</p>}
                  </div>
                ) : (
                  <p className="p-note">Cette demande concerne : <strong>{me.scopeLabel ?? me.label}</strong></p>
                )}
                <div className="p-field">
                  <label htmlFor="dem-unit">Lot, appartement ou zone précise</label>
                  <input id="dem-unit" className="p-input" value={f.unitLabel} onChange={(e) => setF({ ...f, unitLabel: e.target.value })} placeholder="ex. Appartement 3B, local technique, hall d’entrée…" />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <label style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--p-ink-2)' }}>Type de problème *</label>
                <div className="p-type-grid">
                  {INTERVENTION_PROBLEM_TYPES.map((t) => (
                    <button key={t} type="button" className={`p-type-btn${f.problemType === t ? ' on' : ''}`} onClick={() => { setF({ ...f, problemType: t }); setBlocked(null); }}>
                      <span className="ic">{TYPE_ICON[t]}</span>
                      {INTERVENTION_PROBLEM_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                {fieldErr('problemType') && <span className="p-field-error" style={{ display: 'block', marginTop: '-0.4rem', marginBottom: '0.8rem' }}>Sélectionnez le type de problème.</span>}
                <div className="p-field">
                  <label htmlFor="dem-title">Objet de la demande *</label>
                  <input id="dem-title" className={`p-input${fieldErr('title') ? ' error' : ''}`} required value={f.title} onChange={(e) => { setF({ ...f, title: e.target.value }); setBlocked(null); }} placeholder="ex. Fuite dans le local technique" />
                  {fieldErr('title') && <span className="p-field-error">Résumez le problème en quelques mots (3 caractères minimum).</span>}
                </div>
                <div className="p-field">
                  <label htmlFor="dem-details">Description <span style={{ fontWeight: 500, color: 'var(--p-ink-3)' }}>— facultative</span></label>
                  <textarea id="dem-details" className="p-textarea" rows={4} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Localisation précise, depuis quand, contexte…" />
                  <span className="p-note" style={{ fontSize: '0.78rem' }}>Plus vous êtes précis, plus notre passage est efficace.</span>
                </div>
                <div className="p-field">
                  <label>Urgence</label>
                  <div className="p-urg-grid" role="radiogroup" aria-label="Urgence">
                    {URGENCIES.map((u) => (
                      <button key={u.key} type="button" role="radio" aria-checked={f.urgency === u.key} className={`p-urg ${u.key}${f.urgency === u.key ? ' on' : ''}`} onClick={() => setF({ ...f, urgency: u.key })}>
                        <b>{u.label}</b>
                        <span>{u.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
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
                    <label htmlFor="dem-cname">Personne sur place</label>
                    <input id="dem-cname" className="p-input" value={f.onSiteContactName} onChange={(e) => setF({ ...f, onSiteContactName: e.target.value })} placeholder="Nom" />
                  </div>
                  <div className="p-field">
                    <label htmlFor="dem-cphone">Téléphone</label>
                    <input id="dem-cphone" className="p-input" inputMode="tel" value={f.onSiteContactPhone} onChange={(e) => setF({ ...f, onSiteContactPhone: e.target.value })} placeholder="0470 00 00 00" />
                  </div>
                </div>
                <div className="p-field">
                  <label htmlFor="dem-access">Consignes d’accès</label>
                  <textarea id="dem-access" className="p-textarea" rows={3} value={f.accessNotes} onChange={(e) => setF({ ...f, accessNotes: e.target.value })} placeholder="Code, clé chez le concierge, étage…" />
                </div>
                <div className="p-field">
                  <label htmlFor="dem-visit">Préférence de passage</label>
                  <input id="dem-visit" className="p-input" value={f.visitPreference} onChange={(e) => setF({ ...f, visitPreference: e.target.value })} placeholder="ex. Matinée, après 17h, peu importe…" />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div style={{ margin: '0.5rem 0 0' }}>
                  {selectedBuilding && <div className="p-recap-row"><span className="k">Immeuble</span><span className="v">{selectedBuilding.name}</span>{edit(1)}</div>}
                  <div className="p-recap-row"><span className="k">Lot / zone</span><span className="v">{f.unitLabel || '—'}</span>{edit(1)}</div>
                  <div className="p-recap-row"><span className="k">Type</span><span className="v">{f.problemType ? `${TYPE_ICON[f.problemType]} ${INTERVENTION_PROBLEM_TYPE_LABEL[f.problemType]}` : '—'}</span>{edit(2)}</div>
                  <div className="p-recap-row"><span className="k">Objet</span><span className="v">{f.title}</span>{edit(2)}</div>
                  <div className="p-recap-row"><span className="k">Description</span><span className="v">{f.details || '—'}</span>{edit(2)}</div>
                  <div className="p-recap-row"><span className="k">Urgence</span><span className="v">{urgencyLabel.label} — {urgencyLabel.hint.toLowerCase()}</span>{edit(2)}</div>
                  <div className="p-recap-row">
                    <span className="k">Photos</span>
                    {photos.length > 0 ? (
                      <div className="v p-photo-grid" style={{ margin: 0 }}>
                        {photos.map((p, i) => (
                          <div key={i} className="p-photo-thumb">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.thumbUrl ?? p.url} alt="" />
                          </div>
                        ))}
                      </div>
                    ) : <span className="v">Aucune</span>}
                    {edit(2)}
                  </div>
                  <div className="p-recap-row"><span className="k">Contact sur place</span><span className="v">{f.onSiteContactName ? `${f.onSiteContactName}${f.onSiteContactPhone ? ` · ${f.onSiteContactPhone}` : ''}` : '—'}</span>{edit(3)}</div>
                  <div className="p-recap-row"><span className="k">Accès</span><span className="v">{f.accessNotes || '—'}</span>{edit(3)}</div>
                  <div className="p-recap-row"><span className="k">Préférence de passage</span><span className="v">{f.visitPreference || '—'}</span>{edit(3)}</div>
                </div>
                <p className="p-notice">JJD Consult reçoit votre demande par e-mail et revient vers vous. Vous en suivrez l’avancement dans « Interventions » dès qu’une intervention est créée.</p>
              </>
            )}

            <div className="p-wizard-nav">
              {step > 1 ? <button className="p-btn-line" onClick={() => { setBlocked(null); setStep((s) => s - 1); }}>← Précédent</button> : <span />}
              {step < 4 ? (
                <button className="p-btn-primary" onClick={goNext}>Suivant →</button>
              ) : (
                <button className="p-btn-primary" disabled={busy} onClick={submit}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button>
              )}
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
