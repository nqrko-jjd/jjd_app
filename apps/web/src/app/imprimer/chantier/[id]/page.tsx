'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatEur, formatDateBE } from '@/lib/ui';
import { DOC_KIND_LABEL, DOC_STATUS_LABEL, type WorksiteMargin } from '@jjd/shared';

interface Detail {
  worksite: {
    id: string; ref: string; title: string; address: string | null; city: string | null;
    quotedHt: number | null;
    client: { name: string } | null;
    documents: { id: string; kind: string; number: string | null; draftRef: string | null; totalHt: number; status: string; issuedOn: string | null }[];
  };
  margin: WorksiteMargin | null;
}

export default function PrintChantierSummary({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Detail>(`/api/worksites/${id}`).then(setD).catch((e) => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (d) {
      document.title = `Résumé facturation ${d.worksite.ref}`;
      if (document.visibilityState === 'visible' && !new URLSearchParams(location.search).has('noprint')) {
        const t = setTimeout(() => window.print(), 500);
        return () => clearTimeout(t);
      }
    }
  }, [d]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!d) return <div style={{ padding: 40 }}>Chargement…</div>;
  const w = d.worksite;
  const m = d.margin;

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div>
            <div className="ref">{w.ref}</div>
            <h1>{w.title}</h1>
            <div className="sub">
              {w.client?.name}{w.address ? ` · ${w.address}` : ''}{w.city ? `, ${w.city}` : ''}
            </div>
          </div>
        </header>

        {!m && (
          <p className="muted" style={{ marginTop: 20 }}>
            Aucun chiffre disponible (rôle non autorisé ou chantier sans données financières).
          </p>
        )}

        {m && (
          <>
            <section>
              <h2>Résumé financier</h2>
              <table className="tbl">
                <tbody>
                  <tr><td>Devisé HT</td><td className="num">{formatEur(m.quotedHt)}</td></tr>
                  <tr><td>Facturé HT</td><td className="num">{formatEur(m.invoicedHt)}</td></tr>
                  <tr><td>Encaissé HT</td><td className="num">{formatEur(m.paidHt)}</td></tr>
                  <tr className="highlight"><td>Reste à facturer</td><td className="num">{formatEur(m.leftToInvoice)}</td></tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2>Coûts réels</h2>
              <table className="tbl">
                <tbody>
                  <tr><td>Matériaux</td><td className="num">{formatEur(m.materialCost)}</td></tr>
                  <tr><td>Main-d'œuvre</td><td className="num">{formatEur(m.labourCost)}</td></tr>
                  <tr><td>Véhicule / transport</td><td className="num">{formatEur(m.vehicleCost)}</td></tr>
                  <tr><td>Total des coûts</td><td className="num">{formatEur(m.totalCost)}</td></tr>
                  <tr className="highlight">
                    <td>Marge réelle (sur encaissé)</td>
                    <td className="num">{formatEur(m.realMargin)}{m.realMarginPct != null ? ` · ${m.realMarginPct} %` : ''}</td>
                  </tr>
                  <tr><td>Marge hypothétique (devisé − coûts)</td><td className="num">{formatEur(m.forecastMargin)}</td></tr>
                </tbody>
              </table>
            </section>
          </>
        )}

        <section>
          <h2>Devis &amp; factures de ce chantier</h2>
          {w.documents.length === 0 ? (
            <p className="muted">Aucun document.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Type</th><th>Référence</th><th>Date</th><th className="num">Montant HT</th><th>Statut</th></tr>
              </thead>
              <tbody>
                {w.documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{DOC_KIND_LABEL[doc.kind as keyof typeof DOC_KIND_LABEL] ?? doc.kind}</td>
                    <td>{doc.number ?? doc.draftRef ?? '—'}</td>
                    <td>{doc.issuedOn ? formatDateBE(doc.issuedOn) : '—'}</td>
                    <td className="num">{formatEur(doc.totalHt)}</td>
                    <td>{DOC_STATUS_LABEL[doc.status as keyof typeof DOC_STATUS_LABEL] ?? doc.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 12px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2b25; }
  .head { border-bottom: 2px solid #0c2a22; padding-bottom: 14px; }
  .ref { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #c1922a; }
  .head h1 { font-size: 20px; margin: 2px 0 4px; font-family: "Fraunces", Georgia, serif; color: #0c2a22; }
  .sub { color: #55606e; font-size: 11px; }
  section { margin-top: 20px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #55606e; margin: 0 0 8px; font-weight: 700; }
  table.tbl { width: 100%; border-collapse: collapse; }
  table.tbl th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #55606e; border-bottom: 1.5px solid #c9d2de; padding: 5px 6px; }
  table.tbl td { padding: 5px 6px; border-bottom: 1px solid #e6eaf0; }
  table.tbl tr.highlight td { font-weight: 800; border-top: 2px solid #0c2a22; border-bottom: none; padding-top: 8px; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .muted { color: #6a7482; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #0c2a22; background: #0c2a22; color: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } section { break-inside: avoid; } }
`;
