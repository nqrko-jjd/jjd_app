'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { AddressAutocomplete } from './AddressAutocomplete';
import { ContactPicker } from './ContactPicker';
import {
  WORKSITE_REQUEST_KINDS, WORKSITE_REQUEST_KIND_LABEL,
  WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL,
  WORKSITE_BILLING_MODES, WORKSITE_BILLING_MODE_LABEL,
  WORKSITE_BILLING_CADENCES, WORKSITE_BILLING_CADENCE_LABEL,
  WORKSITE_CONTACT_ROLES, WORKSITE_CONTACT_ROLE_LABEL,
  WORKSITE_CONTACT_FOR, WORKSITE_CONTACT_FOR_LABEL,
} from '@jjd/shared';

const STEPS = ['Demande & lieu', 'Client & contacts', 'Travail & facturation', 'Récapitulatif'] as const;

interface WizContact { role: string; name: string; phone: string; email: string; contactFor: string }

interface WizState {
  requestKind: string;
  title: string;
  description: string;
  buildingId: string; buildingLabel: string;
  address: string; postalCode: string; city: string; unitLabel: string;
  priority: string;
  managerId: string;
  startedOn: string; endedOn: string;
  clientId: string; clientLabel: string;
  contacts: WizContact[];
  accessNotes: string;
  billingMode: string;
  quoteRef: string; quotedHt: string;
  billToContactId: string; billToLabel: string;
  billToAttn: string; billToEmail: string; clientRef: string;
  billingCadence: string; billingConditions: string;
}

const EMPTY: WizState = {
  requestKind: 'ponctuelle',
  title: '',
  description: '',
  buildingId: '', buildingLabel: '',
  address: '', postalCode: '', city: '', unitLabel: '',
  priority: 'normal',
  managerId: '',
  startedOn: '', endedOn: '',
  clientId: '', clientLabel: '',
  contacts: [],
  accessNotes: '',
  billingMode: 'devis',
  quoteRef: '', quotedHt: '',
  billToContactId: '', billToLabel: '',
  billToAttn: '', billToEmail: '', clientRef: '',
  billingCadence: 'fin_intervention', billingConditions: '',
};

function newContact(): WizContact {
  return { role: 'proprietaire', name: '', phone: '', email: '', contactFor: 'demande' };
}

export function NewWorksiteWizard({
  people,
  onClose,
  onCreated,
}: {
  people: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [v, setV] = useState<WizState>(EMPTY);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<WizState>) { setV((prev) => ({ ...prev, ...p })); }
  function patchContact(i: number, p: Partial<WizContact>) {
    setV((prev) => ({ ...prev, contacts: prev.contacts.map((c, idx) => (idx === i ? { ...c, ...p } : c)) }));
  }

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!v.title.trim()) return 'Nommez le chantier.';
      if (!v.address.trim()) return 'Indiquez l’adresse des travaux.';
      if (!v.city.trim()) return 'Indiquez la ville des travaux.';
    }
    if (s === 1) {
      if (!v.clientId) return 'Indiquez le client / donneur d’ordre.';
      for (let i = 0; i < v.contacts.length; i++) {
        const c = v.contacts[i]!;
        if (!c.name.trim()) return `Contact ${i + 1} : indiquez un nom.`;
        if (!c.phone.trim() && !c.email.trim()) return `Contact ${i + 1} : ajoutez un téléphone ou un e-mail.`;
      }
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => { const n = Math.min(s + 1, STEPS.length - 1); setMaxStep((m) => Math.max(m, n)); return n; });
  }
  function goBack() { setError(null); setStep((s) => Math.max(s - 1, 0)); }
  function goTo(i: number) { if (i <= maxStep) { setError(null); setStep(i); } }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: v.title.trim(),
        description: v.description.trim() || null,
        requestKind: v.requestKind || null,
        buildingId: v.buildingId || undefined,
        address: v.address.trim(),
        postalCode: v.postalCode.trim() || null,
        city: v.city.trim(),
        unitLabel: v.unitLabel.trim() || null,
        priority: v.priority,
        managerId: v.managerId || null,
        startedOn: v.startedOn || null,
        endedOn: v.endedOn || null,
        clientId: v.clientId || null,
        contacts: v.contacts
          .filter((c) => c.name.trim())
          .map((c) => ({ role: c.role, name: c.name.trim(), phone: c.phone.trim() || null, email: c.email.trim() || null, contactFor: c.contactFor || null })),
        accessNotes: v.accessNotes.trim() || null,
        billingMode: v.billingMode || null,
        quoteRef: v.quoteRef.trim() || null,
        quotedHt: v.quotedHt ? Number(v.quotedHt) : null,
        billToContactId: v.billToContactId || v.clientId || null,
        billToAttn: v.billToAttn.trim() || null,
        billToEmail: v.billToEmail.trim() || null,
        clientRef: v.clientRef.trim() || null,
        billingCadence: v.billingCadence || null,
        billingConditions: v.billingConditions.trim() || null,
      };
      await api('/api/worksites', { method: 'POST', body });
      onCreated();
    } catch (e) {
      setError((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal wiz" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Nouveau chantier</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="wiz-body">
          <div className="wiz-steps">
            {STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                className={i === step ? 'active' : ''}
                disabled={i > maxStep}
                onClick={() => goTo(i)}
              >
                <span className="wiz-step-num">{i + 1}</span>
                {label}
              </button>
            ))}
          </div>

          {error && <div className="wiz-error">{error}</div>}

          {step === 0 && (
            <div className="wiz-grid">
              <div className="field">
                <label>Type de demande</label>
                <select className="select" value={v.requestKind} onChange={(e) => patch({ requestKind: e.target.value })}>
                  {WORKSITE_REQUEST_KINDS.map((k) => <option key={k} value={k}>{WORKSITE_REQUEST_KIND_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Priorité</label>
                <select className="select" value={v.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  {WORKSITE_PRIORITIES.map((p) => <option key={p} value={p}>{WORKSITE_PRIORITY_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="field full">
                <label>Nom du chantier *</label>
                <input className="input" value={v.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Ex. Fuite salle de bain · appartement 3B" />
              </div>
              <div className="field full">
                <label>Travaux demandés</label>
                <textarea className="input" rows={2} value={v.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Problème constaté, objectif, zone concernée…" />
              </div>
              <div className="wiz-section-title full">Où intervient-on ?</div>
              <div className="field full">
                <label>Rattacher à un immeuble / projet existant (facultatif)</label>
                <ContactPicker
                  value={v.buildingId}
                  onChange={(id, label) => patch({ buildingId: id, buildingLabel: label })}
                  kindFilter={['acp', 'developer']}
                  placeholder="Chercher un immeuble / ACP / projet…"
                />
              </div>
              <div className="field full">
                <label>Adresse des travaux *</label>
                <AddressAutocomplete
                  value={v.address}
                  onChange={(val) => patch({ address: val })}
                  onSelect={(hit) => patch({ address: hit.street, postalCode: hit.postalCode ?? v.postalCode, city: hit.city ?? v.city })}
                  placeholder="Rue et numéro"
                />
              </div>
              <div className="field">
                <label>Code postal</label>
                <input className="input" value={v.postalCode} onChange={(e) => patch({ postalCode: e.target.value })} />
              </div>
              <div className="field">
                <label>Ville *</label>
                <input className="input" value={v.city} onChange={(e) => patch({ city: e.target.value })} />
              </div>
              <div className="field full">
                <label>Lot, étage, bâtiment ou zone</label>
                <input className="input" value={v.unitLabel} onChange={(e) => patch({ unitLabel: e.target.value })} placeholder="Appartement 3B · 2e étage / parties communes" />
              </div>
              <div className="field">
                <label>Responsable JJD</label>
                <select className="select" value={v.managerId} onChange={(e) => patch({ managerId: e.target.value })}>
                  <option value="">—</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Début souhaité</label>
                <input className="input" type="date" value={v.startedOn} onChange={(e) => patch({ startedOn: e.target.value })} />
              </div>
              <div className="field">
                <label>Fin prévue</label>
                <input className="input" type="date" value={v.endedOn} onChange={(e) => patch({ endedOn: e.target.value })} />
              </div>
              <div className="wiz-hint full">Ces dates ne réservent pas encore les équipes.</div>
            </div>
          )}

          {step === 1 && (
            <div className="wiz-grid">
              <div className="wiz-note full">Le donneur d’ordre, la personne sur place et le destinataire de la facture peuvent être différents.</div>
              <div className="field full">
                <label>Client / donneur d’ordre *</label>
                <ContactPicker
                  value={v.clientId}
                  onChange={(id, label) => patch({ clientId: id, clientLabel: label })}
                  placeholder="Nom de la personne ou de l’entreprise"
                  required
                />
              </div>
              <div className="wiz-section-head full">
                <strong>Personnes de contact</strong>
                <button type="button" className="btn ghost" onClick={() => patch({ contacts: [...v.contacts, newContact()] })}>＋ Ajouter</button>
              </div>
              {v.contacts.length === 0 && (
                <div className="wiz-hint full">Ajoutez le gestionnaire, le propriétaire ou l’occupant à joindre. Vous pouvez compléter les contacts plus tard.</div>
              )}
              {v.contacts.map((c, i) => (
                <section className="wiz-contact full" key={i}>
                  <div className="wiz-section-head">
                    <strong>Contact {i + 1}</strong>
                    <button type="button" className="btn ghost" onClick={() => patch({ contacts: v.contacts.filter((_, idx) => idx !== i) })}>Retirer</button>
                  </div>
                  <div className="wiz-grid">
                    <div className="field">
                      <label>Rôle</label>
                      <select className="select" value={c.role} onChange={(e) => patchContact(i, { role: e.target.value })}>
                        {WORKSITE_CONTACT_ROLES.map((r) => <option key={r} value={r}>{WORKSITE_CONTACT_ROLE_LABEL[r]}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Nom *</label>
                      <input className="input" value={c.name} onChange={(e) => patchContact(i, { name: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Téléphone</label>
                      <input className="input" type="tel" value={c.phone} onChange={(e) => patchContact(i, { phone: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>E-mail</label>
                      <input className="input" type="email" value={c.email} onChange={(e) => patchContact(i, { email: e.target.value })} />
                    </div>
                  </div>
                  <div className="field">
                    <label>À contacter pour</label>
                    <select className="select" value={c.contactFor} onChange={(e) => patchContact(i, { contactFor: e.target.value })}>
                      {WORKSITE_CONTACT_FOR.map((f) => <option key={f} value={f}>{WORKSITE_CONTACT_FOR_LABEL[f]}</option>)}
                    </select>
                  </div>
                </section>
              ))}
              <div className="field full">
                <label>Accès et prise de rendez-vous</label>
                <textarea className="input" rows={2} value={v.accessNotes} onChange={(e) => patch({ accessNotes: e.target.value })} placeholder="Contacter le locataire avant passage, clés chez le concierge, horaires du commerce…" />
              </div>
              <div className="wiz-hint full">Ajouter un contact ne lui ouvre aucun accès et n’envoie aucun message.</div>
            </div>
          )}

          {step === 2 && (
            <div className="wiz-grid">
              <div className="field full">
                <label>Comment les travaux seront-ils réalisés ?</label>
                <select className="select" value={v.billingMode} onChange={(e) => patch({ billingMode: e.target.value })}>
                  {WORKSITE_BILLING_MODES.map((b) => <option key={b} value={b}>{WORKSITE_BILLING_MODE_LABEL[b]}</option>)}
                </select>
              </div>
              <div className="wiz-note full">
                <strong>Partie sur devis</strong>
                <div className="wiz-grid" style={{ marginTop: '0.6rem' }}>
                  <div className="field">
                    <label>Référence du devis (si disponible)</label>
                    <input className="input" value={v.quoteRef} onChange={(e) => patch({ quoteRef: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Montant prévu HT (€)</label>
                    <input className="input" type="number" step="any" value={v.quotedHt} onChange={(e) => patch({ quotedHt: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="wiz-section-title full">À qui adresser la facture ?</div>
              <div className="field full">
                {v.clientId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ marginBottom: '0.6rem', alignSelf: 'flex-start' }}
                    onClick={() => patch({ billToContactId: v.clientId, billToLabel: v.clientLabel })}
                  >
                    Facturer au client ({v.clientLabel})
                  </button>
                )}
                <label>Facturé à (si différent du client)</label>
                <ContactPicker
                  value={v.billToContactId}
                  onChange={(id, label) => patch({ billToContactId: id, billToLabel: label })}
                  placeholder="Par défaut, le client ci-dessus"
                />
              </div>
              <div className="field full">
                <label>À l’attention de / chez</label>
                <input className="input" value={v.billToAttn} onChange={(e) => patch({ billToAttn: e.target.value })} placeholder="Ex. c/o le syndic gestionnaire" />
              </div>
              <div className="field">
                <label>E-mail de facturation (si différent)</label>
                <input className="input" type="email" value={v.billToEmail} onChange={(e) => patch({ billToEmail: e.target.value })} />
              </div>
              <div className="field">
                <label>Référence client / bon de commande</label>
                <input className="input" value={v.clientRef} onChange={(e) => patch({ clientRef: e.target.value })} />
              </div>
              <div className="field">
                <label>Rythme de facturation</label>
                <select className="select" value={v.billingCadence} onChange={(e) => patch({ billingCadence: e.target.value })}>
                  {WORKSITE_BILLING_CADENCES.map((c) => <option key={c} value={c}>{WORKSITE_BILLING_CADENCE_LABEL[c]}</option>)}
                </select>
              </div>
              <div className="field full">
                <label>Conditions convenues (facultatif)</label>
                <textarea className="input" rows={2} value={v.billingConditions} onChange={(e) => patch({ billingConditions: e.target.value })} placeholder="Acompte, validation préalable, délai de paiement…" />
              </div>
            </div>
          )}

          {step === 3 && (
            <>
              <div className="wiz-note full">
                <strong>Vérifiez le dossier avant création</strong>
                <div>Les informations restent modifiables depuis la fiche du chantier.</div>
              </div>
              <dl className="wiz-summary">
                <dt>Demande</dt>
                <dd>{v.title || '—'} · {WORKSITE_REQUEST_KIND_LABEL[v.requestKind as keyof typeof WORKSITE_REQUEST_KIND_LABEL] ?? v.requestKind}</dd>
                <dt>Client / donneur d’ordre</dt>
                <dd>{v.clientLabel || '—'}</dd>
                <dt>Lieu des travaux</dt>
                <dd>{v.address}{v.unitLabel ? ` · ${v.unitLabel}` : ''}<br />{[v.postalCode, v.city].filter(Boolean).join(' ')}</dd>
                <dt>Travaux demandés</dt>
                <dd>{v.description || 'À préciser'}</dd>
                <dt>Organisation</dt>
                <dd>{people.find((p) => p.id === v.managerId)?.name ?? 'À préciser'} · {WORKSITE_PRIORITY_LABEL[v.priority as keyof typeof WORKSITE_PRIORITY_LABEL]}</dd>
                <dt>Contacts</dt>
                <dd>
                  {v.contacts.length === 0 ? 'Aucun' : v.contacts.map((c, i) => (
                    <div key={i}>{WORKSITE_CONTACT_ROLE_LABEL[c.role as keyof typeof WORKSITE_CONTACT_ROLE_LABEL]} : {c.name}{c.phone ? ` · ${c.phone}` : ''}</div>
                  ))}
                </dd>
                <dt>Accès</dt>
                <dd>{v.accessNotes || 'À préciser'}</dd>
                <dt>Mode de travail</dt>
                <dd>{WORKSITE_BILLING_MODE_LABEL[v.billingMode as keyof typeof WORKSITE_BILLING_MODE_LABEL] ?? '—'}</dd>
                <dt>Devis</dt>
                <dd>{v.quotedHt ? `${v.quotedHt} € HT` : 'Montant à préciser'}{v.quoteRef ? ` · ${v.quoteRef}` : ''}</dd>
                <dt>Destinataire de facturation</dt>
                <dd>{v.billToLabel || v.clientLabel || '—'}{v.billToAttn ? ` · ${v.billToAttn}` : ''}</dd>
                <dt>Référence client</dt>
                <dd>{v.clientRef || 'À préciser'}</dd>
                <dt>Facturation</dt>
                <dd>{WORKSITE_BILLING_CADENCE_LABEL[v.billingCadence as keyof typeof WORKSITE_BILLING_CADENCE_LABEL] ?? '—'}</dd>
                <dt>Conditions</dt>
                <dd>{v.billingConditions || 'À préciser'}</dd>
              </dl>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          {step > 0 && <button type="button" className="btn" onClick={goBack}>← Retour</button>}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn primary" onClick={goNext}>Continuer →</button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Création…' : 'Créer le chantier'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
