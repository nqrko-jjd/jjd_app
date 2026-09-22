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
  const hasDiscount = items.some((l) => l.kind === 'item' && l.discountPct > 0);

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div className="brand">
            <span className="mark">J</span>
            <div className="brand-text">
              <div className="brand-name">JD Consult</div>
              <div className="brand-tag">Maintenance · Rénovation · Gestion de projets</div>
            </div>
          </div>
          <div className="doc-box">
            <div className="doc-title">{title} <span className="doc-ref">{ref}</span></div>
            <div className="doc-dates">
              {d.issuedOn && <div className="date-line"><span>Date du document</span><strong>{formatDateBE(d.issuedOn)}</strong></div>}
              {d.kind === 'quote' && d.validUntil && <div className="date-line"><span>Valable jusqu’au</span><strong>{formatDateBE(d.validUntil)}</strong></div>}
              {d.dueOn && <div className="date-line"><span>Date d’échéance</span><strong>{formatDateBE(d.dueOn)}</strong></div>}
              {d.worksite && <div className="date-line"><span>Chantier</span><strong>{d.worksite.ref}</strong></div>}
            </div>
          </div>
        </header>

        <section className="parties">
          <div className="from">
            <div className="lbl">Émetteur</div>
            <div className="party-name">{co.name}</div>
            {co.address && <div>{co.address}</div>}
            {(co.postalCode || co.city) && <div>{[co.postalCode, co.city].filter(Boolean).join(' ')}</div>}
            {co.vat && <div>TVA {co.vat}</div>}
            {(co.phone || co.email) && <div>{[co.phone, co.email].filter(Boolean).join(' · ')}</div>}
          </div>
          <div className="bill-to">
            <div className="lbl">Adressé à</div>
            <div className="party-name">{clientName || '—'}</div>
            {clientAddr && <div>{clientAddr}</div>}
            {clientVat && <div>TVA {clientVat}</div>}
          </div>
        </section>

        {d.title && <div className="object">{d.title}</div>}
        {d.intro && <p className="intro">{d.intro}</p>}

        <table className="lines">
          <thead>
            <tr>
              <th className="c-desc">Désignation</th>
              <th className="c-num">Qté</th>
              <th className="c-num">P.U. HT</th>
              {hasDiscount && <th className="c-num">Rem.</th>}
              <th className="c-num">TVA</th>
              <th className="c-num">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => {
              const colspan = hasDiscount ? 6 : 5;
              if (l.kind === 'section') return <tr key={i} className="ln-section"><td colSpan={colspan}>{l.label}</td></tr>;
              if (l.kind === 'text') return <tr key={i} className="ln-text"><td colSpan={colspan}>{l.label}</td></tr>;
              const ht = l.qty * l.unitPriceHt * (1 - l.discountPct / 100);
              return (
                <tr key={i}>
                  <td>
                    <div className="ln-label">{l.label}</div>
                    {l.description && <div className="desc">{l.description}</div>}
                  </td>
                  <td className="c-num c-qty">{l.qty}{l.unit && <span className="unit"> {l.unit}</span>}</td>
                  <td className="c-num">{formatEur(l.unitPriceHt)}</td>
                  {hasDiscount && <td className="c-num">{l.discountPct ? `${l.discountPct}%` : '—'}</td>}
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
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 12px/1.6 "Segoe UI", -apple-system, Roboto, Arial, sans-serif; color: #26372f; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #e5e7df; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark {
    width: 34px; height: 34px; flex-shrink: 0; border-radius: 8px; background: #c5a35d; color: #173f34;
    display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 800;
  }
  .brand-name { font-size: 16px; font-weight: 800; color: #173f34; letter-spacing: -0.01em; }
  .brand-tag { font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: #9aa79e; font-weight: 700; margin-top: 2px; }
  .doc-box { text-align: right; min-width: 220px; }
  .doc-title { font-size: 19px; font-weight: 700; color: #26372f; }
  .doc-ref { font-weight: 800; color: #173f34; }
  .doc-dates { margin-top: 8px; }
  .date-line { display: flex; justify-content: flex-end; gap: 10px; font-size: 11px; margin-top: 2px; }
  .date-line span { color: #788078; }
  .date-line strong { color: #26372f; min-width: 78px; text-align: right; }

  .parties { display: flex; justify-content: space-between; gap: 20px; margin: 20px 0; }
  .parties > div { flex: 1; min-width: 0; }
  .parties .lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #9aa79e; font-weight: 700; margin-bottom: 4px; }
  .parties .party-name { font-weight: 700; font-size: 13px; color: #26372f; margin-bottom: 1px; }
  .parties > div > div:not(.lbl):not(.party-name) { color: #55606e; }
  .from { padding: 2px 0; }
  .bill-to { background: #f5f5ef; border-radius: 10px; padding: 12px 14px; }

  .object { font-weight: 700; font-size: 13px; margin: 4px 0 8px; color: #26372f; }
  .intro { margin: 0 0 12px; color: #55606e; }

  table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.lines thead th {
    background: #173f34; color: #fff; text-align: left; font-size: 10px; text-transform: uppercase;
    letter-spacing: .05em; font-weight: 700; padding: 8px 10px;
  }
  table.lines thead th:first-child { border-radius: 6px 0 0 0; }
  table.lines thead th:last-child { border-radius: 0 6px 0 0; }
  table.lines td { padding: 8px 10px; border-bottom: 1px solid #e5e7df; vertical-align: top; }
  .c-num { text-align: right; white-space: nowrap; }
  .c-qty .unit { color: #9aa79e; }
  .ln-label { font-weight: 600; }
  .desc { color: #788078; font-size: 11px; margin-top: 1px; }
  .ln-section td { background: #f5f5ef; font-weight: 700; border-bottom: 1px solid #e5e7df; }
  .ln-text td { color: #55606e; font-style: italic; border-bottom: none; }

  .totals { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals table { border-collapse: collapse; min-width: 260px; }
  .totals td { padding: 5px 10px; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { background: #173f34; color: #fff; font-weight: 800; font-size: 13px; padding: 8px 10px; }
  .totals tr.grand td:first-child { border-radius: 6px 0 0 6px; }
  .totals tr.grand td:last-child { border-radius: 0 6px 6px 0; }

  .pay { margin-top: 18px; padding: 12px 14px; background: #e9efe9; border-radius: 10px; font-size: 11px; }
  .pay strong { color: #173f34; }

  .terms { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e5e7df; color: #9aa79e; font-size: 9.5px; white-space: pre-wrap; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #173f34; background: #173f34; color: #fff; border-radius: 8px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } }
`;
