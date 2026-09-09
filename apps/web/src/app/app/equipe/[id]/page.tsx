'use client';
import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { PhotoHeader } from '@/components/PhotoHeader';
import { MonthBars } from '@/lib/charts';
import { useSort, SortTh } from '@/lib/sort';
import { PERSON_FIELDS, LEGAL_DOC_FIELDS } from '@/lib/forms';
import { PERSON_ROLE_LABEL, WORKER_CONTRACT_LABEL, LEGAL_DOC_LABEL, ADJUSTMENT_TYPES, ADJUSTMENT_TYPE_LABEL, formatHours, formatEur } from '@jjd/shared';

interface Adjustment { id: string; type: string; amount: number; date: string; note: string | null; settled: boolean; settledOn: string | null }
interface Detail {
  person: {
    id: string; firstName: string; lastName: string | null; displayName: string | null;
    role: string; contractType: string; hourlyRate: number | null; dailyHours: number; photoUrl: string | null;
    phone: string | null; email: string | null; address: string | null;
    languages: string[] | null; specialties: string[] | null; emergencyContact: string | null; active: boolean; note: string | null;
    legalDocs: { id: string; type: string; label: string | null; number: string | null; expiresOn: string | null; fileUrl: string | null }[];
    equipment: { id: string; name: string }[];
    user: { id: string; email: string; role: string } | null;
    adjustments: Adjustment[];
  };
  monthStatement: { hours: number; amount: number; worksites: number; guaranteeApplied: boolean; dailyHours: number };
  adjustmentBalance: number;
}

const ADJUSTMENT_FIELDS: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', required: true, options: ADJUSTMENT_TYPES.map((t) => ({ value: t, label: ADJUSTMENT_TYPE_LABEL[t] })) },
  { name: 'amount', label: 'Montant (€)', type: 'number', required: true },
  { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'note', label: 'Note', type: 'textarea', full: true, placeholder: 'Raison de l’avance, référence du PV…' },
];

interface Earnings {
  total: { hours: number; amount: number; years: number; worksites: number };
  byYear: { year: number; hours: number; amount: number; worksites: number }[];
  byWorksite: { id: string; ref: string; title: string; hours: number; amount: number; days: number; marginPct: number | null; margin: number | null }[];
}

export default function PersonDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, reload } = useApi<Detail>(`/api/people/${id}`);
  const { data: stats } = useApi<{ months: { month: string; amount: number; hours: number; worksites: number }[] }>(`/api/people/${id}/stats`);
  const { data: earnings } = useApi<Earnings>(`/api/people/${id}/earnings`);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingDoc, setAddingDoc] = useState(false);
  const [adjModal, setAdjModal] = useState<'new' | Adjustment | null>(null);
  const [worksitesShown, setWorksitesShown] = useState(10);
  const worksiteSort = useSort<Earnings['byWorksite'][number]>(earnings?.byWorksite ?? [], {
    ref: (w) => w.ref,
    hours: (w) => w.hours,
    amount: (w) => w.amount,
    margin: (w) => w.marginPct,
  });
  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Fiche introuvable.</div>;
  const p = data.person;
  const now = new Date().toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });

  async function createAccount() {
    const email = prompt('E-mail de connexion pour cette personne :', p.email ?? '');
    if (!email) return;
    try {
      const r = await api<{ email: string; password: string }>(`/api/people/${id}/account`, {
        method: 'POST',
        body: { email },
      });
      setCreated(r);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function removeDoc(docId: string) {
    if (!confirm('Supprimer ce document ?')) return;
    await api(`/api/people/${id}/legal-docs/${docId}`, { method: 'DELETE' });
    reload();
  }

  async function viewDocFile(docId: string) {
    const url = await apiBlobUrl(`/api/people/${id}/legal-docs/${docId}/file`);
    window.open(url, '_blank');
  }

  async function toggleSettled(a: Adjustment) {
    await api(`/api/people/${id}/adjustments/${a.id}/settle`, { method: 'POST', body: { settled: !a.settled } });
    reload();
  }
  async function removeAdjustment(adjId: string) {
    if (!confirm('Supprimer cette écriture ?')) return;
    await api(`/api/people/${id}/adjustments/${adjId}`, { method: 'DELETE' });
    reload();
  }

  return (
    <>
      {editing && (
        <FormModal
          title={`Modifier ${p.firstName}`}
          fields={PERSON_FIELDS}
          initial={{
            firstName: p.firstName, lastName: p.lastName, displayName: p.displayName,
            role: p.role, contractType: p.contractType, hourlyRate: p.hourlyRate, dailyHours: p.dailyHours,
            phone: p.phone, email: p.email, address: p.address,
            languages: (p.languages ?? []).join(', '), specialties: (p.specialties ?? []).join(', '),
            emergencyContact: p.emergencyContact, note: p.note,
            active: p.active,
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => { await api(`/api/people/${id}`, { method: 'PATCH', body: v }); reload(); }}
        />
      )}
      {addingDoc && (
        <FormModal
          title="Nouveau document légal"
          fields={LEGAL_DOC_FIELDS}
          onClose={() => setAddingDoc(false)}
          onSubmit={async (v) => { await api(`/api/people/${id}/legal-docs`, { method: 'POST', body: v }); reload(); }}
        />
      )}
      {adjModal && (
        <FormModal
          title={adjModal === 'new' ? 'Nouvelle avance / dette' : 'Modifier'}
          fields={ADJUSTMENT_FIELDS}
          initial={adjModal === 'new'
            ? { type: 'advance', date: toDateInput(new Date().toISOString()) }
            : { type: adjModal.type, amount: adjModal.amount, date: toDateInput(adjModal.date), note: adjModal.note }}
          onClose={() => setAdjModal(null)}
          onSubmit={async (v) => {
            const path = adjModal === 'new' ? `/api/people/${id}/adjustments` : `/api/people/${id}/adjustments/${(adjModal as Adjustment).id}`;
            await api(path, { method: adjModal === 'new' ? 'POST' : 'PATCH', body: v });
            setAdjModal(null);
            reload();
          }}
        />
      )}
      <PageHead
        title={p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim()}
        sub={`${PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role} · ${WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL]}${p.active ? '' : ' · Ancien (données conservées)'}`}
        action={
          <div className="row">
            <button className="btn" onClick={async () => { await api(`/api/people/${id}`, { method: 'PATCH', body: { active: !p.active } }); reload(); }}>
              {p.active ? 'Marquer ancien' : 'Réactiver'}
            </button>
            <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
            <Link href="/app/equipe" className="btn">← Équipe</Link>
          </div>
        }
      />

      <PhotoHeader
        basePath={`/api/people/${p.id}`}
        photoUrl={p.photoUrl}
        alt={p.displayName || p.firstName}
        shape="round"
        fallback={(p.firstName[0] ?? '') + (p.lastName?.[0] ?? '')}
        onChange={reload}
      />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: '1.4rem' }}>
        <Info label="Taux horaire" value={p.hourlyRate != null ? <Money value={p.hourlyRate} /> : <span className="badge warn">à définir</span>} />
        <Info label="Heures payées / jour presté" value={`${p.dailyHours} h`} />
        <Info label="Spécialités" value={(p.specialties ?? []).join(', ') || '—'} />
        <Info label="Téléphone" value={p.phone ?? '—'} />
        <Info label="E-mail" value={p.email ?? '—'} />
        <Info label="Adresse" value={p.address ?? '—'} />
        <Info label="Langues" value={(p.languages ?? []).join(', ') || '—'} />
        <Info label="Contact d'urgence" value={p.emergencyContact ?? '—'} />
        <div className="card card-pad">
          <div className="eyebrow">Compte appli</div>
          {p.user ? (
            <div style={{ marginTop: '0.3rem' }}><span className="badge ok">Lié</span> <span className="muted" style={{ fontSize: '0.82rem' }}>{p.user.email}</span></div>
          ) : (
            <button className="btn" style={{ marginTop: '0.4rem' }} onClick={createAccount}>Créer un compte</button>
          )}
        </div>
      </div>

      {created && (
        <div className="card card-pad" style={{ marginBottom: '1.4rem', borderLeft: '3px solid var(--ok)' }}>
          <div className="eyebrow">Compte créé — à communiquer à la personne</div>
          <p style={{ margin: '0.4rem 0 0' }}>
            E-mail : <strong>{created.email}</strong> · Mot de passe provisoire : <strong className="mono">{created.password}</strong>
          </p>
        </div>
      )}

      <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
        <div className="eyebrow">Décompte — {now}</div>
        <div className="row" style={{ marginTop: '0.4rem', gap: '2rem', flexWrap: 'wrap' }}>
          <div><div className="value" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{formatHours(data.monthStatement.hours)}</div><div className="muted" style={{ fontSize: '0.78rem' }}>heures payées</div></div>
          <div><div className="value" style={{ fontSize: '1.25rem', fontWeight: 600 }}><Money value={data.monthStatement.amount} /></div><div className="muted" style={{ fontSize: '0.78rem' }}>montant dû</div></div>
          <div><div className="value" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{data.monthStatement.worksites}</div><div className="muted" style={{ fontSize: '0.78rem' }}>chantier{data.monthStatement.worksites > 1 ? 's' : ''}</div></div>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.6rem', marginBottom: 0 }}>
          {data.monthStatement.guaranteeApplied
            ? `Un jour presté est payé au minimum ${data.monthStatement.dailyHours} h, même si moins de temps a été pointé sur le chantier ce jour-là — ce minimum s'applique ce mois-ci.`
            : `Un jour presté est payé au minimum ${data.monthStatement.dailyHours} h (réglable dans la fiche).`}
        </p>
      </section>

      {stats && stats.months.some((m) => m.amount > 0) && (
        <section style={{ marginBottom: '1.4rem' }}>
          <div className="section-title">Revenus par mois <span className="hint">survole une barre pour le détail</span></div>
          <div className="card card-pad">
            <MonthBars
              data={stats.months.map((m) => ({
                month: m.month,
                value: m.amount,
                tooltip: `${new Date(`${m.month}-01`).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })} : ${formatEur(m.amount)} · ${formatHours(m.hours)} · ${m.worksites} chantier${m.worksites > 1 ? 's' : ''}`,
              }))}
            />
          </div>
        </section>
      )}

      {earnings && earnings.total.amount > 0 && (
        <section style={{ marginBottom: '1.4rem' }}>
          <div className="section-title">Revenus — tout l’historique</div>
          <div className="kpis" style={{ marginBottom: '1rem' }}>
            <div className="kpi"><span className="ic">€</span><div className="label">Total perçu</div><div className="value"><Money value={earnings.total.amount} /></div></div>
            <div className="kpi"><span className="ic">Σ</span><div className="label">Heures payées</div><div className="value">{formatHours(earnings.total.hours)}</div></div>
            <div className="kpi"><span className="ic">#</span><div className="label">Chantiers</div><div className="value">{earnings.total.worksites}</div></div>
            <div className="kpi"><span className="ic">#</span><div className="label">Années</div><div className="value">{earnings.total.years}</div></div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1.4fr', gap: '1.2rem', alignItems: 'start' }}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Année</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Chantiers</th></tr></thead>
                <tbody>
                  {earnings.byYear.map((y) => (
                    <tr key={y.year}>
                      <td className="mono">{y.year}</td>
                      <td className="tnum">{formatHours(y.hours)}</td>
                      <td className="tnum"><Money value={y.amount} /></td>
                      <td className="tnum">{y.worksites}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <SortTh k="ref" sort={worksiteSort}>Chantier</SortTh>
                      <SortTh k="hours" sort={worksiteSort} align="right">Heures</SortTh>
                      <SortTh k="amount" sort={worksiteSort} align="right">Montant</SortTh>
                      <SortTh k="margin" sort={worksiteSort} align="right">Rentabilité du chantier</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {worksiteSort.rows.slice(0, worksitesShown).map((w) => (
                      <tr key={w.id}>
                        <td><Link href={`/app/chantiers/${w.id}`}>{w.ref} · {w.title}</Link></td>
                        <td className="tnum">{formatHours(w.hours)}</td>
                        <td className="tnum"><Money value={w.amount} /></td>
                        <td className="tnum">
                          {w.marginPct != null ? (
                            <span className={`badge ${w.marginPct >= 0 ? 'ok' : 'crit'}`}>{w.marginPct} %</span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {worksiteSort.rows.length > worksitesShown && (
                <button className="btn" style={{ marginTop: '0.7rem' }} onClick={() => setWorksitesShown((n) => n + 10)}>
                  Charger la suite ({worksiteSort.rows.length - worksitesShown} restants)
                </button>
              )}
            </div>
          </div>
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
            La rentabilité affichée est celle du chantier dans son ensemble (marge réelle), pas une part propre à cette personne — utile comme repère sur le type de chantiers où elle travaille.
          </p>
        </section>
      )}

      <section style={{ marginBottom: '1.4rem' }}>
        <div className="section-title">
          Avances &amp; dettes
          {data.adjustmentBalance > 0 && <span className="hint">à retenir sur la prochaine paie : {formatEur(data.adjustmentBalance)}</span>}
          <button className="btn primary" style={{ marginLeft: 'auto', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setAdjModal('new')}>+ Ajouter</button>
        </div>
        {p.adjustments.length === 0 ? (
          <div className="card card-pad muted">Aucune avance ni dette enregistrée.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Montant</th><th>Note</th><th>Statut</th><th /></tr></thead>
              <tbody>
                {p.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="tnum">{formatDateBE(a.date)}</td>
                    <td><span className={`badge ${a.type === 'debt' ? 'crit' : 'plain'}`}>{ADJUSTMENT_TYPE_LABEL[a.type as keyof typeof ADJUSTMENT_TYPE_LABEL] ?? a.type}</span></td>
                    <td style={{ textAlign: 'right' }}><Money value={a.amount} /></td>
                    <td className="muted" style={{ fontSize: '0.85rem' }}>{a.note ?? '—'}</td>
                    <td>
                      <button className={`badge ${a.settled ? 'ok' : 'warn'}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => toggleSettled(a)} title="Basculer réglé / à déduire">
                        {a.settled ? 'Réglé' : 'À déduire'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row" style={{ gap: '0.3rem', justifyContent: 'flex-end' }}>
                        <button className="btn ghost" style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }} onClick={() => setAdjModal(a)}>Modifier</button>
                        <button className="btn ghost" style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }} onClick={() => removeAdjustment(a.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginBottom: '1.4rem' }}>
        <div className="section-title">
          Documents légaux
          <button className="btn primary" style={{ marginLeft: 'auto', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setAddingDoc(true)}>+ Ajouter</button>
        </div>
        {p.legalDocs.length === 0 ? (
          <div className="card card-pad muted">Aucun document enregistré (A1, Limosa, VCA, permis…).</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Numéro</th><th>Échéance</th><th>Pièce jointe</th><th /></tr></thead>
              <tbody>
                {p.legalDocs.map((d) => {
                  const soon = d.expiresOn && new Date(d.expiresOn).getTime() < Date.now() + 30 * 86400000;
                  return (
                    <tr key={d.id}>
                      <td>{d.label || LEGAL_DOC_LABEL[d.type as keyof typeof LEGAL_DOC_LABEL] || d.type}</td>
                      <td className="mono">{d.number ?? '—'}</td>
                      <td className="tnum">{d.expiresOn ? <span className={soon ? 'badge crit' : ''}>{formatDateBE(d.expiresOn)}</span> : '—'}</td>
                      <td><DocFile docId={d.id} hasFile={!!d.fileUrl} personId={id} onView={() => viewDocFile(d.id)} onUploaded={reload} /></td>
                      <td style={{ textAlign: 'right' }}><button className="btn ghost" onClick={() => removeDoc(d.id)} aria-label="Supprimer">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function DocFile({ personId, docId, hasFile, onView, onUploaded }: { personId: string; docId: string; hasFile: boolean; onView: () => void; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(f: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await apiUpload(`/api/people/${personId}/legal-docs/${docId}/file`, fd);
      onUploaded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
      <input ref={inputRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      {hasFile && <button className="btn" style={{ padding: '0.15rem 0.5rem', fontSize: '0.76rem' }} onClick={onView}>Voir 📎</button>}
      <button className="btn" style={{ padding: '0.15rem 0.5rem', fontSize: '0.76rem' }} disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Envoi…' : hasFile ? 'Remplacer' : 'Joindre'}
      </button>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}
