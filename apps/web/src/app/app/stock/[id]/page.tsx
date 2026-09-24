'use client';
import { Warehouse, Layers, AlertTriangle, Package } from 'lucide-react';
import { SkeletonRows, EmptyState } from '@/components/States';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Money, formatDateBE, formatEur, Kpi } from '@/lib/ui';
import { ComboBox } from '@/components/ComboBox';
import { ContactPicker } from '@/components/ContactPicker';
import { ScanInput } from '@/components/ScanInput';
import { PaginationBar, PAGE_SIZE_ALL } from '@/components/PaginationBar';
import { PhotoHeader } from '@/components/PhotoHeader';
import { StockItemModal, type StockItemFull, type StockSupplierLink } from '@/components/StockItemModal';

interface Movement {
  id: string; type: string; qty: number; enteredQty: number | null; enteredUnit: string | null; unitCost: number | null;
  requestedByName: string | null; note: string | null; createdAt: string;
  stockItem: { id: string; name: string; unit: string };
  worksite: { id: string; ref: string; title: string } | null;
  contact: { id: string; name: string } | null;
  createdBy: { email: string } | null;
}
interface Meta {
  worksites: { id: string; name: string }[];
  categories: string[];
}

const TYPE_LABEL: Record<string, string> = { in: 'Entrée', out: 'Sortie', adjustment: 'Inventaire' };
const TYPE_TONE: Record<string, string> = { in: 'ok', out: 'warn', adjustment: 'plain' };

const fmtQty = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);
const factorOf = (it: StockItemFull, unit: string | null) => (!unit || unit.toLowerCase() === it.unit.toLowerCase() ? 1 : it.units.find((u) => u.name.toLowerCase() === unit.toLowerCase())?.factor ?? 1);

export default function StockDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const canMove = canManage || user?.role === 'foreman';
  const { data, loading, reload } = useApi<{ item: StockItemFull }>(`/api/stock/items/${id}`);
  const { data: meta } = useApi<Meta>('/api/stock/meta');
  const item = data?.item ?? null;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const { data: moves, reload: reloadMoves } = useApi<{ items: Movement[]; page: number; totalPages: number }>(
    `/api/stock/movements?stockItemId=${id}&page=${page}&pageSize=${pageSize}`,
  );
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [supplierModal, setSupplierModal] = useState<'new' | StockSupplierLink | null>(null);
  const [bcUnit, setBcUnit] = useState('');
  const [bcMsg, setBcMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading && !data) return <SkeletonRows />;
  if (!item) {
    return (
      <EmptyState
        icon={Warehouse}
        title="Article introuvable"
        text="Cet article n’existe plus ou a été désactivé. Retournez au stock."
        action={<Link href="/app/stock" className="btn primary">Retour au stock</Link>}
      />
    );
  }

  const bigUnit = item.units.length ? [...item.units].sort((a, b) => b.factor - a.factor)[0]! : null;
  const inBig = bigUnit && bigUnit.factor > 1 ? ` (≈ ${fmtQty(item.qty / bigUnit.factor)} ${bigUnit.name})` : '';

  async function addBarcode(code: string) {
    setBcMsg(null);
    try {
      await api(`/api/stock/items/${id}/barcodes`, { method: 'POST', body: { code, unitName: bcUnit || null } });
      setBcMsg({ ok: true, text: `Code ${code} enregistré${bcUnit ? ` pour 1 ${bcUnit}` : ''}.` });
      reload();
    } catch (e) {
      setBcMsg({ ok: false, text: (e as Error).message });
    }
  }
  async function removeBarcode(bid: string) {
    await api(`/api/stock/items/${id}/barcodes/${bid}`, { method: 'DELETE' });
    reload();
  }
  async function removeSupplier(s: StockSupplierLink) {
    if (!confirm(`Retirer ${s.contact.name} de cet article ?`)) return;
    await api(`/api/stock/items/${id}/suppliers/${s.id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <>
      {moving && meta && (
        <MovementModal item={item} meta={meta} onClose={() => setMoving(false)} onDone={() => { setMoving(false); reload(); reloadMoves(); }} />
      )}
      {editing && <StockItemModal item={item} onClose={() => setEditing(false)} onSaved={() => reload()} />}
      {supplierModal && (
        <SupplierModal
          item={item}
          link={supplierModal === 'new' ? null : supplierModal}
          onClose={() => setSupplierModal(null)}
          onDone={() => { setSupplierModal(null); reload(); }}
        />
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/stock" className="btn ghost">← Stock</Link>
        {canManage && <button className="btn" onClick={() => setEditing(true)}>Modifier l’article</button>}
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: '1.2rem', flexWrap: 'wrap' }}>
      {(item.photoUrl || canManage) && (
        <div style={{ width: 240, flexShrink: 0 }}>
          <PhotoHeader basePath={`/api/stock/items/${item.id}`} photoUrl={item.photoUrl} alt={item.name} editable={canManage} onChange={reload} />
        </div>
      )}
      <div className="detail-hero" style={{ flex: 1, minWidth: 280 }}>
        <div className="eyebrow">{[item.ref, [item.brand, item.model].filter(Boolean).join(' '), item.category].filter(Boolean).join(' · ') || 'Stock de matériaux'}</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap', gap: '1rem' }}>
          <h1>{item.name}</h1>
          <span className={`badge ${item.low ? 'crit' : 'ok'}`}>{item.low ? 'À réapprovisionner' : 'Disponible'}</span>
        </div>
        <div className="sub">{fmtQty(item.qty)} {item.unit} en stock{inBig}</div>
      </div>
      </div>

      <div className="kpis" style={{ margin: '1.4rem 0' }}>
        <Kpi ic={Package} label="Quantité en stock" value={`${fmtQty(item.qty)} ${item.unit}`} sub={bigUnit && bigUnit.factor > 1 ? `≈ ${fmtQty(item.qty / bigUnit.factor)} ${bigUnit.name}` : (item.category ?? 'Article suivi')} hero />
        <Kpi ic={Layers} label="Valeur" value={<Money value={item.value} />} sub={item.avgCost != null ? `Coût moyen ${formatEur(item.avgCost)} / ${item.unit}` : 'Coût moyen non défini'} />
        <Kpi
          ic={AlertTriangle}
          label="Seuil d’alerte"
          value={item.minQty != null ? `${fmtQty(item.minQty)} ${item.unit}` : '—'}
          sub={item.low ? 'Sous le seuil' : 'Au-dessus du seuil'}
          warn={item.low}
        />
      </div>

      {canMove && (
        <div className="row" style={{ marginBottom: '1.6rem' }}>
          <button className="btn primary" onClick={() => setMoving(true)}>+ Mouvement</button>
        </div>
      )}

      <div className="section-title">
        Unités
        <span className="hint">unité de stock : {item.unit}</span>
      </div>
      <div className="card card-pad" style={{ marginBottom: '1.6rem' }}>
        {item.units.length === 0 ? (
          <span className="muted">Aucune autre unité. Ajoutez-en (sac, pcs, palette…) via « Modifier l’article » pour saisir vos achats et mouvements dans ces unités.</span>
        ) : (
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="badge plain">1 {item.unit} (base)</span>
            {item.units.map((u) => <span key={u.name} className="badge plain">1 {u.name} = {fmtQty(u.factor)} {item.unit}</span>)}
          </div>
        )}
      </div>

      <div className="section-title">
        Codes-barres & étiquettes
        <a className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} href={`/imprimer/etiquettes?ids=${item.id}`} target="_blank" rel="noreferrer">Imprimer les étiquettes</a>
      </div>
      <div className="card card-pad" style={{ marginBottom: '1.6rem' }}>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.86rem' }}>
          Scannez le code-barres du sac (ou de la boîte) une fois : ensuite, scanner ce sac fait entrer/sortir 1 sac. Sans code-barres d’origine, imprimez une étiquette interne ({item.ref}).
        </p>
        {item.barcodes.length > 0 && (
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
            {item.barcodes.map((b) => (
              <span key={b.id} className="badge plain">
                <span className="mono">{b.code}</span> · 1 {b.unitName ?? item.unit}
                {canManage && <button type="button" className="btn ghost" style={{ ...mini, marginLeft: 4 }} onClick={() => removeBarcode(b.id)} aria-label="Retirer le code">✕</button>}
              </span>
            ))}
          </div>
        )}
        {canManage && (
          <>
            <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
              <label htmlFor="bc-unit" className="muted" style={{ fontSize: '0.85rem' }}>Le code scanné correspond à 1</label>
              <select id="bc-unit" className="select" style={{ width: 'auto' }} value={bcUnit} onChange={(e) => setBcUnit(e.target.value)}>
                <option value="">{item.unit} (base)</option>
                {item.units.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <ScanInput placeholder="Scannez le code-barres du sac…" onScan={addBarcode} cameraMulti={false} />
            {bcMsg && <div className={`badge ${bcMsg.ok ? 'ok' : 'crit'}`} style={{ padding: '0.35rem 0.7rem' }}>{bcMsg.text}</div>}
          </>
        )}
      </div>

      <div className="section-title">
        Fournisseurs <span className="hint">{item.suppliers.length}</span>
        {canManage && <button className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} onClick={() => setSupplierModal('new')}>+ Ajouter</button>}
      </div>
      {item.suppliers.length === 0 ? (
        <div className="card card-pad muted" style={{ marginBottom: '1.6rem' }}>Aucun fournisseur. Ajoutez ceux chez qui vous achetez cet article, avec leur référence et leur prix.</div>
      ) : (
        <div className="tbl-wrap" style={{ marginBottom: '1.6rem' }}>
          <table className="tbl">
            <thead>
              <tr><th>Fournisseur</th><th>Réf. fournisseur</th><th>Conditionnement</th><th style={{ textAlign: 'right' }}>Prix HT</th><th style={{ textAlign: 'right' }}>Par {item.unit}</th><th /></tr>
            </thead>
            <tbody>
              {item.suppliers.map((s) => {
                const f = factorOf(item, s.unitName);
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/app/contacts/${s.contact.id}`}>{s.contact.name}</Link>
                      {s.preferred && <span className="badge ok" style={{ marginLeft: 6 }}>préféré</span>}
                    </td>
                    <td className="mono">{s.supplierRef ?? '—'}</td>
                    <td>{s.unitName ?? item.unit}{f !== 1 ? ` (${fmtQty(f)} ${item.unit})` : ''}</td>
                    <td style={{ textAlign: 'right' }}>{s.price != null ? `${formatEur(s.price)} / ${s.unitName ?? item.unit}` : '—'}</td>
                    <td style={{ textAlign: 'right' }} className="tnum">{s.price != null ? formatEur(s.price / f) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canManage && (
                        <>
                          <button className="btn ghost" style={mini} onClick={() => setSupplierModal(s)}>Modifier</button>
                          <button className="btn ghost" style={mini} onClick={() => removeSupplier(s)}>✕</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">Historique des mouvements</div>
      {!moves && <SkeletonRows />}
      {moves && moves.items.length === 0 && <div className="empty">Aucun mouvement.</div>}
      {moves && moves.items.length > 0 && (
        <div className="tbl-wrap" style={{ marginBottom: '1rem' }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Qté</th><th>Fournisseur / Chantier</th><th>Note</th></tr></thead>
            <tbody>
              {moves.items.map((m) => (
                <tr key={m.id}>
                  <td className="tnum">{formatDateBE(m.createdAt)}</td>
                  <td><span className={`badge ${TYPE_TONE[m.type] ?? ''}`}>{TYPE_LABEL[m.type] ?? m.type}</span></td>
                  <td style={{ textAlign: 'right' }} className="tnum">
                    {m.qty > 0 && m.type !== 'adjustment' ? '+' : ''}{fmtQty(m.qty)} {item.unit}
                    {m.enteredUnit && m.enteredQty != null && <div className="muted" style={{ fontSize: '0.75rem' }}>saisi : {fmtQty(m.enteredQty)} {m.enteredUnit}</div>}
                  </td>
                  <td>{m.worksite ? `${m.worksite.ref} · ${m.worksite.title}` : m.contact ? m.contact.name : '—'}</td>
                  <td className="muted" style={{ fontSize: '0.82rem' }}>{[m.requestedByName, m.note].filter(Boolean).join(' — ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {moves && <PaginationBar page={moves.page} totalPages={moves.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} sizes={[30, 100, 200, PAGE_SIZE_ALL]} />}
    </>
  );
}

const mini: React.CSSProperties = { padding: '0.15rem 0.45rem', fontSize: '0.75rem', minWidth: 0 };

/* ------------------------------------------------------------- modale fournisseur */

function SupplierModal({ item, link, onClose, onDone }: { item: StockItemFull; link: StockSupplierLink | null; onClose: () => void; onDone: () => void }) {
  const [contactId, setContactId] = useState(link?.contactId ?? '');
  const [supplierRef, setSupplierRef] = useState(link?.supplierRef ?? '');
  const [unitName, setUnitName] = useState(link?.unitName ?? '');
  const [price, setPrice] = useState(link?.price != null ? String(link.price) : '');
  const [preferred, setPreferred] = useState(link?.preferred ?? item.suppliers.length === 0);
  const [note, setNote] = useState(link?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId) { setErr('Choisissez un fournisseur'); return; }
    setBusy(true);
    setErr(null);
    try {
      const body = { contactId, supplierRef: supplierRef || null, unitName: unitName || null, price: price === '' ? null : Number(price), preferred, note: note || null };
      await api(link ? `/api/stock/items/${item.id}/suppliers/${link.id}` : `/api/stock/items/${item.id}/suppliers`, { method: link ? 'PATCH' : 'POST', body });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  const f = factorOf(item, unitName || null);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{link ? 'Modifier le fournisseur' : 'Ajouter un fournisseur'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Fournisseur *</label>
            <ContactPicker typeFilter="supplier" value={contactId} onChange={(cid) => setContactId(cid)} />
          </div>
          <div className="field">
            <label htmlFor="sp-ref">Référence chez le fournisseur</label>
            <input id="sp-ref" className="input" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sp-unit">Conditionnement d’achat</label>
            <select id="sp-unit" className="select" value={unitName} onChange={(e) => setUnitName(e.target.value)}>
              <option value="">{item.unit} (base)</option>
              {item.units.map((u) => <option key={u.name} value={u.name}>{u.name} ({u.factor} {item.unit})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sp-price">Prix HT par {unitName || item.unit} (€)</label>
            <input id="sp-price" className="input" type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            {price !== '' && f !== 1 && <span className="muted" style={{ fontSize: '0.78rem' }}>≈ {formatEur(Number(price) / f)} / {item.unit}</span>}
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400 }}>
              <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)} /> Fournisseur préféré
            </label>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="sp-note">Note</label>
            <textarea id="sp-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- modale mouvement */

function MovementModal({
  item, meta, onClose, onDone,
}: {
  item: StockItemFull; meta: Meta; onClose: () => void; onDone: () => void;
}) {
  const [type, setType] = useState<'in' | 'out' | 'adjustment'>('in');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [contactId, setContactId] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [requestedByName, setRequestedByName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const f = factorOf(item, unit || null);
  const unitLabel = unit || item.unit;
  const converted = Number(qty) && f !== 1 ? Number(qty) * f : null;

  function pickSupplier(s: StockSupplierLink) {
    setContactId(s.contactId);
    setUnit(s.unitName ?? '');
    if (s.price != null) setUnitCost(String(s.price));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/stock/movements', {
        method: 'POST',
        body: {
          stockItemId: item.id,
          type,
          qty: Number(qty || 0),
          unit: unit || null,
          unitCost: type === 'in' && unitCost !== '' ? Number(unitCost) : null,
          contactId: type === 'in' ? contactId || null : null,
          worksiteId: type === 'out' ? worksiteId || null : null,
          requestedByName: type === 'out' ? requestedByName || null : null,
          note: note || null,
        },
      });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{item.name}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="muted" style={{ marginBottom: '0.8rem' }}>Stock actuel : <strong>{fmtQty(item.qty)} {item.unit}</strong></div>
            <div className="seg">
              <button type="button" className={type === 'in' ? 'on' : ''} onClick={() => setType('in')}>Entrée</button>
              <button type="button" className={type === 'out' ? 'on' : ''} onClick={() => setType('out')}>Sortie</button>
              <button type="button" className={type === 'adjustment' ? 'on' : ''} onClick={() => setType('adjustment')}>Inventaire</button>
            </div>
          </div>

          {type === 'in' && item.suppliers.length > 0 && (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Acheté chez (fournisseurs de l’article)</label>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                {item.suppliers.map((s) => (
                  <button key={s.id} type="button" className={`btn${contactId === s.contactId && (s.unitName ?? '') === unit ? ' primary' : ''}`} onClick={() => pickSupplier(s)}>
                    {s.contact.name}{s.price != null ? ` · ${formatEur(s.price)}/${s.unitName ?? item.unit}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="mv-qty">{type === 'adjustment' ? 'Quantité réelle comptée *' : 'Quantité *'}</label>
            <input id="mv-qty" className="input" type="number" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mv-unit">Unité</label>
            <select id="mv-unit" className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{item.unit} (base)</option>
              {item.units.map((u) => <option key={u.name} value={u.name}>{u.name} ({u.factor} {item.unit})</option>)}
            </select>
          </div>
          {converted != null && (
            <div className="muted" style={{ gridColumn: '1 / -1', marginTop: '-0.4rem' }}>= {fmtQty(converted)} {item.unit} en stock</div>
          )}

          {type === 'in' && (
            <>
              <div className="field">
                <label htmlFor="mv-cost">Prix d’achat HT par {unitLabel} (€)</label>
                <input id="mv-cost" className="input" type="number" step="any" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                {unitCost !== '' && f !== 1 && <span className="muted" style={{ fontSize: '0.78rem' }}>≈ {formatEur(Number(unitCost) / f)} / {item.unit}</span>}
              </div>
              <div className="field">
                <label>Fournisseur</label>
                <ContactPicker typeFilter="supplier" value={contactId} onChange={(cid) => setContactId(cid)} />
              </div>
            </>
          )}

          {type === 'out' && (
            <>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Chantier *</label>
                <ComboBox placeholder="chercher un chantier" value={worksiteId} onChange={setWorksiteId} options={meta.worksites.map((w) => ({ value: w.id, label: w.name }))} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Demandeur</label>
                <input className="input" value={requestedByName} onChange={(e) => setRequestedByName(e.target.value)} placeholder="qui prend la sortie" />
              </div>
            </>
          )}

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Note</label>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || !qty || (type === 'out' && !worksiteId)}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}
