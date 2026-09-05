'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatDateBE } from '@/lib/ui';

interface Unit {
  assetTag: string;
  state: string;
  storageLocation: string | null;
  chantier: { name: string; ref: string | null; since: string } | null;
}
interface Product {
  id: string;
  slug: string;
  name: string;
  kind: string;
  brand: string | null;
  model: string | null;
  image: string | null;
  category: string | null;
  shortDescription: string | null;
  description: string | null;
  specs: Record<string, string>;
  manualUrl: string | null;
  documents: { label: string; url: string }[];
  total: number;
  available: number;
  onSite: number;
  rented: number;
  units: Unit[];
}
interface Consumable {
  id: string;
  slug: string;
  name: string;
  stockQty: number | null;
  shortDescription: string | null;
}
type Worksite = { id: string; ref: string; title: string; city: string | null; client: { name: string } | null };

const RECENT_KEY = 'jjd_materiel_recent';
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    const cur = loadRecent().filter((x) => x !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...cur].slice(0, 5)));
  } catch {}
}

/** Étape 2 du parcours : « pour quel chantier ? » — suggestions récentes + recherche, pas de longue liste déroulante. */
function WorksitePicker({
  worksites, label, onPick, onCancel,
}: {
  worksites: Worksite[]; label: string; onPick: (w: Worksite) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const recentIds = useMemo(() => loadRecent(), []);
  const recent = useMemo(
    () => recentIds.map((id) => worksites.find((w) => w.id === id)).filter((w): w is Worksite => !!w),
    [recentIds, worksites],
  );
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return worksites
      .filter((w) => `${w.ref} ${w.title} ${w.city ?? ''} ${w.client?.name ?? ''}`.toLowerCase().includes(s))
      .slice(0, 8);
  }, [worksites, q]);

  return (
    <div style={{ display: 'grid', gap: 10, padding: '0.7rem', background: 'var(--surface-2)', borderRadius: 10 }}>
      <div style={{ fontWeight: 650, fontSize: '0.85rem' }}>{label}</div>
      {!q && recent.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {recent.map((w) => (
            <button key={w.id} type="button" className="badge primary" style={{ cursor: 'pointer' }} onClick={() => onPick(w)}>
              {w.ref} — {w.title}
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        autoFocus
        placeholder="Chercher un chantier (réf, client, ville…)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q && (
        <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {matches.length === 0 && <div className="muted" style={{ fontSize: '0.82rem' }}>Aucun chantier trouvé.</div>}
          {matches.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onPick(w)}
              className="btn"
              style={{ textAlign: 'left', justifyContent: 'flex-start' }}
            >
              <span className="mono" style={{ marginRight: 6 }}>{w.ref}</span>
              {w.title}{w.city ? ` (${w.city})` : ''}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn" onClick={onCancel}>Annuler</button>
    </div>
  );
}

/** Retour au dépôt : on scanne (ou tape) l'étiquette de la zone/étagère où l'outil est physiquement remis. */
function LocationPicker({
  suggestions, label, onConfirm, onCancel,
}: {
  suggestions: string[]; label: string; onConfirm: (loc: string) => void; onCancel: () => void;
}) {
  const [loc, setLoc] = useState('');

  function submit() {
    const v = loc.trim();
    if (v) onConfirm(v);
  }

  return (
    <div style={{ display: 'grid', gap: 10, padding: '0.7rem', background: 'var(--surface-2)', borderRadius: 10 }}>
      <div style={{ fontWeight: 650, fontSize: '0.85rem' }}>{label}</div>
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {suggestions.map((s) => (
            <button key={s} type="button" className="badge primary" style={{ cursor: 'pointer' }} onClick={() => onConfirm(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        autoFocus
        placeholder="Scanner l’étiquette de zone ou taper l’emplacement (ex. Étagère A3)"
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={!loc.trim()} onClick={submit}>Confirmer le retour</button>
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'Au dépôt',
  ON_SITE: 'Sur chantier',
  RENTED: 'Loué (client Bricoloc)',
  MAINTENANCE: 'En entretien',
  DAMAGED: 'Endommagé',
  RETIRED: 'Réformé',
};

function unitLoc(u: Unit): string {
  if (u.chantier) return `${u.chantier.name} · depuis le ${formatDateBE(u.chantier.since)}`;
  if (u.state === 'AVAILABLE') return u.storageLocation ? `Dépôt Bricoloc · ${u.storageLocation}` : 'Dépôt Bricoloc';
  return STATE_LABEL[u.state] ?? u.state;
}

/** Description, poids/puissance (specs) et fiche technique — quand Bricoloc les a renseignés. */
function ProductInfo({ p }: { p: Product }) {
  const specs = Object.entries(p.specs ?? {});
  const docs = p.documents ?? [];
  if (!p.description && !p.shortDescription && specs.length === 0 && !p.manualUrl && docs.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: '0.85rem' }}>
      {(p.shortDescription || p.description) && <p style={{ margin: 0 }}>{p.shortDescription || p.description}</p>}
      {specs.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {specs.map(([k, v]) => (
              <tr key={k}>
                <td className="muted" style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>{k}</td>
                <td style={{ padding: '2px 0' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(p.manualUrl || docs.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {p.manualUrl && <a href={p.manualUrl} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}>📄 Fiche technique</a>}
          {docs.map((d) => (
            <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}>{d.label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MaterielPage() {
  const { data: status } = useApi<{ enabled: boolean }>('/api/materiel/status');
  const { data: wsData } = useApi<{ items: Worksite[] }>('/api/materiel/worksites');
  const { data: stock, reload, loading } = useApi<{ products: Product[] }>('/api/materiel/stock');
  const { data: consData, reload: reloadCons } = useApi<{ consumables: Consumable[] }>('/api/materiel/consumables');

  const [tab, setTab] = useState<'outils' | 'consommables'>('outils');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // Sortie en cours : soit un exemplaire scanné directement, soit un exemplaire choisi dans la fiche produit.
  const [scanPending, setScanPending] = useState<{ assetTag: string; productName: string } | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<string | null>(null);
  // Retour en cours : il faut scanner/indiquer la zone où l'outil est remis avant de valider.
  const [scanReturnPending, setScanReturnPending] = useState<{ assetTag: string; productName: string } | null>(null);
  const [returnTarget, setReturnTarget] = useState<string | null>(null);
  // Retrait de consommable en cours.
  const [consumeTarget, setConsumeTarget] = useState<string | null>(null);
  const [consumeQty, setConsumeQty] = useState(1);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const products = stock?.products ?? [];
  const consumables = consData?.consumables ?? [];
  const worksites = wsData?.items ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.total > 0)
      .filter((p) => !q || `${p.name} ${p.brand ?? ''} ${p.category ?? ''}`.toLowerCase().includes(q));
  }, [products, search]);

  const filteredCons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return consumables.filter((c) => !q || `${c.name} ${c.shortDescription ?? ''}`.toLowerCase().includes(q));
  }, [consumables, search]);

  const open = products.find((p) => p.id === openId) ?? null;

  // Emplacements déjà utilisés au dépôt — proposés en un tap plutôt que de tout retaper.
  const knownLocations = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const u of p.units) if (u.storageLocation) set.add(u.storageLocation);
    return [...set].sort().slice(0, 12);
  }, [products]);

  async function resolveScan(code: string) {
    const v = code.trim();
    if (!v) return;
    try {
      const info = await api<{ unit: { assetTag: string; state: string }; product: { id: string; name: string } }>(
        `/api/materiel/units/${encodeURIComponent(v)}`,
      );
      setScan('');
      if (info.unit.state === 'AVAILABLE') {
        // Chemin rapide : on sait déjà quel exemplaire, il ne reste qu'à dire pour quel chantier.
        setScanPending({ assetTag: info.unit.assetTag, productName: info.product.name });
      } else if (info.unit.state === 'ON_SITE') {
        // Retour : il faut encore dire dans quelle zone l'outil est remis.
        setScanReturnPending({ assetTag: info.unit.assetTag, productName: info.product.name });
      } else {
        await reload();
        setOpenId(info.product.id);
      }
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Outil introuvable', ok: false });
    }
  }

  async function checkout(assetTag: string, w: Worksite) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/loans', { method: 'POST', body: { code: assetTag, worksiteId: w.id } });
      pushRecent(w.id);
      setToast({ text: `${assetTag} → ${w.ref}`, ok: true });
      setScanPending(null);
      setCheckoutTarget(null);
      await reload();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function returnUnit(assetTag: string, storageLocation: string) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/returns', { method: 'POST', body: { code: assetTag, storageLocation } });
      setToast({ text: `${assetTag} rentré au dépôt · ${storageLocation}`, ok: true });
      setScanReturnPending(null);
      setReturnTarget(null);
      await reload();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function consume(consumableId: string, label: string, qty: number, w: Worksite) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/consumption', { method: 'POST', body: { productId: consumableId, quantity: qty, worksiteId: w.id } });
      pushRecent(w.id);
      setToast({ text: `${qty} × ${label} → ${w.ref}`, ok: true });
      setConsumeTarget(null);
      setConsumeQty(1);
      await reloadCons();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.enabled) {
    return (
      <>
        <PageHead title="Matériel" />
        <div className="card card-pad">
          Le parc partagé avec Bricoloc n’est pas configuré (<code>BRICOLOC_API_KEY</code> dans{' '}
          <code>apps/api/.env</code>).
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Matériel"
        sub={
          stock
            ? `${products.reduce((a, p) => a + p.available, 0)} au dépôt · ${products.reduce((a, p) => a + p.onSite, 0)} sur chantier`
            : 'Parc partagé avec Bricoloc'
        }
      />

      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'outils' ? 'on' : ''} onClick={() => setTab('outils')}>Outils</button>
        <button className={tab === 'consommables' ? 'on' : ''} onClick={() => setTab('consommables')}>Consommables</button>
      </div>

      {tab === 'outils' && (
        <div className="card card-pad" style={{ marginBottom: '1rem', display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label>Rechercher un outil</label>
              <input className="input" placeholder="perceuse, Makita, ponçage…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="field" style={{ flex: '0 1 220px' }}>
              <label>Scanner un n° d’exemplaire</label>
              <input
                ref={scanRef}
                className="input"
                placeholder="ex. BRL-0142"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && resolveScan(scan)}
              />
            </div>
          </div>
          {scanPending && (
            <WorksitePicker
              worksites={worksites}
              label={`Sortir ${scanPending.assetTag} (${scanPending.productName}) → pour quel chantier ?`}
              onPick={(w) => checkout(scanPending.assetTag, w)}
              onCancel={() => setScanPending(null)}
            />
          )}
          {scanReturnPending && (
            <LocationPicker
              suggestions={knownLocations}
              label={`Retour ${scanReturnPending.assetTag} (${scanReturnPending.productName}) → dans quelle zone ?`}
              onConfirm={(loc) => returnUnit(scanReturnPending.assetTag, loc)}
              onCancel={() => setScanReturnPending(null)}
            />
          )}
        </div>
      )}

      {tab === 'consommables' && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label>Rechercher un consommable</label>
            <input className="input" placeholder="ciment, vis, gants…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`badge ${toast.ok ? 'ok' : 'crit'}`} style={{ marginBottom: 12 }}>
          {toast.text}
        </div>
      )}

      {tab === 'outils' && (
        <>
          {loading && !stock && <div className="empty">Chargement du parc…</div>}

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setOpenId(p.id)}
                className="card"
                style={{ padding: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ aspectRatio: '4 / 3', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="muted" style={{ fontSize: '0.75rem' }}>pas de photo</span>
                  )}
                </div>
                <div style={{ padding: '0.6rem 0.7rem', display: 'grid', gap: 4 }}>
                  <div style={{ fontWeight: 650, fontSize: '0.9rem', lineHeight: 1.25 }}>{p.name}</div>
                  {p.brand && <div className="muted" style={{ fontSize: '0.75rem' }}>{p.brand}{p.model ? ` ${p.model}` : ''}</div>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    <span className={`badge plain ${p.available > 0 ? 'ok' : ''}`} style={{ fontSize: '0.68rem' }}>{p.available} dispo</span>
                    {p.onSite > 0 && <span className="badge plain warn" style={{ fontSize: '0.68rem' }}>{p.onSite} chantier</span>}
                    {p.rented > 0 && <span className="badge plain" style={{ fontSize: '0.68rem' }}>{p.rented} loué</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {!loading && filtered.length === 0 && <div className="empty">Aucun outil.</div>}

          {open && (
            <div className="modal-scrim" onClick={() => { setOpenId(null); setCheckoutTarget(null); setReturnTarget(null); }}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
                <div className="modal-head">
                  <b>{open.name}</b>
                  <button className="btn" onClick={() => { setOpenId(null); setCheckoutTarget(null); setReturnTarget(null); }}>Fermer</button>
                </div>
                <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
                  <div style={{ display: 'flex', gap: 14 }}>
                    {open.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={open.image} alt="" style={{ width: 120, height: 90, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 8, flexShrink: 0 }} />
                    )}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {open.brand ? `${open.brand}${open.model ? ` ${open.model}` : ''} · ` : ''}
                      {open.category ?? ''}
                      <br />
                      {open.total} exemplaire{open.total > 1 ? 's' : ''} · {open.available} au dépôt
                    </div>
                  </div>

                  <ProductInfo p={open} />

                  <div style={{ display: 'grid', gap: 8 }}>
                    {open.units.map((u) => (
                      <div key={u.assetTag} style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.6rem', border: '1px solid var(--line)', borderRadius: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{u.assetTag}</div>
                            <div className="muted" style={{ fontSize: '0.75rem' }}>{unitLoc(u)}</div>
                          </div>
                          {u.state === 'AVAILABLE' && (
                            <button className="btn primary" disabled={busy} onClick={() => setCheckoutTarget(u.assetTag)}>
                              Sortir…
                            </button>
                          )}
                          {u.state === 'ON_SITE' && (
                            <button className="btn" disabled={busy} onClick={() => setReturnTarget(u.assetTag)}>Rentrer au dépôt…</button>
                          )}
                          {u.state !== 'AVAILABLE' && u.state !== 'ON_SITE' && (
                            <span className="muted" style={{ fontSize: '0.75rem' }}>{STATE_LABEL[u.state] ?? u.state}</span>
                          )}
                        </div>
                        {checkoutTarget === u.assetTag && (
                          <WorksitePicker
                            worksites={worksites}
                            label={`${u.assetTag} → pour quel chantier ?`}
                            onPick={(w) => checkout(u.assetTag, w)}
                            onCancel={() => setCheckoutTarget(null)}
                          />
                        )}
                        {returnTarget === u.assetTag && (
                          <LocationPicker
                            suggestions={knownLocations}
                            label={`${u.assetTag} → dans quelle zone est-il remis ?`}
                            onConfirm={(loc) => returnUnit(u.assetTag, loc)}
                            onCancel={() => setReturnTarget(null)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'consommables' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {filteredCons.length === 0 && <div className="empty">Aucun consommable.</div>}
          {filteredCons.map((c) => (
            <div key={c.id} className="card card-pad" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{c.name}</div>
                  {c.shortDescription && <div className="muted" style={{ fontSize: '0.8rem' }}>{c.shortDescription}</div>}
                  <span className={`badge plain ${(c.stockQty ?? 0) > 0 ? 'ok' : 'crit'}`} style={{ fontSize: '0.68rem', marginTop: 4 }}>
                    {c.stockQty ?? '—'} en stock
                  </span>
                </div>
                {consumeTarget !== c.id && (
                  <button className="btn primary" disabled={busy} onClick={() => { setConsumeTarget(c.id); setConsumeQty(1); }}>
                    Retirer…
                  </button>
                )}
              </div>
              {consumeTarget === c.id && (
                <>
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <label className="muted" style={{ fontSize: '0.82rem' }}>Quantité</label>
                    <input
                      className="input" type="number" min={1} step="any" style={{ width: 90 }}
                      value={consumeQty}
                      onChange={(e) => setConsumeQty(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                  <WorksitePicker
                    worksites={worksites}
                    label={`Retirer ${consumeQty} × ${c.name} → pour quel chantier ?`}
                    onPick={(w) => consume(c.id, c.name, consumeQty, w)}
                    onCancel={() => setConsumeTarget(null)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
