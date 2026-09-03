'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatDateBE } from '@/lib/ui';

interface Product {
  id: string;
  slug: string;
  name: string;
  kind: string;
  category: string | null;
  total: number;
  available: number;
  onSite: number;
  rented: number;
  units: {
    assetTag: string;
    state: string;
    storageLocation: string | null;
    chantier: { name: string; ref: string | null; since: string } | null;
  }[];
}
interface UnitInfo {
  unit: { assetTag: string; barcode: string | null; state: string };
  product: { name: string; kind: string };
  location:
    | { type: 'DEPOT'; storageLocation: string | null }
    | { type: 'CHANTIER'; chantier: { name: string }; since: string; takenBy: string | null }
    | { type: 'RENTED'; reservationNumber: string; until: string }
    | { type: string };
  history: { chantier: string; takenAt: string; returnedAt: string | null; takenBy: string | null }[];
}
type Worksite = { id: string; ref: string; title: string; city: string | null; client: { name: string | null } | null };

function locLabel(l: UnitInfo['location']): { text: string; tone: string } {
  switch (l.type) {
    case 'DEPOT':
      return { text: `Au dépôt Bricoloc${'storageLocation' in l && l.storageLocation ? ` · ${l.storageLocation}` : ''}`, tone: 'ok' };
    case 'CHANTIER':
      return { text: `Chantier « ${(l as { chantier: { name: string } }).chantier.name} » depuis le ${formatDateBE((l as { since: string }).since)}`, tone: 'primary' };
    case 'RENTED':
      return { text: `Louée à un client Bricoloc`, tone: 'warn' };
    case 'MAINTENANCE':
      return { text: 'En entretien', tone: 'warn' };
    case 'DAMAGED':
      return { text: 'Endommagée', tone: 'crit' };
    case 'RETIRED':
      return { text: 'Réformée', tone: 'crit' };
    default:
      return { text: l.type, tone: 'plain' };
  }
}

export default function MaterielPage() {
  const { data: status } = useApi<{ enabled: boolean }>('/api/materiel/status');
  const { data: wsData } = useApi<{ items: Worksite[] }>('/api/materiel/worksites');
  const { data: stock, reload: reloadStock } = useApi<{ products: Product[] }>('/api/materiel/stock');

  const [code, setCode] = useState('');
  const [unit, setUnit] = useState<UnitInfo | null>(null);
  const [worksiteId, setWorksiteId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  async function resolve(c: string) {
    const v = c.trim();
    if (!v) return;
    setBusy(true);
    setMsg(null);
    try {
      const info = await api<UnitInfo>(`/api/materiel/units/${encodeURIComponent(v)}`);
      setUnit(info);
    } catch (e) {
      setUnit(null);
      setMsg({ text: e instanceof ApiError ? e.message : 'Outil introuvable', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: 'loan' | 'return') {
    if (!unit) return;
    setBusy(true);
    setMsg(null);
    try {
      if (kind === 'loan') {
        if (!worksiteId) {
          setMsg({ text: 'Choisissez un chantier.', ok: false });
          setBusy(false);
          return;
        }
        const r = await api<{ chantier: { name: string } }>('/api/materiel/loans', {
          method: 'POST',
          body: { code: unit.unit.assetTag, worksiteId, note: note || undefined },
        });
        setMsg({ text: `${unit.product.name} → chantier « ${r.chantier.name} »`, ok: true });
      } else {
        await api('/api/materiel/returns', {
          method: 'POST',
          body: { code: unit.unit.assetTag, note: note || undefined },
        });
        setMsg({ text: `${unit.product.name} rentrée au dépôt`, ok: true });
      }
      setCode('');
      setNote('');
      setUnit(null);
      reloadStock();
      focusInput();
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.enabled) {
    return (
      <>
        <PageHead title="Matériel" />
        <div className="card card-pad">
          <p>
            Le parc partagé avec Bricoloc n’est pas encore configuré. Ajoutez{' '}
            <code>BRICOLOC_API_KEY</code> (même valeur que côté Bricoloc) dans{' '}
            <code>apps/api/.env</code> puis redémarrez l’API.
          </p>
        </div>
      </>
    );
  }

  const onSite = unit?.location.type === 'CHANTIER';
  const worksites = wsData?.items ?? [];

  return (
    <>
      <PageHead
        title="Matériel"
        sub={
          stock
            ? `${stock.products.reduce((a, p) => a + p.available, 0)} dispo · ${stock.products.reduce((a, p) => a + p.onSite, 0)} sur chantier`
            : 'Parc partagé avec Bricoloc'
        }
        action={
          <button
            className="btn"
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ synced: number; total: number }>('/api/materiel/sync-worksites', { method: 'POST' });
                setMsg({ text: `${r.synced}/${r.total} chantiers synchronisés vers Bricoloc`, ok: true });
              } catch (e) {
                setMsg({ text: e instanceof ApiError ? e.message : 'Échec sync', ok: false });
              } finally {
                setBusy(false);
              }
            }}
          >
            Synchroniser les chantiers →
          </button>
        }
      />

      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="field" style={{ maxWidth: 460 }}>
          <label>Scanner ou saisir le n° d’un outil</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="input"
              value={code}
              placeholder="ex. BRL-0142"
              autoFocus
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') resolve(code);
              }}
            />
            <button className="btn" disabled={busy || !code.trim()} onClick={() => resolve(code)}>
              Chercher
            </button>
          </div>
        </div>

        {msg && (
          <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginTop: 12 }}>
            {msg.text}
          </div>
        )}

        {unit && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              {unit.product.name} <span className="muted mono" style={{ fontSize: '0.8rem' }}>· {unit.unit.assetTag}</span>
            </div>
            {(() => {
              const l = locLabel(unit.location);
              return <div className={`badge ${l.tone}`} style={{ marginTop: 6 }}>{l.text}</div>;
            })()}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {!onSite && unit.location.type === 'DEPOT' && (
                <>
                  <div className="field" style={{ minWidth: 240 }}>
                    <label>Chantier de destination</label>
                    <select className="select" value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
                      <option value="">— choisir —</option>
                      {worksites.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.ref} — {w.title}
                          {w.city ? ` (${w.city})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn primary" disabled={busy} onClick={() => act('loan')}>
                    Sortir vers le chantier
                  </button>
                </>
              )}
              {onSite && (
                <button className="btn primary" disabled={busy} onClick={() => act('return')}>
                  Rentrer au dépôt
                </button>
              )}
              {(unit.location.type === 'RENTED' ||
                unit.location.type === 'MAINTENANCE' ||
                unit.location.type === 'DAMAGED' ||
                unit.location.type === 'RETIRED') && (
                <span className="muted">Indisponible pour un chantier.</span>
              )}
              <input
                className="input"
                style={{ maxWidth: 220 }}
                placeholder="Note (optionnel)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {unit.history.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="muted" style={{ cursor: 'pointer' }}>
                  Historique ({unit.history.length})
                </summary>
                <ul className="muted" style={{ fontSize: '0.85rem', marginTop: 6 }}>
                  {unit.history.map((h, i) => (
                    <li key={i}>
                      {h.chantier} · {formatDateBE(h.takenAt)}
                      {h.returnedAt ? ` → ${formatDateBE(h.returnedAt)}` : ' (en cours)'}
                      {h.takenBy ? ` · ${h.takenBy}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {stock && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Outil</th>
                <th>Catégorie</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Dispo</th>
                <th style={{ textAlign: 'right' }}>Sur chantier</th>
                <th style={{ textAlign: 'right' }}>Loué</th>
                <th>Où</th>
              </tr>
            </thead>
            <tbody>
              {stock.products
                .filter((p) => p.total > 0)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="muted">{p.category ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.total}</td>
                    <td style={{ textAlign: 'right' }}>{p.available}</td>
                    <td style={{ textAlign: 'right' }}>{p.onSite || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.rented || '—'}</td>
                    <td className="muted" style={{ fontSize: '0.82rem' }}>
                      {p.units
                        .filter((u) => u.chantier || u.state !== 'AVAILABLE')
                        .map((u) => `${u.assetTag}: ${u.chantier ? u.chantier.name : u.state}`)
                        .join(' · ') || 'toutes au dépôt'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
