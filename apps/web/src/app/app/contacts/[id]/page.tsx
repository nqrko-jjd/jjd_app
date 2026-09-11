'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl } from '@/lib/api';
import { PageHead, StatusBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { useSort, SortTh } from '@/lib/sort';
import { CONTACT_FIELDS } from '@/lib/forms';
import { CLIENT_KIND_LABEL, formatVat } from '@jjd/shared';

const PAGE = 30;

interface ContactPerson { id: string; role: string | null; name: string; email: string | null; phone: string | null }
interface Purchase {
  id: string; date: string | null; docNumber: string | null; categoryRaw: string | null;
  ht: number; ttc: number | null; direction: string; paid: boolean; hasPdf: boolean;
  worksite: { ref: string; title: string } | null;
}
interface BalanceLine { id: string; date: string | null; docNumber: string | null; direction: string; ht: number; ttc: number; balance: number }
interface Detail {
  contact: {
    id: string; name: string; type: string; kind: string | null;
    email: string | null; phone: string | null; vat: string | null;
    address: string | null; postalCode: string | null; city: string | null; note: string | null;
    syndic: { id: string; name: string } | null;
    building: { id: string; name: string } | null;
    buildings: { id: string; name: string }[];
    worksites: { id: string; ref: string; title: string; status: string; quotedHt: number | null }[];
    user?: { email: string } | null;
    contactPersons: ContactPerson[];
    purchases: Purchase[];
    purchaseBalance: BalanceLine[];
    purchaseSummary: { count: number; ht: number; ttc: number; balance: number };
  };
}

const PERSON_FIELDS: FieldDef[] = [
  { name: 'role', label: 'Fonction', placeholder: 'Commercial, Comptabilité, Direction…' },
  { name: 'name', label: 'Nom', required: true },
  { name: 'email', label: 'E-mail' },
  { name: 'phone', label: 'Téléphone' },
];

export default function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, reload } = useApi<Detail>(`/api/contacts/${id}`);
  const { data: pick } = useApi<{ buildings: { id: string; name: string }[]; syndics: { id: string; name: string }[] }>('/api/meta/pickers');
  const [editing, setEditing] = useState(false);
  const [personModal, setPersonModal] = useState<'new' | ContactPerson | null>(null);
  const [portalInfo, setPortalInfo] = useState<{ email: string; portal: string } | null>(null);
  const [purchasesShown, setPurchasesShown] = useState(PAGE);
  const [balanceShown, setBalanceShown] = useState(PAGE);
  const purchaseSort = useSort<Purchase>(data?.contact.purchases ?? [], {
    date: (p) => (p.date ? new Date(p.date) : null),
    docNumber: (p) => p.docNumber,
    worksite: (p) => p.worksite?.ref,
    category: (p) => p.categoryRaw,
    ht: (p) => p.ht,
    ttc: (p) => p.ttc ?? p.ht,
    status: (p) => (p.paid ? 1 : 0),
  });
  const balanceSort = useSort<BalanceLine>(data?.contact.purchaseBalance ?? [], {
    date: (b) => (b.date ? new Date(b.date) : null),
    docNumber: (b) => b.docNumber,
    debit: (b) => (b.ttc > 0 ? b.ttc : null),
    credit: (b) => (b.ttc < 0 ? -b.ttc : null),
    balance: (b) => b.balance,
  });
  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Contact introuvable.</div>;
  const c = data.contact;
  const isSupplier = c.type === 'supplier' || c.type === 'both';
  const isClientLike = c.type === 'client' || c.type === 'both';

  async function grantPortal() {
    const email = prompt('E-mail du client pour l’accès portail :', c.email ?? '');
    if (!email) return;
    try {
      const r = await api<{ email: string; portal: string }>(`/api/contacts/${id}/portal-access`, { method: 'POST', body: { email } });
      setPortalInfo(r);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function viewPurchasePdf(purchaseId: string) {
    const url = await apiBlobUrl(`/api/finance/expenses/${purchaseId}/pdf`);
    window.open(url, '_blank');
  }
  async function removePerson(pid: string) {
    if (!confirm('Supprimer cette personne de contact ?')) return;
    await api(`/api/contacts/${id}/persons/${pid}`, { method: 'DELETE' });
    reload();
  }
  async function removeContact() {
    if (!confirm(`Supprimer définitivement « ${c.name} » ? Cette action est irréversible.`)) return;
    try {
      await api(`/api/contacts/${id}`, { method: 'DELETE' });
      router.push('/app/contacts');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      {editing && (
        <FormModal
          title={`Modifier ${c.name}`}
          fields={CONTACT_FIELDS(c.type, pick?.syndics ?? [])}
          initial={{
            name: c.name, type: c.type, kind: c.kind, email: c.email, phone: c.phone,
            vat: c.vat, address: c.address, postalCode: c.postalCode, city: c.city, note: c.note,
            buildingId: c.building?.id ?? '', syndicId: c.syndic?.id ?? '',
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => { await api(`/api/contacts/${id}`, { method: 'PATCH', body: v }); reload(); }}
        />
      )}
      {personModal && (
        <FormModal
          title={personModal === 'new' ? 'Nouvelle personne de contact' : 'Modifier la personne de contact'}
          fields={PERSON_FIELDS}
          initial={personModal === 'new' ? {} : (personModal as unknown as Record<string, unknown>)}
          onClose={() => setPersonModal(null)}
          onSubmit={async (v) => {
            const path = personModal === 'new' ? `/api/contacts/${id}/persons` : `/api/contacts/${id}/persons/${(personModal as ContactPerson).id}`;
            await api(path, { method: personModal === 'new' ? 'POST' : 'PATCH', body: v });
            setPersonModal(null);
            reload();
          }}
        />
      )}
      <PageHead
        title={c.name}
        sub={c.kind ? CLIENT_KIND_LABEL[c.kind as keyof typeof CLIENT_KIND_LABEL] : c.type === 'supplier' ? 'Fournisseur' : c.type === 'both' ? 'Client + Fournisseur' : c.type}
        action={
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
            <button className="btn" onClick={removeContact}>Supprimer</button>
            <Link href="/app/contacts" className="btn">← Contacts</Link>
          </div>
        }
      />
      <div className="info-grid" style={{ marginBottom: '1.4rem' }}>
        <Info label="E-mail" value={c.email ?? '—'} />
        <Info label="Téléphone" value={c.phone ?? '—'} />
        <Info label="TVA" value={formatVat(c.vat) ?? '—'} />
        <Info label="Adresse" value={[c.address, c.postalCode, c.city].filter(Boolean).join(' ') || '—'} />
        {c.syndic && <Info label="Syndic" value={<Link href={`/app/immeubles?syndicId=${c.syndic.id}`}>{c.syndic.name}</Link>} />}
        {c.building && <Info label="Immeuble / ACP" value={<Link href={`/app/immeubles/${c.building.id}`}>{c.building.name}</Link>} />}
        {isClientLike && (
          <div className="info-cell">
            <div className="k">Accès portail client</div>
            <div className="v">
              {c.user ? (
                <><span className="badge ok">Actif</span> <span className="muted" style={{ fontSize: '0.82rem' }}>{c.user.email}</span></>
              ) : (
                <button className="btn" style={{ marginTop: '0.2rem' }} onClick={grantPortal}>Ouvrir un accès</button>
              )}
            </div>
          </div>
        )}
      </div>

      {portalInfo && (
        <div className="card card-pad" style={{ marginBottom: '1.4rem', borderLeft: '3px solid var(--ok)' }}>
          <div className="eyebrow">Accès portail créé</div>
          <p style={{ margin: '0.4rem 0 0' }}>
            <strong>{portalInfo.email}</strong> peut se connecter sur <strong>{portalInfo.portal}</strong> (lien magique, sans mot de passe).
          </p>
        </div>
      )}

      {/* Personnes de contact — utile pour tout type, en particulier les fournisseurs */}
      <div className="section-title">
        Personnes de contact <span className="hint">{c.contactPersons.length}</span>
        <button className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} onClick={() => setPersonModal('new')}>+ Ajouter</button>
      </div>
      {c.contactPersons.length === 0 ? (
        <div className="card card-pad muted" style={{ marginBottom: '1.6rem' }}>Aucune personne renseignée (commercial, comptabilité, direction…).</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: '1.6rem' }}>
          {c.contactPersons.map((p) => (
            <div key={p.id} className="card card-pad">
              {p.role && <div className="eyebrow">{p.role}</div>}
              <div style={{ fontWeight: 700, margin: '0.2rem 0' }}>{p.name}</div>
              {p.phone && <div><a href={`tel:${p.phone}`}>{p.phone}</a></div>}
              {p.email && <div className="muted" style={{ fontSize: '0.85rem' }}><a href={`mailto:${p.email}`}>{p.email}</a></div>}
              <div className="row" style={{ marginTop: '0.5rem', gap: '0.3rem' }}>
                <button className="btn ghost" style={mini} onClick={() => setPersonModal(p)}>Modifier</button>
                <button className="btn ghost" style={mini} onClick={() => removePerson(p.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Achats — fournisseurs uniquement */}
      {isSupplier && (
        <>
          <div className="section-title">Achats chez ce fournisseur</div>
          <div className="kpis" style={{ marginBottom: '1rem' }}>
            <div className="kpi"><span className="ic">Σ</span><div className="label">Total HT</div><div className="value"><Money value={c.purchaseSummary.ht} /></div></div>
            <div className="kpi"><span className="ic">€</span><div className="label">Total TTC</div><div className="value"><Money value={c.purchaseSummary.ttc} /></div></div>
            <div className={`kpi${c.purchaseSummary.balance > 0 ? ' warn' : ''}`}>
              <span className="ic">{c.purchaseSummary.balance < 0 ? '+' : '!'}</span>
              <div className="label">{c.purchaseSummary.balance < 0 ? 'Avoir en votre faveur' : 'Solde du compte'}</div>
              <div className="value"><Money value={Math.abs(c.purchaseSummary.balance)} /></div>
            </div>
            <div className="kpi"><span className="ic">#</span><div className="label">Factures</div><div className="value">{c.purchaseSummary.count}</div></div>
          </div>
          <CollapsibleSection
            title="Historique des achats"
            summary={`${c.purchases.length} ligne${c.purchases.length > 1 ? 's' : ''}`}
          >
            {c.purchases.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Aucune facture d’achat enregistrée pour ce fournisseur.</p>
            ) : (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <SortTh k="date" sort={purchaseSort}>Date</SortTh>
                        <SortTh k="docNumber" sort={purchaseSort}>N°</SortTh>
                        <SortTh k="worksite" sort={purchaseSort}>Chantier</SortTh>
                        <SortTh k="category" sort={purchaseSort}>Catégorie</SortTh>
                        <SortTh k="ht" sort={purchaseSort} align="right">HT</SortTh>
                        <SortTh k="ttc" sort={purchaseSort} align="right">TTC</SortTh>
                        <SortTh k="status" sort={purchaseSort}>Statut</SortTh>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseSort.rows.slice(0, purchasesShown).map((p) => (
                        <tr key={p.id}>
                          <td className="tnum">{formatDateBE(p.date)}</td>
                          <td className="mono" style={{ fontSize: '0.82rem' }}>{p.docNumber ?? '—'}{p.direction === 'credit_note' && <span className="badge warn" style={{ marginLeft: 6 }}>NC</span>}</td>
                          <td>{p.worksite ? `${p.worksite.ref} · ${p.worksite.title}` : '—'}</td>
                          <td>{p.categoryRaw ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}><Money value={p.ht} /></td>
                          <td style={{ textAlign: 'right' }}><Money value={p.ttc ?? p.ht} /></td>
                          <td><span className={`badge ${p.paid ? 'ok' : 'warn'}`}>{p.paid ? 'Payé' : 'Non payé'}</span></td>
                          <td>{p.hasPdf && <button className="btn ghost" style={mini} onClick={() => viewPurchasePdf(p.id)}>📎</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {purchaseSort.rows.length > purchasesShown && (
                  <button className="btn" style={{ marginTop: '0.7rem' }} onClick={() => setPurchasesShown((n) => n + PAGE)}>
                    Charger la suite ({purchaseSort.rows.length - purchasesShown} restantes)
                  </button>
                )}
              </>
            )}
          </CollapsibleSection>

          {c.purchaseBalance.length > 0 && (
            <CollapsibleSection
              title="Solde du compte"
              hint="factures non soldées et notes de crédit"
              summary={<Money value={c.purchaseSummary.balance} />}
            >
              <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>
                Utile quand vous êtes en compte chez ce fournisseur (paiement différé, pas à l’enlèvement) : les notes de crédit viennent en déduction des factures ouvertes.
              </p>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <SortTh k="date" sort={balanceSort}>Date</SortTh>
                      <SortTh k="docNumber" sort={balanceSort}>N°</SortTh>
                      <SortTh k="debit" sort={balanceSort} align="right">Débit</SortTh>
                      <SortTh k="credit" sort={balanceSort} align="right">Crédit</SortTh>
                      <SortTh k="balance" sort={balanceSort} align="right">Solde</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceSort.rows.slice(0, balanceShown).map((b) => (
                      <tr key={b.id}>
                        <td className="tnum">{formatDateBE(b.date)}</td>
                        <td className="mono" style={{ fontSize: '0.82rem' }}>{b.docNumber ?? '—'}{b.direction === 'credit_note' && <span className="badge warn" style={{ marginLeft: 6 }}>NC</span>}</td>
                        <td style={{ textAlign: 'right' }}>{b.ttc > 0 ? <Money value={b.ttc} /> : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{b.ttc < 0 ? <Money value={-b.ttc} /> : '—'}</td>
                        <td style={{ textAlign: 'right' }} className="tnum"><strong><Money value={b.balance} /></strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {balanceSort.rows.length > balanceShown && (
                <button className="btn" style={{ marginTop: '0.7rem' }} onClick={() => setBalanceShown((n) => n + PAGE)}>
                  Charger la suite ({balanceSort.rows.length - balanceShown} restantes)
                </button>
              )}
            </CollapsibleSection>
          )}
        </>
      )}

      {isClientLike && c.buildings.length > 0 && (
        <section style={{ marginBottom: '1.4rem' }}>
          <h2 style={{ marginBottom: '0.7rem' }}>Immeubles ({c.buildings.length})</h2>
          <div className="row">
            {c.buildings.map((b) => (
              <Link key={b.id} href={`/app/immeubles/${b.id}`} className="badge primary">{b.name}</Link>
            ))}
          </div>
        </section>
      )}

      {isClientLike && (
        <section>
          <h2 style={{ marginBottom: '0.7rem' }}>Chantiers ({c.worksites.length})</h2>
          {c.worksites.length === 0 ? (
            <div className="card card-pad muted">Aucun chantier.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Réf</th><th>Chantier</th><th>Statut</th><th style={{ textAlign: 'right' }}>Devisé</th></tr></thead>
                <tbody>
                  {c.worksites.map((w) => (
                    <tr key={w.id}>
                      <td className="mono">{w.ref}</td>
                      <td><Link href={`/app/chantiers/${w.id}`}>{w.title}</Link></td>
                      <td><StatusBadge status={w.status} /></td>
                      <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

const mini: React.CSSProperties = { padding: '0.15rem 0.45rem', fontSize: '0.75rem', minWidth: 0 };

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}
