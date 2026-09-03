'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateBE } from '@/lib/ui';

interface Report {
  id: string; date: string; authorName: string; workDone: string | null; notes: string | null;
  status: string; clientName: string | null; signatureUrl: string | null; signedAt: string | null;
  photos: { id: string; url: string; caption: string | null }[];
  worksite: {
    ref: string; title: string; address: string | null; postalCode: string | null; city: string | null;
    client: { name: string } | null; building: { name: string } | null;
  };
}

export default function ReportPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ report: Report }>(`/api/reports/${id}`).then((x) => setR(x.report)).catch((e) => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (r) {
      document.title = `Rapport ${r.worksite.ref} — ${formatDateBE(r.date)}`;
      if (!new URLSearchParams(location.search).has('noprint')) {
        const t = setTimeout(() => window.print(), 500);
        return () => clearTimeout(t);
      }
    }
  }, [r]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!r) return <div style={{ padding: 40 }}>Chargement…</div>;
  const w = r.worksite;
  const addr = [w.address, [w.postalCode, w.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <>
      <style>{CSS}</style>
      <div className="tb no-print"><button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button></div>
      <div className="sheet">
        <header>
          <div>
            <div className="co">JJD Consult</div>
            <div className="mut">Rapport d’intervention</div>
          </div>
          <div className="right">
            <div className="ref">{w.ref}</div>
            <div className="mut">{formatDateBE(r.date)}</div>
          </div>
        </header>

        <table className="meta">
          <tbody>
            <tr><td>Chantier</td><td>{w.title}</td></tr>
            {w.building && <tr><td>Immeuble</td><td>{w.building.name}</td></tr>}
            {w.client && <tr><td>Client</td><td>{w.client.name}</td></tr>}
            {addr && <tr><td>Adresse</td><td>{addr}</td></tr>}
            <tr><td>Intervenant</td><td>{r.authorName}</td></tr>
          </tbody>
        </table>

        <h2>Travaux réalisés</h2>
        <p className="body">{r.workDone || '—'}</p>

        {r.notes && (<><h2>Remarques</h2><p className="body">{r.notes}</p></>)}

        {r.photos.length > 0 && (
          <>
            <h2>Photos ({r.photos.length})</h2>
            <div className="photos">
              {r.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <figure key={p.id}><img src={p.url} alt={p.caption ?? ''} />{p.caption && <figcaption>{p.caption}</figcaption>}</figure>
              ))}
            </div>
          </>
        )}

        <div className="sign">
          <h2>Réception</h2>
          {r.status === 'signed' ? (
            <div className="signed">
              {r.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sig" src={r.signatureUrl} alt="signature" />
              )}
              <div>
                <div>Signé par <strong>{r.clientName}</strong></div>
                <div className="mut">le {formatDateBE(r.signedAt)}</div>
              </div>
            </div>
          ) : (
            <p className="mut">Rapport non encore signé par le client.</p>
          )}
        </div>
      </div>
    </>
  );
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; }
  .tb { max-width: 760px; margin: 12px auto 0; text-align: right; padding: 0 24px; }
  .tb button { padding: 8px 14px; border: 1px solid #274a70; background: #274a70; color: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .sheet { max-width: 760px; margin: 0 auto; padding: 24px; font: 13px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif; color: #1c2733; }
  .sheet header { display: flex; justify-content: space-between; border-bottom: 2px solid #274a70; padding-bottom: 12px; align-items: flex-end; }
  .co { font-size: 18px; font-weight: 800; color: #274a70; }
  .ref { font-size: 18px; font-weight: 800; }
  .right { text-align: right; }
  .mut { color: #6b7683; font-size: 12px; }
  table.meta { width: 100%; border-collapse: collapse; margin: 16px 0; }
  table.meta td { padding: 4px 8px; border-bottom: 1px solid #edf0f3; vertical-align: top; }
  table.meta td:first-child { color: #6b7683; width: 130px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #274a70; margin: 20px 0 6px; }
  p.body { white-space: pre-wrap; margin: 0; }
  .photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 6px; }
  .photos figure { margin: 0; }
  .photos img { width: 100%; border-radius: 6px; border: 1px solid #e3e7eb; }
  .photos figcaption { font-size: 11px; color: #6b7683; margin-top: 2px; }
  .sign { margin-top: 26px; border-top: 1px solid #e3e7eb; padding-top: 12px; }
  .signed { display: flex; gap: 20px; align-items: center; }
  .sig { height: 90px; border: 1px solid #e3e7eb; border-radius: 6px; background: #fff; }
  @media print { .no-print { display: none !important; } .sheet { padding: 0; } }
`;
