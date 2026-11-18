'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, Avatar, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState } from '@/components/States';
import { FormModal } from '@/components/FormModal';
import { BankExpenseCreate } from '@/components/BankExpenseCreate';

interface PersonRef { id: string; firstName: string; lastName: string | null; displayName: string | null; photoThumbUrl: string | null; active: boolean }
interface Card {
  id: string; network: 'bancontact' | 'visa'; bank: string | null; last4: string; prefix: string | null; holderName: string | null;
  label: string | null; personId: string | null; person: PersonRef | null; status: string; expiresOn: string | null; monthlyLimit: number | null; note: string | null;
  stats: { monthSpend: number; prevMonthSpend: number; yearSpend: number; count: number; lastUsedAt: string | null; lastMerchant: string | null; lastAmount: number | null; toJustify: number; toJustifyAmount: number };
}
interface CardTx { id: string; date: string | null; amount: number | null; merchant: string; justified: boolean; links: { id: string | null; label: string; worksiteRef: string | null }[] }

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'ok' }, blocked: { label: 'Bloquée', tone: 'warn' }, lost: { label: 'Perdue / volée', tone: 'crit' }, expired: { label: 'Expirée', tone: '' },
};
const personName = (p: PersonRef | null) => (p ? p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') : null);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Cartes de paiement de l'entreprise : qui a quelle carte (Bancontact, Visa), ce qui a été payé avec,
 * et les dépenses encore sans justificatif. Les cartes apparaissent toutes seules dès qu'elles servent sur un relevé.
 */
export default function CardsPage() {
  const { data, loading, error, reload } = useApi<{ items: Card[]; people: PersonRef[] }>('/api/finance/cards');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const cards = data?.items ?? [];
  useEffect(() => { if (!selected && cards.length) setSelected(cards[0]!.id); }, [cards, selected]);
  const card = cards.find((c) => c.id === selected) ?? null;
  const month = cards.reduce((s, c) => s + c.stats.monthSpend, 0);
  const toJustify = cards.reduce((s, c) => s + c.stats.toJustify, 0);

  return (
    <>
      <PageHead
        title="Cartes de paiement"
        sub={data ? `${cards.length} carte(s) · ${new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(month)} dépensés ce mois${toJustify ? ` · ${toJustify} paiement(s) sans justificatif` : ''}` : undefined}
        action={<><button className="btn" onClick={() => setAdding(true)}>+ Ajouter une carte</button><Link href="/app/finances/banque" className="btn">← Rapprochement bancaire</Link></>}
      />
      {error ? <ErrorState message={String(error)} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} /> : (
        <>
          {cards.length === 0 && <div className="card card-pad muted">Aucune carte reconnue sur les relevés pour l’instant. Ajoutez-en une avec ses 4 derniers chiffres.</div>}
          <div className="pay-cards-rail" role="list">
            {cards.map((c) => (
              <button key={c.id} type="button" role="listitem" className={`pay-card-tile${c.id === selected ? ' is-selected' : ''}`} onClick={() => setSelected(c.id)} aria-pressed={c.id === selected}>
                <PayCard card={c} />
                <div className="pay-card-meta">
                  <span className="pay-card-owner">
                    {c.person ? <><Avatar src={c.person.photoThumbUrl} label={personName(c.person)!} size={22} />{personName(c.person)}</> : <span className="muted">Non attribuée</span>}
                  </span>
                  <span><strong><Money value={c.stats.monthSpend} /></strong> <span className="muted">ce mois</span></span>
                </div>
              </button>
            ))}
          </div>
          {card && <CardDetail key={card.id} card={card} people={data?.people ?? []} onSaved={reload} />}
        </>
      )}
      {adding && <AddCard onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); setSelected(id); reload(); }} />}
    </>
  );
}

/** La carte elle-même, dessinée comme dans une appli bancaire. */
function PayCard({ card, big }: { card: Card; big?: boolean }) {
  const blocked = card.status !== 'active';
  return (
    <div className={`pay-card net-${card.network}${big ? ' is-big' : ''}${blocked ? ' is-off' : ''}`} aria-label={`${card.network === 'visa' ? 'Visa' : 'Bancontact'} se terminant par ${card.last4}`}>
      <div className="pay-card-top">
        <span className="pay-card-bank">{card.label || card.bank || (card.network === 'visa' ? 'Carte de crédit' : 'Carte de débit')}</span>
        {blocked && <span className="pay-card-flag">{STATUS[card.status]?.label ?? card.status}</span>}
      </div>
      <div className="pay-card-chip" aria-hidden />
      <div className="pay-card-number">•••• •••• •••• {card.last4}</div>
      <div className="pay-card-bottom">
        <span className="pay-card-holder">{card.holderName || personName(card.person) || 'JJD CONSULT'}</span>
        <span className="pay-card-brand">{card.network === 'visa' ? 'VISA' : 'Bancontact'}</span>
      </div>
    </div>
  );
}

function CardDetail({ card, people, onSaved }: { card: Card; people: PersonRef[]; onSaved: () => void }) {
  const [months, setMonths] = useState(6);
  const { data, loading, reload: reloadTx } = useApi<{ items: CardTx[]; months: { month: string; spend: number }[] }>(`/api/finance/cards/${card.id}/transactions?months=${months}`);
  const [openTx, setOpenTx] = useState<string | null>(null);
  const [form, setForm] = useState({ personId: card.personId ?? '', label: card.label ?? '', holderName: card.holderName ?? '', status: card.status, expiresOn: card.expiresOn?.slice(0, 7) ?? '', monthlyLimit: card.monthlyLimit?.toString() ?? '', note: card.note ?? '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [onlyTodo, setOnlyTodo] = useState(false);
  const dirty = form.personId !== (card.personId ?? '') || form.label !== (card.label ?? '') || form.holderName !== (card.holderName ?? '') || form.status !== card.status
    || form.expiresOn !== (card.expiresOn?.slice(0, 7) ?? '') || form.monthlyLimit !== (card.monthlyLimit?.toString() ?? '') || form.note !== (card.note ?? '');

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/finance/cards/${card.id}`, { method: 'PATCH', body: { ...form, expiresOn: form.expiresOn ? `${form.expiresOn}-01` : null, monthlyLimit: form.monthlyLimit || null } });
      setMsg('Enregistré.'); onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const max = Math.max(1, ...(data?.months ?? []).map((m) => m.spend), card.monthlyLimit ?? 0);
  const txs = useMemo(() => (data?.items ?? []).filter((t) => !onlyTodo || (!t.justified && (t.amount ?? 0) < 0)), [data, onlyTodo]);
  const limitPct = card.monthlyLimit ? Math.min(100, Math.round((card.stats.monthSpend / card.monthlyLimit) * 100)) : null;

  return (
    <div className="pay-card-detail">
      <section className="card card-pad pay-card-side">
        <PayCard card={card} big />
        <div className="pay-card-kpis">
          <div><span>Ce mois</span><strong><Money value={card.stats.monthSpend} /></strong>{limitPct !== null && <div className="pay-limit" aria-label={`${limitPct} % du plafond`}><i style={{ width: `${limitPct}%` }} className={limitPct >= 90 ? 'crit' : ''} /></div>}</div>
          <div><span>Mois passé</span><strong><Money value={card.stats.prevMonthSpend} /></strong></div>
          <div><span>Sans justificatif</span><strong className={card.stats.toJustify ? 'crit' : ''}>{card.stats.toJustify} · <Money value={card.stats.toJustifyAmount} /></strong></div>
        </div>
        {card.stats.lastUsedAt && <p className="muted" style={{ fontSize: '0.82rem', margin: '0 0 0.8rem' }}>Dernier paiement le {formatDateBE(card.stats.lastUsedAt)} : {card.stats.lastMerchant} (<Money value={card.stats.lastAmount} />)</p>}

        <div className="grid" style={{ gap: '0.65rem' }}>
          <div className="field">
            <label htmlFor="card-person">Utilisée par</label>
            <select id="card-person" className="select" value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })}>
              <option value="">— Personne (au bureau) —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}
            </select>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            <div className="field"><label htmlFor="card-label">Nom de la carte</label><input id="card-label" className="input" value={form.label} placeholder="ex. Carte camionnette" onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
            <div className="field"><label htmlFor="card-holder">Nom imprimé</label><input id="card-holder" className="input" value={form.holderName} onChange={(e) => setForm({ ...form, holderName: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="card-status">Statut</label>
              <select id="card-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="card-exp">Expire fin</label><input id="card-exp" type="month" className="input" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} /></div>
            <div className="field"><label htmlFor="card-limit">Plafond mensuel (€)</label><input id="card-limit" type="number" min={0} className="input" value={form.monthlyLimit} onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })} /></div>
            <div className="field"><label htmlFor="card-note">Note</label><input id="card-note" className="input" value={form.note} placeholder="code PIN chez…, carte essence…" onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <div className="row" style={{ gap: '0.6rem', alignItems: 'center' }}>
            <button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            {msg && <span className="muted" role="status">{msg}</span>}
          </div>
        </div>
      </section>

      <section className="card card-pad pay-card-activity">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Dépenses</h2>
          <div className="row" style={{ gap: '0.4rem' }}>
            {[3, 6, 12].map((m) => <button key={m} className={`btn sm${months === m ? ' primary' : ''}`} onClick={() => setMonths(m)}>{m} mois</button>)}
          </div>
        </div>
        <div className="pay-bars" aria-label="Dépenses par mois">
          {(data?.months ?? []).map((m) => (
            <div key={m.month} className="pay-bar" title={`${m.month} : ${m.spend.toFixed(2)} €`}>
              <span className="pay-bar-val"><Money value={m.spend} /></span>
              <i style={{ height: `${Math.max(3, (m.spend / max) * 100)}%` }} />
              <span className="pay-bar-lab">{MONTHS[Number(m.month.slice(5)) - 1]}</span>
            </div>
          ))}
        </div>
        <label className="row" style={{ gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', margin: '0.6rem 0' }}>
          <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} /> Seulement les paiements sans justificatif
        </label>
        {loading && !data ? <SkeletonRows rows={5} /> : txs.length === 0 ? <p className="muted">Aucune opération sur cette période.</p> : (
          <ul className="pay-tx-list">
            {txs.map((t) => {
              const todo = !t.justified && (t.amount ?? 0) < 0;
              const open = openTx === t.id;
              return (
                <li key={t.id} className={open ? 'is-open' : undefined}>
                  <button type="button" className="pay-tx-row" onClick={() => setOpenTx(open ? null : t.id)} aria-expanded={open}>
                    <div className="pay-tx-main">
                      <strong>{t.merchant || 'Paiement'}</strong>
                      <span className="muted">
                        {t.date ? formatDateBE(t.date) : ''}
                        {t.links.length > 0 && <> · {t.links.map((l) => [l.label, l.worksiteRef].filter(Boolean).join(' → ')).join(', ')}</>}
                      </span>
                    </div>
                    <div className="pay-tx-side">
                      <span className={(t.amount ?? 0) > 0 ? 'pos' : ''}><Money value={t.amount} /></span>
                      {(t.amount ?? 0) < 0 && (t.justified ? <span className="badge ok">Justifié</span> : <span className="badge warn">À justifier</span>)}
                    </div>
                  </button>
                  {open && (
                    <TxReconcile
                      tx={t}
                      todo={todo}
                      onDone={(m) => { setMsg(m); setOpenTx(null); reloadTx(); onSaved(); }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

interface Suggestion { kind: 'ledger' | 'document'; id: string; label: string; amount: number | null; date: string | null; direction: string; worksiteRef: string | null }

/**
 * Rapprochement d'un paiement carte, directement sous la ligne : factures/tickets proposés (un clic pour lier),
 * recherche, ou dépense sans facture (parking, carburant…). Même logique que le rapprochement bancaire.
 */
function TxReconcile({ tx, todo, onDone }: { tx: CardTx; todo: boolean; onDone: (msg: string) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'invoice' | 'expense'>('invoice');
  const { data: sugg, loading } = useApi<{ items: Suggestion[]; remaining: number }>(todo ? `/api/finance/bank/${tx.id}/suggestions${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}` : null);
  const purchases = (sugg?.items ?? []).filter((s) => s.direction !== 'sale');

  async function link(s: Suggestion) {
    setBusy(s.id); setErr(null);
    try {
      const amount = Math.min(s.amount ?? 0, sugg?.remaining ?? Math.abs(tx.amount ?? 0));
      await api(`/api/finance/bank/${tx.id}/matches`, { method: 'POST', body: { ...(s.kind === 'ledger' ? { ledgerId: s.id } : { documentId: s.id }), amount } });
      onDone(`Paiement de ${tx.merchant} lié à ${s.label}.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  if (!todo) {
    return (
      <div className="pay-tx-panel">
        {tx.links.length ? <>Lié à : {tx.links.map((l, i) => <span key={i}>{i > 0 && ', '}{l.id ? <Link href={`/app/achats?q=${encodeURIComponent(l.label.split(' · ').pop() ?? '')}`}>{l.label || 'dépense'}</Link> : l.label}{l.worksiteRef ? ` → ${l.worksiteRef}` : ''}</span>)}</> : 'Justifié (remboursement lié).'}
        <span className="muted"> · Pour défaire, passez par le <Link href={`/app/finances/banque?transactionId=${tx.id}`}>rapprochement bancaire</Link>.</span>
      </div>
    );
  }
  return (
    <div className="pay-tx-panel">
      <div className="pay-seg" role="tablist" aria-label="Comment justifier ce paiement">
        <button role="tab" aria-selected={mode === 'invoice'} className={mode === 'invoice' ? 'is-on' : ''} onClick={() => setMode('invoice')}>J’ai la facture / le ticket</button>
        <button role="tab" aria-selected={mode === 'expense'} className={mode === 'expense' ? 'is-on' : ''} onClick={() => setMode('expense')}>Pas de facture</button>
      </div>
      {mode === 'invoice' ? (
        <>
          <input className="input" placeholder="Chercher : fournisseur, n° de facture, chantier, montant…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.5rem' }} />
          {loading && !sugg ? <span className="muted">Recherche…</span> : purchases.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{q.trim() ? 'Aucune facture trouvée.' : 'Aucune facture du même montant pour l’instant. Cherchez-la, ou créez la dépense (« Pas de facture »). Si le ticket n’est pas encore encodé, il apparaîtra ici dès qu’il le sera.'}</p>
          ) : (
            <div className="pay-sugg">
              {purchases.slice(0, 8).map((s) => (
                <button key={`${s.kind}-${s.id}`} className="pay-sugg-item" disabled={!!busy} onClick={() => link(s)}>
                  <span><strong>{s.label}</strong><span className="muted">{[s.worksiteRef, s.date ? formatDateBE(s.date) : null].filter(Boolean).join(' · ')}</span></span>
                  <span className="pay-sugg-amt"><Money value={s.amount} /><em>{busy === s.id ? 'Liaison…' : 'Lier'}</em></span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <BankExpenseCreate txId={tx.id} onDone={onDone} />
      )}
      {err && <p role="alert" className="badge crit" style={{ margin: '0.5rem 0 0' }}>{err}</p>}
    </div>
  );
}

function AddCard({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  return (
    <FormModal
      title="Ajouter une carte"
      fields={[
        { name: 'network', label: 'Type', type: 'select', required: true, options: [{ value: 'bancontact', label: 'Bancontact (carte de débit)' }, { value: 'visa', label: 'Visa (carte de crédit)' }] },
        { name: 'bank', label: 'Banque', placeholder: 'Belfius, ING…' },
        { name: 'last4', label: '4 derniers chiffres', required: true, placeholder: '6094' },
        { name: 'holderName', label: 'Nom imprimé sur la carte' },
        { name: 'label', label: 'Nom de la carte', placeholder: 'ex. Carte camionnette' },
      ]}
      initial={{ network: 'bancontact', bank: 'Belfius' }}
      onClose={onClose}
      onSubmit={async (v) => {
        const r = await api<{ card: { id: string } }>('/api/finance/cards', { method: 'POST', body: { ...v, last4: String(v.last4 ?? '').replace(/\D/g, '') } });
        onDone(r.card.id);
      }}
    />
  );
}
