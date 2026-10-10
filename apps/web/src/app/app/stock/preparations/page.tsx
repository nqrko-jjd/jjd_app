'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Thumb, formatDateBE } from '@/lib/ui';
import { SkeletonRows, EmptyState } from '@/components/States';
import { ComboBox } from '@/components/ComboBox';
import type { StockItemFull } from '@/components/StockItemModal';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/stock-orders-ui';

interface OrderRow {
  id: string; ref: string; status: string; neededOn: string | null; note: string | null; createdAt: string;
  worksite: { id: string; ref: string; title: string };
  lineCount: number; doneLines: number;
}
interface Meta { worksites: { id: string; name: string }[] }

export default function PreparationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const [tab, setTab] = useState<'open' | 'prepared'>('open');
  const { data, loading, reload } = useApi<{ items: OrderRow[] }>(`/api/stock-orders?status=${tab}`);
  const [creating, setCreating] = useState(false);

  // le magasinier laisse l'écran ouvert : la liste se rafraîchit toute seule quand le bureau crée une préparation
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  const items = data?.items ?? [];
  return (
    <>
      {creating && <NewOrderModal onClose={() => setCreating(false)} onCreated={(id) => router.push(`/app/stock/preparations/${id}`)} />}
      <PageHead
        eyebrow={tr("Magasin")}
        title="Préparations de commande"
        sub="Le bureau crée la liste pour un chantier, le magasinier la prépare en scannant chaque article"
        action={canManage ? <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle préparation</button> : undefined}
      />
      <div className="msg-filter-chips" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>{tr("À préparer")}</button>
        <button className={tab === 'prepared' ? 'on' : ''} onClick={() => setTab('prepared')}>Préparées</button>
      </div>
      {loading && !data && <SkeletonRows />}
      {data && items.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title={tab === 'open' ? 'Rien à préparer' : 'Aucune préparation terminée'}
          text={tab === 'open' ? 'Les préparations créées pour un chantier apparaissent ici.' : 'Les préparations validées apparaissent ici.'}
          action={canManage && tab === 'open' ? <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle préparation</button> : undefined}
        />
      )}
      <div style={{ display: 'grid', gap: '0.7rem' }}>
        {items.map((o) => (
          <Link key={o.id} href={`/app/stock/preparations/${o.id}`} className="card card-pad" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '1rem' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                  <strong className="mono">{o.ref}</strong>
                  <span className={`badge ${ORDER_STATUS_TONE[o.status] ?? ''}`}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
                  {o.neededOn && <span className="muted" style={{ fontSize: '0.82rem' }}>pour le {formatDateBE(o.neededOn)}</span>}
                </div>
                <div style={{ fontWeight: 650, marginTop: 4 }}>{o.worksite.ref} · {o.worksite.title}</div>
                {o.note && <div className="muted" style={{ fontSize: '0.82rem' }}>{o.note}</div>}
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{o.doneLines}/{o.lineCount}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>{tr("articles prêts")}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- création */

interface DraftLine { stockItemId: string; unitName: string; qty: string }

const fmtQty = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);

/** Facteur vers l'unité de base de l'article pour une unité choisie sur la ligne (vide = base). */
const factorOf = (it: StockItemFull, unitName: string | null) =>
  (!unitName || unitName.toLowerCase() === it.unit.toLowerCase() ? 1 : it.units.find((u) => u.name.toLowerCase() === unitName.toLowerCase())?.factor ?? 1);

/** Pastille de stock d'un article — insuffisant seulement si on connaît la quantité demandée (`needed`, en unité de base). */
function StockBadge({ item, needed }: { item: StockItemFull; needed: number }) {
  const out = item.qty <= 0;
  const low = !out && needed > 0.001 && item.qty < needed;
  const tone = out ? 'crit' : low ? 'warn' : 'ok';
  const text = out ? 'Rupture de stock' : low ? `${fmtQty(item.qty)} ${item.unit} dispo (insuffisant)` : `${fmtQty(item.qty)} ${item.unit} en stock`;
  return <span className={`badge ${tone}`} style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{text}</span>;
}

/** Sélecteur d'article riche (photo + stock visible) — remplace un simple champ texte pour qu'on
 *  voie tout de suite s'il y a du stock, sans avoir à lire une liste déroulante en texte brut. */
function ArticlePicker({ items, value, onChange, needed }: {
  items: StockItemFull[]; value: string; onChange: (id: string) => void; needed: number;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = items.find((it) => it.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = !q
      ? items
      : items.filter((it) => [it.ref, it.name, it.brand, it.model, it.category, ...it.suppliers.map((s) => s.supplierRef)]
          .filter(Boolean).join(' ').toLowerCase().includes(q));
    return pool.slice(0, 30);
  }, [items, query]);

  if (selected && !open) {
    return (
      <div className="row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'nowrap' }}>
        <Thumb src={selected.photoThumbUrl} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{selected.ref ? `${selected.ref} · ` : ''}{selected.name}</div>
          <StockBadge item={selected} needed={needed} />
        </div>
        <button type="button" className="btn ghost" style={{ fontSize: '0.76rem' }} onClick={() => { setOpen(true); setQuery(''); }}>Changer</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        placeholder="Chercher un article (nom, réf., réf. fournisseur)…"
        value={query}
        autoFocus={open}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 280, overflowY: 'auto' }}
        >
          {filtered.length === 0 && <div className="muted" style={{ padding: '0.6rem', fontSize: '0.85rem' }}>Aucun résultat.</div>}
          {filtered.map((it) => (
            <button
              key={it.id}
              type="button"
              className="row"
              style={{ width: '100%', textAlign: 'left', padding: '0.4rem 0.6rem', gap: '0.5rem', alignItems: 'center', flexWrap: 'nowrap', border: 0, borderBottom: '1px solid var(--line)', background: 'transparent', cursor: 'pointer' }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(it.id); setOpen(false); setQuery(''); }}
            >
              <Thumb src={it.photoThumbUrl} size={30} />
              <span style={{ flex: 1, minWidth: 0, fontSize: '0.84rem' }}>
                {it.ref ? `${it.ref} · ` : ''}{it.name}{(it.brand || it.model) ? ` (${[it.brand, it.model].filter(Boolean).join(' ')})` : ''}
              </span>
              <StockBadge item={it} needed={0} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: meta } = useApi<Meta>('/api/stock/meta');
  const { data: itemsData } = useApi<{ items: StockItemFull[] }>('/api/stock/items');
  const items = itemsData?.items ?? [];
  const [worksiteId, setWorksiteId] = useState('');
  const [neededOn, setNeededOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ stockItemId: '', unitName: '', qty: '1' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string | null>(null);
  const [orderMsg, setOrderMsg] = useState<{ text: string; href: string } | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Commande fournisseur brouillon pour le manquant — le fournisseur préféré de l'article si
   *  connu, sinon le premier renseigné ; à défaut, on renvoie compléter la fiche article. */
  async function orderMissing(it: StockItemFull, missingQty: number) {
    const preferred = it.suppliers.find((s) => s.preferred) ?? it.suppliers[0] ?? null;
    if (!preferred) {
      alert(`Aucun fournisseur enregistré pour « ${it.name} ». Ajoutez-en un depuis sa fiche article, puis réessayez.`);
      return;
    }
    if (!worksiteId) { setErr('Choisissez d’abord un chantier avant de commander le manquant.'); return; }
    setOrdering(it.id);
    try {
      const r = await api<{ order: { id: string; ref: string } }>('/api/purchasing/orders', {
        method: 'POST',
        body: {
          contactId: preferred.contactId,
          worksiteId,
          status: 'draft',
          note: 'Manquant détecté en préparant une commande de stock',
          lines: [{ stockItemId: it.id, qty: Math.round(missingQty * 100) / 100 }],
        },
      });
      setOrderMsg({ text: `Commande ${r.order.ref} créée (brouillon) chez ${preferred.contact.name} pour « ${it.name} ».`, href: `/app/stock/commandes/${r.order.id}` });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setOrdering(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = lines.filter((l) => l.stockItemId);
    if (!worksiteId) { setErr('Choisissez un chantier'); return; }
    if (!valid.length) { setErr('Ajoutez au moins un article'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ order: { id: string } }>('/api/stock-orders', {
        method: 'POST',
        body: {
          worksiteId, neededOn: neededOn || null, note: note || null,
          lines: valid.map((l) => ({ stockItemId: l.stockItemId, unitName: l.unitName || null, qty: Number(String(l.qty).replace(',', '.')) })),
        },
      });
      onCreated(r.order.id);
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
      <form className="modal wiz" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Nouvelle préparation de commande</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div className="wiz-body">
          <div className="plan-form-intro">
            <strong>Une liste pour le magasinier</strong>
            <p style={{ margin: '0.2rem 0 0' }}>
              Indiquez le chantier et les articles nécessaires. Le magasinier la retrouve dans « Préparations », coche chaque article en le scannant, puis la marque prête.
            </p>
          </div>
          {err && <div className="plan-form-error">{err}</div>}
          {orderMsg && (
            <div className="badge ok" style={{ padding: '0.5rem 0.7rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {orderMsg.text}
              <a href={orderMsg.href} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>Ouvrir →</a>
            </div>
          )}

          <fieldset>
            <legend>01 · Chantier & délai</legend>
            <div className="field" style={{ marginBottom: '0.85rem' }}>
              <label>Chantier *</label>
              <ComboBox placeholder="Chercher un chantier (réf ou nom)…" value={worksiteId} onChange={setWorksiteId} options={(meta?.worksites ?? []).map((w) => ({ value: w.id, label: w.name }))} />
            </div>
            <div className="wiz-grid">
              <div className="field">
                <label htmlFor="po-date">Besoin sur chantier le (facultatif)</label>
                <input id="po-date" className="input" type="date" value={neededOn} onChange={(e) => setNeededOn(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="po-note">Note pour le magasinier</label>
                <input id="po-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Livraison chantier lundi 7h…" />
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>02 · Articles à préparer</legend>
            <div className="row" style={{ gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.76rem', fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              <div style={{ flex: 1 }}>{tr("Article")}</div>
              <div style={{ width: 90 }}>Quantité</div>
              <div style={{ width: 130 }}>Unité</div>
              <div style={{ width: 30 }} />
            </div>
            {lines.map((l, i) => {
              const it = items.find((x) => x.id === l.stockItemId) ?? null;
              const factor = it ? factorOf(it, l.unitName || null) : 1;
              const neededBase = it ? Number(String(l.qty).replace(',', '.') || 0) * factor : 0;
              const missingBase = it ? Math.max(0, neededBase - it.qty) : 0;
              return (
                <div key={i} style={{ marginBottom: '0.6rem' }}>
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ArticlePicker items={items} value={l.stockItemId} onChange={(v) => setLine(i, { stockItemId: v, unitName: '' })} needed={neededBase} />
                    </div>
                    <input className="input" style={{ width: 90 }} type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label="Quantité" />
                    <select className="select" style={{ width: 130 }} value={l.unitName} onChange={(e) => setLine(i, { unitName: e.target.value })} aria-label="Unité" disabled={!it}>
                      <option value="">{it?.unit ?? 'unité'}</option>
                      {(it?.units ?? []).map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                    </select>
                    <button type="button" className="btn ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Retirer cet article" title="Retirer cet article">✕</button>
                  </div>
                  {it && missingBase > 0.001 && (
                    <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginTop: '0.35rem', paddingLeft: '2.2rem' }}>
                      <span className="badge crit" style={{ fontSize: '0.72rem' }}>Manque {fmtQty(missingBase)} {it.unit}</span>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.15rem 0.5rem', fontSize: '0.74rem' }}
                        disabled={ordering === it.id}
                        onClick={() => orderMissing(it, missingBase)}
                      >
                        {ordering === it.id ? 'Commande…' : '→ Commander le manquant'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setLines((ls) => [...ls, { stockItemId: '', unitName: '', qty: '1' }])}>+ Ajouter un article</button>
            <p className="wiz-hint" style={{ marginTop: '0.7rem' }}>La quantité déjà en stock s’affiche à côté de chaque article. En cas de manque, une commande fournisseur brouillon peut être créée d’un clic (fournisseur préféré de l’article).</p>
          </fieldset>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Création…' : 'Créer la préparation'}</button>
        </div>
      </form>
    </div>
  );
}
