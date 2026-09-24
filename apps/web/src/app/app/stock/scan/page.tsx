'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, ApiError } from '@/lib/api';
import { PageHead, Thumb } from '@/lib/ui';
import { ArrowDownToLine, ArrowUpFromLine, Undo2, MapPin } from 'lucide-react';
import { ComboBox } from '@/components/ComboBox';
import { ScanInput } from '@/components/ScanInput';
import { scanFeedback } from '@/lib/scanFeedback';
import type { StockItemFull } from '@/components/StockItemModal';

type StockItem = StockItemFull;
interface Meta {
  worksites: { id: string; name: string }[];
  categories: string[];
}
interface MaterielUnit { assetTag: string; state: string; storageLocation: string | null; chantier: { name: string } | null }
interface MaterielProduct { id: string; name: string; brand: string | null; model: string | null; image: string | null; total: number; available: number; onSite: number; units: MaterielUnit[] }
interface Consumable { id: string; name: string; stockQty: number | null; shortDescription: string | null }

const ACTION_LABEL: Record<'in' | 'out' | 'return', string> = { in: 'l’entrée', out: 'la sortie', return: 'le retour' };
const ACTION_BADGE: Record<'in' | 'out' | 'return', string> = { in: 'Entrée', out: 'Sortie', return: 'Retour' };
const ACTION_DESC: Record<'in' | 'out' | 'return', string> = {
  in: 'Ajouter une livraison au stock', out: 'Préparer le départ vers un chantier', return: 'Remettre les articles au dépôt',
};
const MATERIEL_STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'au dépôt', ON_SITE: 'sur chantier', RENTED: 'loué', MAINTENANCE: 'en entretien', DAMAGED: 'endommagé', RETIRED: 'réformé',
};
type CatalogType = 'materiaux' | 'machines' | 'consommables';

type CartLine =
  | { kind: 'stock'; key: string; id: string; name: string; unit: string; unitName: string | null; units: { name: string; factor: number }[]; qty: number; image?: string | null; location?: string | null }
  | { kind: 'materiel'; key: string; assetTag: string; name: string; sub: string; image?: string | null; location?: string | null }
  | { kind: 'consommable'; key: string; productId: string; name: string; qty: number };

export default function StockScanPage() {
  const { data, reload } = useApi<{ items: StockItem[] }>('/api/stock/items');
  const { data: meta } = useApi<Meta>('/api/stock/meta');
  const items = data?.items ?? [];

  return (
    <>
      <PageHead
        eyebrow="Ressources"
        title="Scan & mouvements"
        sub="Choisissez l’action, le chantier, puis les articles"
        action={<Link href="/app/stock" className="btn">← Stock</Link>}
      />
      {meta && <ScanPanel items={items} meta={meta} onDone={reload} />}
    </>
  );
}

function ScanPanel({
  items, meta, onDone,
}: {
  items: StockItem[]; meta: Meta; onDone: () => void;
}) {
  const [action, setAction] = useState<'in' | 'out' | 'return'>('out');
  const [catalogType, setCatalogType] = useState<CatalogType>('materiaux');
  const [worksiteId, setWorksiteId] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  // Rack actif : on scanne son étiquette (ou on le tape), les articles scannés ensuite y sont rangés — comme l'inventaire Bricoloc.
  const [rack, setRack] = useState<string | null>(null);
  const rackRef = useRef<string | null>(null);
  const [rackTyped, setRackTyped] = useState('');
  // Après un scan : fenêtre « quelle quantité ? » puis « Ajouter au panier » (désactivable : +1 par scan).
  const [askQty, setAskQty] = useState(true);
  useEffect(() => { try { if (localStorage.getItem('jjd_scan_ask') === '0') setAskQty(false); } catch { /* ignore */ } }, []);
  function toggleAsk(v: boolean) { setAskQty(v); try { localStorage.setItem('jjd_scan_ask', v ? '1' : '0'); } catch { /* ignore */ } }
  const [pending, setPending] = useState<{ item: StockItem; unitName: string | null } | null>(null);
  const { data: racksData } = useApi<{ items: { code: string }[] }>('/api/stock/locations');
  const [query, setQuery] = useState('');
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Le parc d'outillage (Matériel/Bricoloc) partage le même panier pour la sortie et le
  // retour — on prépare souvent un départ chantier avec du stock ET des outils ensemble.
  // Pas de « Réceptionner » côté outils/consommables : ça se gère par le fournisseur.
  const { data: materielStatus } = useApi<{ enabled: boolean }>('/api/materiel/status');
  const { data: materielStock } = useApi<{ products: MaterielProduct[] }>(materielStatus?.enabled ? '/api/materiel/stock' : null);
  const { data: materielCons } = useApi<{ consumables: Consumable[] }>(materielStatus?.enabled ? '/api/materiel/consumables' : null);
  const materielProducts = materielStock?.products ?? [];
  const consumables = materielCons?.consumables ?? [];
  const machinesEnabled = !!materielStatus?.enabled && action !== 'in';
  const consommablesEnabled = !!materielStatus?.enabled && action === 'out';
  const knownLocations = (() => {
    const set = new Set<string>();
    for (const p of materielProducts) for (const u of p.units) if (u.storageLocation) set.add(u.storageLocation);
    return [...set].sort().slice(0, 8);
  })();

  const q = query.trim().toLowerCase();
  const stockCatalog = catalogType === 'materiaux'
    ? items.filter((it) => !q || `${it.name} ${it.ref ?? ''} ${it.brand ?? ''} ${it.model ?? ''} ${it.category ?? ''}`.toLowerCase().includes(q))
    : [];
  const materielCatalog = catalogType === 'machines' && machinesEnabled
    ? materielProducts
      .filter((p) => (action === 'out' ? p.available > 0 : p.onSite > 0))
      .filter((p) => !q || `${p.name} ${p.brand ?? ''} ${p.model ?? ''}`.toLowerCase().includes(q))
    : [];
  const consommableCatalog = catalogType === 'consommables' && consommablesEnabled
    ? consumables.filter((c) => !q || `${c.name} ${c.shortDescription ?? ''}`.toLowerCase().includes(q))
    : [];

  function alreadyInCart(assetTag: string) {
    return cart.some((l) => l.kind === 'materiel' && l.assetTag === assetTag);
  }

  // Un clic sur une carte de stock/consommable ajoute 1 exemplaire — un 2e clic augmente la
  // quantité, comme un 2e scan (cf. panier de la maquette). Un outil est un exemplaire
  // physique précis (étiqueté) : chaque clic ajoute un exemplaire disponible différent.
  function addStock(it: StockItem, unitName: string | null = null, addQty = 1) {
    const key = `stock:${it.id}:${unitName ?? ''}`;
    setCart((cur) => {
      const existing = cur.find((l) => l.key === key);
      if (existing && existing.kind === 'stock') return cur.map((l) => (l.key === key && l.kind === 'stock' ? { ...l, qty: l.qty + addQty } : l));
      return [{ kind: 'stock', key, id: it.id, name: it.name, unit: it.unit, unitName, units: it.units, qty: addQty, image: it.photoThumbUrl, location: action === 'out' ? null : rackRef.current }, ...cur];
    });
    setToast(null);
    setErr(null);
  }
  function setLineUnit(key: string, unitName: string | null) {
    setCart((cur) => cur.map((l) => (l.key === key && l.kind === 'stock' ? { ...l, unitName } : l)));
  }
  function addConsommable(c: Consumable) {
    const key = `consommable:${c.id}`;
    setCart((cur) => {
      const existing = cur.find((l) => l.key === key);
      if (existing && existing.kind === 'consommable') return cur.map((l) => (l.key === key && l.kind === 'consommable' ? { ...l, qty: l.qty + 1 } : l));
      return [{ kind: 'consommable', key, productId: c.id, name: c.name, qty: 1 }, ...cur];
    });
    setToast(null);
    setErr(null);
  }
  function addMateriel(p: MaterielProduct) {
    const wanted = action === 'out' ? 'AVAILABLE' : 'ON_SITE';
    const unit = p.units.find((u) => u.state === wanted && !alreadyInCart(u.assetTag));
    if (!unit) { setErr(`Plus aucun exemplaire ${action === 'out' ? 'disponible' : 'sur chantier'} pour ${p.name}.`); return; }
    addMaterielUnit(unit.assetTag, p.name, [p.brand, p.model].filter(Boolean).join(' ') || unit.assetTag, p.image);
  }
  function addMaterielUnit(assetTag: string, name: string, sub: string, image?: string | null) {
    setCart((cur) => [{ kind: 'materiel', key: `materiel:${assetTag}`, assetTag, name, sub, image, location: action === 'return' ? rackRef.current : null }, ...cur]);
    setToast(null);
    setErr(null);
  }
  function setQty(key: string, qty: number) {
    if (!Number.isFinite(qty) || qty < 1) return;
    setCart((cur) => cur.map((l) => (l.key === key && l.kind !== 'materiel' ? { ...l, qty } : l)));
  }
  function removeLine(key: string) {
    setCart((cur) => cur.filter((l) => l.key !== key));
  }

  // Un scan (gâchette Zebra, caméra ou saisie) : d'abord un article de stock (code-barres du sac ou
  // étiquette ART-…), sinon l'étiquette d'un outil du parc (Bricoloc).
  function pickRack(codeRaw: string) {
    const code = codeRaw.trim().toUpperCase().replace(/^(BRZ|RACK)-/, '').trim();
    if (!code) return;
    if (action === 'out') { setErr('Le rack sert aux entrées et aux retours, pas aux sorties.'); scanFeedback(false); return; }
    rackRef.current = code;
    setRack(code);
    // les articles déjà scannés sans rack y sont rangés (on peut scanner l'article puis son rack, ou l'inverse)
    setCart((cur) => cur.map((l) => ((l.kind === 'stock' || l.kind === 'materiel') && !l.location ? { ...l, location: code } : l)));
    setLastScan(`Rack ${code}`);
    scanFeedback(true);
  }
  function clearRack() { rackRef.current = null; setRack(null); setRackTyped(''); }

  async function handleScan(codeRaw: string) {
    const code = codeRaw.trim();
    if (!code) return;
    setErr(null);
    if (/^(BRZ|RACK)-.+/i.test(code)) { pickRack(code); return; }
    try {
      const r = await api<{ item: StockItem; unitName: string | null }>(`/api/stock/scan/${encodeURIComponent(code)}`);
      scanFeedback(true);
      if (askQty) { setPending({ item: r.item, unitName: r.unitName }); return; }
      addStock(r.item, r.unitName);
      setLastScan(`${r.item.name}${r.unitName ? ` · 1 ${r.unitName}` : ''}`);
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) { setErr(e instanceof ApiError ? e.message : 'Erreur de scan'); scanFeedback(false); return; }
    }
    if (materielStatus?.enabled && action !== 'in') {
      try {
        const info = await api<{ unit: { assetTag: string; state: string }; product: { id: string; name: string } }>(
          `/api/materiel/units/${encodeURIComponent(code)}`,
        );
        const wanted = action === 'out' ? 'AVAILABLE' : 'ON_SITE';
        if (info.unit.state !== wanted) {
          setErr(`${info.product.name} (${info.unit.assetTag}) est actuellement ${MATERIEL_STATE_LABEL[info.unit.state] ?? info.unit.state}, pas ${action === 'out' ? 'disponible' : 'sur chantier'}.`);
          scanFeedback(false);
        } else if (alreadyInCart(info.unit.assetTag)) {
          setErr('Cet exemplaire est déjà dans le panier.');
          scanFeedback(false);
        } else {
          addMaterielUnit(info.unit.assetTag, info.product.name, info.unit.assetTag);
          setLastScan(info.product.name);
          scanFeedback(true);
        }
        return;
      } catch { /* code inconnu aussi côté outils */ }
    }
    setErr(`Code « ${code} » inconnu. Article non enregistré : ajoutez ce code-barres sur sa fiche.`);
    scanFeedback(false);
  }

  const needsLocation = action === 'return' && cart.some((l) => l.kind === 'materiel' && !l.location);

  async function submit() {
    if (cart.length === 0) return;
    if (action !== 'in' && !worksiteId) { setErr('Chantier requis.'); return; }
    if (needsLocation && !storageLocation.trim()) { setErr('Emplacement de rangement requis pour le retour d’outils.'); return; }
    setBusy(true);
    setErr(null);
    setToast(null);
    let done = 0;
    try {
      for (const line of cart) {
        if (line.kind === 'stock') {
          await api('/api/stock/movements', {
            method: 'POST',
            body: {
              stockItemId: line.id,
              type: action === 'return' ? 'in' : action,
              qty: line.qty,
              unit: line.unitName,
              worksiteId: action !== 'in' ? worksiteId : null,
              note: action === 'return' ? 'Retour dépôt' : null,
              location: action !== 'out' ? line.location ?? rackRef.current : null,
            },
          });
        } else if (line.kind === 'consommable') {
          await api('/api/materiel/consumption', { method: 'POST', body: { productId: line.productId, quantity: line.qty, worksiteId } });
        } else if (action === 'out') {
          await api('/api/materiel/loans', { method: 'POST', body: { code: line.assetTag, worksiteId } });
        } else if (action === 'return') {
          await api('/api/materiel/returns', { method: 'POST', body: { code: line.assetTag, storageLocation: line.location || storageLocation.trim() } });
        }
        done++;
      }
      setCart([]);
      setStorageLocation('');
      clearRack();
      setToast(`${done} mouvement${done > 1 ? 's' : ''} enregistré${done > 1 ? 's' : ''}.`);
      onDone();
    } catch (e) {
      setErr((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const catalog = catalogType === 'materiaux' ? stockCatalog : catalogType === 'machines' ? materielCatalog : consommableCatalog;
  const emptyReason = catalogType === 'machines' && !machinesEnabled
    ? 'Pas de réception d’outils via cet écran — ça passe par le fournisseur.'
    : catalogType === 'consommables' && !consommablesEnabled
    ? (action === 'in' ? 'Pas de réception de consommables via cet écran — ça passe par le fournisseur.' : 'Les consommables ne se retournent pas.')
    : catalog.length === 0 ? 'Aucun article.' : null;

  return (
    <div>
      <ScanInput
        placeholder={`Scannez un article pour ${action === 'in' ? 'le réceptionner' : action === 'out' ? 'le sortir' : 'le retourner'}…`}
        hint="Gâchette du terminal, caméra du smartphone, ou saisie du code. Un 2ᵉ scan du même article ajoute 1. En entrée : scannez aussi l’étiquette du rack."
        onScan={handleScan}
      />
      <label className="scan-ask">
        <input type="checkbox" checked={askQty} onChange={(e) => toggleAsk(e.target.checked)} /> Demander la quantité à chaque scan <span className="muted">(sinon +1 par scan)</span>
      </label>
      {lastScan && <div className="scan-last">✓ {lastScan}</div>}
      {pending && (
        <QtyDialog
          item={pending.item}
          initialUnit={pending.unitName}
          action={action}
          rack={rack}
          onCancel={() => setPending(null)}
          onConfirm={(qty, unitName) => {
            addStock(pending.item, unitName, qty);
            setLastScan(`${pending.item.name} · ${qty} ${unitName ?? pending.item.unit}`);
            setPending(null);
          }}
        />
      )}
      <div className="stock-move-actions">
        <button type="button" className={action === 'in' ? 'on' : ''} onClick={() => setAction('in')}>
          <ArrowDownToLine className="ic" size={24} strokeWidth={1.75} />
          <strong>Réceptionner</strong>
          <small>{ACTION_DESC.in}</small>
        </button>
        <button type="button" className={action === 'out' ? 'on' : ''} onClick={() => setAction('out')}>
          <ArrowUpFromLine className="ic" size={24} strokeWidth={1.75} />
          <strong>Sortir / affecter</strong>
          <small>{ACTION_DESC.out}</small>
        </button>
        <button type="button" className={action === 'return' ? 'on' : ''} onClick={() => setAction('return')}>
          <Undo2 className="ic" size={24} strokeWidth={1.75} />
          <strong>Retourner</strong>
          <small>{ACTION_DESC.return}</small>
        </button>
      </div>

      {action !== 'in' && (
        <div className="field" style={{ maxWidth: 360, marginBottom: '0.9rem' }}>
          <label>Chantier *</label>
          <ComboBox placeholder="chercher un chantier" value={worksiteId} onChange={setWorksiteId} options={meta.worksites.map((w) => ({ value: w.id, label: w.name }))} />
        </div>
      )}
      {action !== 'out' && (
        <div className={`rack-bar${rack ? ' on' : ''}`}>
          <MapPin size={20} strokeWidth={2} />
          <div className="rack-bar-txt">
            {rack ? <><strong>Rack {rack}</strong><span> — les articles scannés y sont rangés</span></> : <span>Scannez l’étiquette du <strong>rack</strong> où vous rangez <span className="muted">(facultatif)</span></span>}
          </div>
          <input
            className="input rack-bar-input"
            list="rack-list"
            placeholder="ou tapez : R-01-A"
            value={rackTyped}
            onChange={(e) => setRackTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickRack(rackTyped); setRackTyped(''); } }}
            aria-label="Rack"
          />
          <datalist id="rack-list">{(racksData?.items ?? []).map((r) => <option key={r.code} value={r.code} />)}</datalist>
          {rack && <button type="button" className="btn ghost" onClick={clearRack} aria-label="Retirer le rack">✕</button>}
        </div>
      )}
      {needsLocation && (
        <div style={{ display: 'grid', gap: 10, padding: '0.7rem', background: 'var(--surface-2)', borderRadius: 10, marginBottom: '0.9rem', maxWidth: 420 }}>
          <div style={{ fontWeight: 650, fontSize: '0.85rem' }}>Les outils retournés → dans quelle zone du dépôt ?</div>
          {knownLocations.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {knownLocations.map((loc) => (
                <button key={loc} type="button" className="badge primary" style={{ cursor: 'pointer' }} onClick={() => setStorageLocation(loc)}>{loc}</button>
              ))}
            </div>
          )}
          <input className="input" placeholder="ex. Étagère A3" value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} />
        </div>
      )}

      <div className="stock-scan-layout" style={{ gridTemplateColumns: 'minmax(0, 860px)' }}>
        <div className="stock-basket">
          <div className="stock-basket-head">
            <div>
              <div className="eyebrow">À valider</div>
              <h2>{cart.length} article{cart.length > 1 ? 's' : ''}</h2>
            </div>
            <span className="pill">{ACTION_BADGE[action]}</span>
          </div>
          <div className="stock-basket-lines">
            {cart.length === 0 ? (
              <p className="stock-basket-empty">Scannez un article pour l’ajouter.</p>
            ) : cart.map((line) => (
              <div key={line.key} className="stock-basket-line">
                {(line.kind === 'materiel' || line.kind === 'stock') && line.image ? <Thumb src={line.image} size={40} /> : (
                  <span className="icon">{line.kind === 'materiel' ? '🔧' : line.kind === 'consommable' ? '🧰' : '▥'}</span>
                )}
                <span className="info">
                  <span className="name">{line.name}</span>
                  <span className="sub">
                    {line.kind === 'stock' ? (
                      line.units.length > 0 ? (
                        <select className="select" style={{ padding: '0.1rem 0.4rem', fontSize: '0.78rem', width: 'auto' }} value={line.unitName ?? ''} onChange={(e) => setLineUnit(line.key, e.target.value || null)} aria-label="Unité">
                          <option value="">{line.unit}</option>
                          {line.units.map((u) => <option key={u.name} value={u.name}>{u.name} ({u.factor} {line.unit})</option>)}
                        </select>
                      ) : line.unit
                    ) : line.kind === 'materiel' ? line.sub : ''}
                    {(line.kind === 'stock' || line.kind === 'materiel') && line.location && <span className="badge" style={{ marginLeft: 6, fontSize: '0.7rem' }}>📍 {line.location}</span>}
                  </span>
                  {line.kind === 'materiel' ? (
                    <span className="stock-qty-stepper">
                      <button type="button" className="remove" onClick={() => removeLine(line.key)}>Retirer</button>
                    </span>
                  ) : (
                    <span className="stock-qty-stepper">
                      <button type="button" onClick={() => setQty(line.key, line.qty - 1)} aria-label={`Diminuer la quantité de ${line.name}`}>−</button>
                      <input
                        type="number" min={1} step="any"
                        value={line.qty}
                        onChange={(e) => setQty(line.key, Number(e.target.value))}
                        aria-label={`Quantité de ${line.name}`}
                      />
                      <button type="button" onClick={() => setQty(line.key, line.qty + 1)} aria-label={`Augmenter la quantité de ${line.name}`}>＋</button>
                      <button type="button" className="remove" onClick={() => removeLine(line.key)}>Retirer</button>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="stock-basket-confirm">
            {err && <div className="badge crit" style={{ padding: '0.4rem 0.7rem', marginBottom: '0.7rem' }}>{err}</div>}
            {toast && <div className="badge ok" style={{ padding: '0.4rem 0.7rem', marginBottom: '0.7rem' }}>{toast}</div>}
            <button type="button" className="btn primary" disabled={busy || cart.length === 0 || (action !== 'in' && !worksiteId) || (needsLocation && !storageLocation.trim())} onClick={submit}>
              {busy ? 'Enregistrement…' : `Confirmer ${ACTION_LABEL[action]} · ${cart.length} article${cart.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>

      <details className="stock-manual">
        <summary>Ajouter sans scanner (choisir dans la liste)</summary>
        <div className="stock-catalog" style={{ marginTop: '0.8rem' }}>
          <div className="eyebrow">Quels articles ?</div>
          <div className="msg-filter-chips">
            <button className={catalogType === 'materiaux' ? 'on' : ''} onClick={() => setCatalogType('materiaux')}>Matériaux</button>
            <button className={catalogType === 'machines' ? 'on' : ''} onClick={() => setCatalogType('machines')}>Machines</button>
            <button className={catalogType === 'consommables' ? 'on' : ''} onClick={() => setCatalogType('consommables')}>Consommables</button>
          </div>
          <input className="input" placeholder="Nom, catégorie…" value={query} onChange={(e) => setQuery(e.target.value)} />

          <div className="stock-catalog-grid">
            {emptyReason && <p className="muted" style={{ fontSize: '0.85rem' }}>{emptyReason}</p>}

            {catalogType === 'materiaux' && stockCatalog.map((it) => (
              <button key={`stock-${it.id}`} type="button" className="stock-catalog-card" onClick={() => addStock(it)}>
                {it.photoThumbUrl ? <Thumb src={it.photoThumbUrl} size={40} /> : <span className="icon">▥</span>}
                <span className="info">
                  <span className="name">{it.name}</span>
                  <span className="sub">{it.qty} {it.unit} en stock{it.category ? ` · ${it.category}` : ''}</span>
                </span>
                <b className="plus">＋</b>
              </button>
            ))}

            {catalogType === 'machines' && materielCatalog.map((p) => (
              <button key={`materiel-${p.id}`} type="button" className="stock-catalog-card" onClick={() => addMateriel(p)}>
                {p.image ? <Thumb src={p.image} size={40} /> : <span className="icon">🔧</span>}
                <span className="info">
                  <span className="name">{p.name}</span>
                  <span className="sub">{action === 'out' ? `${p.available} disponible${p.available > 1 ? 's' : ''}` : `${p.onSite} sur chantier`}</span>
                </span>
                <b className="plus">＋</b>
              </button>
            ))}

            {catalogType === 'consommables' && consommableCatalog.map((c) => (
              <button key={`cons-${c.id}`} type="button" className="stock-catalog-card" onClick={() => addConsommable(c)}>
                <span className="icon">🧰</span>
                <span className="info">
                  <span className="name">{c.name}</span>
                  <span className="sub">{c.stockQty ?? '—'} en stock</span>
                </span>
                <b className="plus">＋</b>
              </button>
            ))}
          </div>
        </div>

      </details>
    </div>
  );
}

const fmtN = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);

/** Fenêtre ouverte par un scan : quantité (et conditionnement) à entrer / sortir, puis « Ajouter au panier ». Entrée = valider. */
function QtyDialog({ item, initialUnit, action, rack, onCancel, onConfirm }: {
  item: StockItem; initialUnit: string | null; action: 'in' | 'out' | 'return'; rack: string | null;
  onCancel: () => void; onConfirm: (qty: number, unitName: string | null) => void;
}) {
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<string>(initialUnit ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const openedAt = useRef(Date.now());
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const n = Number(qty.replace(',', '.'));
  const valid = Number.isFinite(n) && n > 0;
  const factor = !unit ? 1 : item.units.find((u) => u.name === unit)?.factor ?? 1;
  const short = action === 'out' && valid && n * factor > item.qty + 0.0001;
  const bump = (d: number) => setQty(String(Math.max(1, Math.round(((valid ? n : 0) + d) * 100) / 100)));
  const verb = action === 'in' ? 'entrer' : action === 'out' ? 'sortir' : 'retourner';

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <form
        className="modal"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
        // un « Entrée » tardif de la gâchette (fin du scan) ne doit pas valider la fenêtre à peine ouverte
        onSubmit={(e) => { e.preventDefault(); if (valid && Date.now() - openedAt.current > 400) onConfirm(n, unit || null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      >
        <div className="modal-head">
          <h2>{ACTION_BADGE[action]}</h2>
          <button type="button" className="btn ghost" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
          <div className="row" style={{ gap: '0.8rem', alignItems: 'center', flexWrap: 'nowrap' }}>
            {item.photoThumbUrl && <Thumb src={item.photoThumbUrl} size={64} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2 }}>{item.name}</div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>
                En stock : <strong>{fmtN(item.qty)} {item.unit}</strong>{item.location ? ` · 📍 ${item.location}` : ''}
              </div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="qd-qty">Quantité à {verb}</label>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap', alignItems: 'center' }}>
              <button type="button" className="btn" style={{ fontSize: '1.4rem', padding: '0.3rem 1rem' }} onClick={() => bump(-1)} aria-label="Moins">−</button>
              <input
                id="qd-qty" ref={ref} className="input" style={{ fontSize: '1.6rem', fontWeight: 800, textAlign: 'center', width: 110 }}
                inputMode="decimal" value={qty}
                onChange={(e) => { if (e.target.value.length <= 6) setQty(e.target.value); }}
              />
              <button type="button" className="btn" style={{ fontSize: '1.4rem', padding: '0.3rem 1rem' }} onClick={() => bump(1)} aria-label="Plus">＋</button>
              {item.units.length > 0 ? (
                <select className="select" style={{ fontSize: '1.05rem', flex: 1 }} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unité">
                  <option value="">{item.unit}</option>
                  {item.units.map((u) => <option key={u.name} value={u.name}>{u.name} ({fmtN(u.factor)} {item.unit})</option>)}
                </select>
              ) : <span className="muted">{item.unit}</span>}
            </div>
            {valid && factor !== 1 && <span className="muted" style={{ fontSize: '0.8rem' }}>= {fmtN(n * factor)} {item.unit}</span>}
          </div>
          {action !== 'out' && rack && <div className="badge ok" style={{ padding: '0.35rem 0.7rem' }}>📍 Rangé dans le rack {rack}</div>}
          {short && <div className="badge warn" style={{ padding: '0.35rem 0.7rem' }}>Attention : il n’y a que {fmtN(item.qty)} {item.unit} en stock.</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onCancel}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!valid}>Ajouter au panier</button>
        </div>
      </form>
    </div>
  );
}
