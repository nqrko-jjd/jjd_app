'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, ApiError } from '@/lib/api';
import { PageHead, Thumb } from '@/lib/ui';
import { ArrowDownToLine, ArrowUpFromLine, Undo2, ScanLine } from 'lucide-react';
import { ComboBox } from '@/components/ComboBox';

interface StockItem {
  id: string; name: string; unit: string; category: string | null;
  minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean;
}
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
  | { kind: 'stock'; key: string; id: string; name: string; unit: string; qty: number }
  | { kind: 'materiel'; key: string; assetTag: string; name: string; sub: string; image?: string | null }
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
  const [query, setQuery] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
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
    ? items.filter((it) => !q || `${it.name} ${it.category ?? ''}`.toLowerCase().includes(q))
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
  function addStock(it: StockItem) {
    const key = `stock:${it.id}`;
    setCart((cur) => {
      const existing = cur.find((l) => l.key === key);
      if (existing && existing.kind === 'stock') return cur.map((l) => (l.key === key && l.kind === 'stock' ? { ...l, qty: l.qty + 1 } : l));
      return [{ kind: 'stock', key, id: it.id, name: it.name, unit: it.unit, qty: 1 }, ...cur];
    });
    setToast(null);
    setErr(null);
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
    setCart((cur) => [{ kind: 'materiel', key: `materiel:${assetTag}`, assetTag, name, sub, image }, ...cur]);
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

  // Scanner (ou taper) l'étiquette d'un outil — le stock de matériaux et les consommables
  // n'ont pas d'étiquette par article (contrairement au parc Bricoloc), donc seuls les
  // outils peuvent être scannés ici.
  async function resolveScan() {
    const code = scanCode.trim();
    if (!code) return;
    setScanBusy(true);
    setErr(null);
    try {
      const info = await api<{ unit: { assetTag: string; state: string }; product: { id: string; name: string } }>(
        `/api/materiel/units/${encodeURIComponent(code)}`,
      );
      const wanted = action === 'out' ? 'AVAILABLE' : 'ON_SITE';
      if (info.unit.state !== wanted) {
        setErr(`${info.product.name} (${info.unit.assetTag}) est actuellement ${MATERIEL_STATE_LABEL[info.unit.state] ?? info.unit.state}, pas ${action === 'out' ? 'disponible' : 'sur chantier'}.`);
      } else if (alreadyInCart(info.unit.assetTag)) {
        setErr('Cet exemplaire est déjà dans le panier.');
      } else {
        addMaterielUnit(info.unit.assetTag, info.product.name, info.unit.assetTag);
      }
      setScanCode('');
      scanRef.current?.focus();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Article introuvable pour ce code.');
    } finally {
      setScanBusy(false);
    }
  }

  const materielLinesCount = cart.filter((l) => l.kind === 'materiel').length;
  const needsLocation = action === 'return' && materielLinesCount > 0;

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
              worksiteId: action !== 'in' ? worksiteId : null,
              note: action === 'return' ? 'Retour dépôt' : null,
            },
          });
        } else if (line.kind === 'consommable') {
          await api('/api/materiel/consumption', { method: 'POST', body: { productId: line.productId, quantity: line.qty, worksiteId } });
        } else if (action === 'out') {
          await api('/api/materiel/loans', { method: 'POST', body: { code: line.assetTag, worksiteId } });
        } else if (action === 'return') {
          await api('/api/materiel/returns', { method: 'POST', body: { code: line.assetTag, storageLocation: storageLocation.trim() } });
        }
        done++;
      }
      setCart([]);
      setStorageLocation('');
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

      <div className="stock-scan-layout">
        <div className="stock-catalog">
          <div className="eyebrow">Quels articles ?</div>
          <div className="msg-filter-chips">
            <button className={catalogType === 'materiaux' ? 'on' : ''} onClick={() => setCatalogType('materiaux')}>Matériaux</button>
            <button className={catalogType === 'machines' ? 'on' : ''} onClick={() => setCatalogType('machines')}>Machines</button>
            <button className={catalogType === 'consommables' ? 'on' : ''} onClick={() => setCatalogType('consommables')}>Consommables</button>
          </div>
          <input className="input" placeholder="Nom, catégorie…" value={query} onChange={(e) => setQuery(e.target.value)} />

          {catalogType === 'machines' && machinesEnabled && (
            <details className="wf-scan">
              <summary><ScanLine size={14} strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Scanner l’étiquette d’un outil</summary>
              <form onSubmit={(e) => { e.preventDefault(); resolveScan(); }}>
                <input ref={scanRef} className="input" placeholder="ex. AGRAFEUSE-LW4TN2" value={scanCode} onChange={(e) => setScanCode(e.target.value)} />
                <button type="submit" className="btn primary" disabled={scanBusy || !scanCode.trim()}>{scanBusy ? '…' : 'Ajouter'}</button>
              </form>
              <small className="muted">Douchette clavier ou saisie manuelle du code de l’outil.</small>
            </details>
          )}

          <div className="stock-catalog-grid">
            {emptyReason && <p className="muted" style={{ fontSize: '0.85rem' }}>{emptyReason}</p>}

            {catalogType === 'materiaux' && stockCatalog.map((it) => (
              <button key={`stock-${it.id}`} type="button" className="stock-catalog-card" onClick={() => addStock(it)}>
                <span className="icon">▥</span>
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
              <p className="stock-basket-empty">Cliquez (ou scannez) un article pour l’ajouter.</p>
            ) : cart.map((line) => (
              <div key={line.key} className="stock-basket-line">
                {line.kind === 'materiel' && line.image ? <Thumb src={line.image} size={40} /> : (
                  <span className="icon">{line.kind === 'materiel' ? '🔧' : line.kind === 'consommable' ? '🧰' : '▥'}</span>
                )}
                <span className="info">
                  <span className="name">{line.name}</span>
                  <span className="sub">{line.kind === 'stock' ? line.unit : line.kind === 'materiel' ? line.sub : ''}</span>
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
    </div>
  );
}
