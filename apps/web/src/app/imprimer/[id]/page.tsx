'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatEur, formatDateBE } from '@/lib/ui';
import { DOC_KIND_LABEL, type DocFull, type Company } from '@/lib/doc-ui';
import { computeDocTotals } from '@jjd/shared';

export default function PrintDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<DocFull | null>(null);
  const [co, setCo] = useState<Company | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ document: DocFull; company: Company }>(`/api/documents/${id}`)
      .then((r) => { setD(r.document); setCo(r.company); })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (d && co) {
      document.title = `${DOC_KIND_LABEL[d.kind]} ${d.number ?? d.draftRef ?? ''}`;
      if (document.visibilityState === 'visible' && !new URLSearchParams(location.search).has('noprint')) {
        const t = setTimeout(() => window.print(), 500);
        return () => clearTimeout(t);
      }
    }
  }, [d, co]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!d || !co) return <div style={{ padding: 40 }}>Chargement…</div>;

  const totals = computeDocTotals(d.lines);
  const items = d.lines;
  const title = DOC_KIND_LABEL[d.kind];
  const ref = d.number ?? d.draftRef ?? '';
  const clientName = d.billingName ?? d.contact?.name ?? '';
  const clientAddr = d.billingAddress ?? [d.contact?.address, [d.contact?.postalCode, d.contact?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const clientVat = d.billingVat ?? d.contact?.vat;

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div>
            <div className="co-name">{co.name}</div>
            <div className="co-meta">
              {co.address && <div>{co.address}</div>}
              {(co.postalCode || co.city) && <div>{[co.postalCode, co.city].filter(Boolean).join(' ')}</div>}
              {co.vat && <div>TVA {co.vat}</div>}
              {co.phone && <div>{co.phone}</div>}
              {co.email && <div>{co.email}</div>}
            </div>
          </div>
          <div className="doc-box">
            <div className="doc-title">{title}</div>
            <div className="doc-ref">{ref}</div>
            <table className="doc-dates">
              <tbody>
                {d.issuedOn && <tr><td>Date</td><td>{formatDateBE(d.issuedOn)}</td></tr>}
                {d.kind === 'quote' && d.validUntil && <tr><td>Validité</td><td>{formatDateBE(d.validUntil)}</td></tr>}
                {d.dueOn && <tr><td>Échéance</td><td>{formatDateBE(d.dueOn)}</td></tr>}
                {d.worksite && <tr><td>Chantier</td><td>{d.worksite.ref}</td></tr>}
              </tbody>
            </table>
          </div>
        </header>

        <section className="parties">
          <div className="bill-to">
            <div className="lbl">Adressé à</div>
            <div className="client-name">{clientName || '—'}</div>
            {clientAddr && <div>{clientAddr}</div>}
            {clientVat && <div>TVA {clientVat}</div>}
          </div>
        </section>

        {d.title && <h1 className="object">{d.title}</h1>}
        {d.intro && <p className="intro">{d.intro}</p>}

        <table className="lines">
          <thead>
            <tr>
              <th className="c-desc">Désignation</th>
              <th className="c-num">Qté</th>
              <th className="c-unit">Unité</th>
              <th className="c-num">P.U. HT</th>
              <th className="c-num">Rem.</th>
              <th className="c-num">TVA</th>
              <th className="c-num">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => {
              if (l.kind === 'section') return <tr key={i} className="ln-section"><td colSpan={7}>{l.label}</td></tr>;
              if (l.kind === 'text') return <tr key={i} className="ln-text"><td colSpan={7}>{l.label}</td></tr>;
              const ht = l.qty * l.unitPriceHt * (1 - l.discountPct / 100);
              return (
                <tr key={i}>
                  <td>
                    <div>{l.label}</div>
                    {l.description && <div className="desc">{l.description}</div>}
                  </td>
                  <td className="c-num">{l.qty}</td>
                  <td className="c-unit">{l.unit ?? ''}</td>
                  <td className="c-num">{formatEur(l.unitPriceHt)}</td>
                  <td className="c-num">{l.discountPct ? `${l.discountPct}%` : ''}</td>
                  <td className="c-num">{Math.round(l.vatRate * 100)}%</td>
                  <td className="c-num">{formatEur(ht)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="totals">
          <table>
            <tbody>
              <tr><td>Total HT</td><td>{formatEur(totals.totalHt)}</td></tr>
              {Object.entries(totals.vatBreakdown).map(([rate, b]) => (
                <tr key={rate}><td>TVA {Math.round(Number(rate) * 100)}%</td><td>{formatEur(b.vat)}</td></tr>
              ))}
              <tr className="grand"><td>Total TTC</td><td>{formatEur(totals.totalTtc)}</td></tr>
            </tbody>
          </table>
        </div>

        {(d.kind === 'invoice' || d.kind === 'deposit_invoice') && (
          <div className="pay">
            <div><strong>Paiement</strong> — {co.iban ? `IBAN ${co.iban}` : 'coordonnées bancaires sur demande'}</div>
            {d.structuredComm && <div>Communication structurée : <strong>{d.structuredComm}</strong></div>}
          </div>
        )}

        <footer className="terms">
          {d.terms || (d.kind === 'quote' ? co.quoteTerms : co.invoiceTerms)}
        </footer>
      </div>
    </>
  );
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 12px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #294a70; padding-bottom: 14px; }
  .co-name { font-size: 17px; font-weight: 800; color: #294a70; }
  .co-meta { margin-top: 4px; color: #55606e; font-size: 11px; }
  .doc-box { text-align: right; min-width: 200px; }
  .doc-title { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #294a70; }
  .doc-ref { font-size: 14px; font-weight: 700; margin-top: 2px; }
  .doc-dates { margin-left: auto; margin-top: 8px; font-size: 11px; }
  .doc-dates td { padding: 1px 0 1px 12px; }
  .doc-dates td:first-child { color: #55606e; }
  .parties { margin: 18px 0; }
  .bill-to .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #8a95a3; font-weight: 700; }
  .client-name { font-weight: 700; font-size: 13px; margin-top: 2px; }
  .object { font-size: 14px; margin: 16px 0 6px; }
  .intro { margin: 0 0 12px; color: #3a4351; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.lines th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #55606e; border-bottom: 1.5px solid #c9d2de; padding: 6px 6px; }
  table.lines td { padding: 6px 6px; border-bottom: 1px solid #e6eaf0; vertical-align: top; }
  .c-num { text-align: right; white-space: nowrap; }
  .c-unit { text-align: center; }
  td.desc, .desc { color: #6a7482; font-size: 11px; }
  .ln-section td { background: #f2f5f9; font-weight: 700; border-bottom: 1px solid #c9d2de; }
  .ln-text td { color: #3a4351; font-style: italic; border-bottom: none; }
  .totals { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals table { border-collapse: collapse; min-width: 260px; }
  .totals td { padding: 4px 8px; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { border-top: 2px solid #294a70; font-weight: 800; font-size: 13px; padding-top: 6px; }
  .pay { margin-top: 18px; padding: 10px 12px; background: #f2f5f9; border-radius: 6px; font-size: 11px; }
  .terms { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e6eaf0; color: #6a7482; font-size: 10px; white-space: pre-wrap; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #294a70; background: #294a70; color: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } }
`;
