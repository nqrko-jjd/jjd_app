'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatEur, formatDateBE } from '@/lib/ui';
import { DOC_KIND_LABEL, type DocFull, type Company } from '@/lib/doc-ui';
import { computeDocTotals, vatLegalNotes, DOCUMENT_LOGO, DOCUMENT_TERMS } from '@jjd/shared';

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

  // conditions générales : on réduit la police jusqu'à ce qu'elles tiennent sur une page (aucune colonne ne déborde)
  useEffect(() => {
    const c = document.querySelector<HTMLElement>('.cg-cols');
    if (!c) return;
    let s = 8;
    c.style.fontSize = `${s}px`;
    while (s > 4 && c.scrollWidth > c.clientWidth + 1) { s -= 0.1; c.style.fontSize = `${s.toFixed(1)}px`; }
  }, [d, co]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!d || !co) return <div style={{ padding: 40 }}>Chargement…</div>;

  const totals = computeDocTotals(d.lines);
  const items = d.lines;
  const title = DOC_KIND_LABEL[d.kind];
  const ref = d.number ?? d.draftRef ?? '';
  const clientName = d.billingName ?? d.contact?.name ?? '';
  const clientAddr = d.billingAddress ?? [
    [d.contact?.address, d.contact?.box && `bte ${d.contact.box}`].filter(Boolean).join(' '),
    [d.contact?.postalCode, d.contact?.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const clientVat = d.billingVat ?? d.contact?.vat;
  const hasDiscount = items.some((l) => l.kind === 'item' && l.discountPct > 0);
  // mention légale spécifique (taux réduit 6% habitation, autoliquidation 0%…), une fois par taux présent
  const itemRates = items.filter((l) => l.kind === 'item').map((l) => l.vatRate);
  const vatNotes = vatLegalNotes(itemRates.length ? itemRates : [d.vatRate], { '0.06': co.vatNote6, '0': co.vatNote0 });

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div className="brand"><img className="document-logo" src={DOCUMENT_LOGO} alt="JJD Consult" /></div>
          <div className="doc-box">
            <div className="doc-title">{title} <span className="doc-ref">{ref}</span></div>
            <div className="doc-dates">
              {d.issuedOn && <div className="date-line"><span>Date du document</span><strong>{formatDateBE(d.issuedOn)}</strong></div>}
              {d.kind === 'quote' && d.validUntil && <div className="date-line"><span>Valable jusqu’au</span><strong>{formatDateBE(d.validUntil)}</strong></div>}
              {d.dueOn && <div className="date-line"><span>Date d’échéance</span><strong>{formatDateBE(d.dueOn)}</strong></div>}
              {d.worksite && <div className="date-line"><span>Chantier</span><strong>{d.worksite.ref}</strong></div>}
              {d.customerRef && <div className="date-line"><span>Réf. client</span><strong>{d.customerRef}</strong></div>}
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
            {d.billingEmail && <div>{d.billingEmail}</div>}
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
              // label/description : HTML déjà nettoyé côté API à l'enregistrement (sanitizeLineHtml,
              // voir lib/documents.ts) — seule la mise en forme inline autorisée (gras/couleur/…) y
              // survit, donc sûr à injecter tel quel ici.
              if (l.kind === 'section') return <tr key={i} className="ln-section"><td colSpan={colspan} dangerouslySetInnerHTML={{ __html: l.label }} /></tr>;
              if (l.kind === 'text') return <tr key={i} className="ln-text"><td colSpan={colspan} dangerouslySetInnerHTML={{ __html: l.label }} /></tr>;
              const ht = l.qty * l.unitPriceHt * (1 - l.discountPct / 100);
              return (
                <tr key={i}>
                  <td>
                    <div className="ln-label" dangerouslySetInnerHTML={{ __html: l.label }} />
                    {l.description && <div className="desc" dangerouslySetInnerHTML={{ __html: l.description }} />}
                  </td>
                  <td className="c-num c-qty">{l.qty}{l.unit && <span className="unit"> {l.unit}</span>}</td>
                  <td className="c-num">{formatEur(l.unitPriceHt)}</td>
                  {hasDiscount && <td className="c-num">{l.discountPct ? `${l.discountPct}%` : '—'}</td>}
                  <td className="c-num">{l.vatRate === 0 ? 'Autoliqu.' : `${Math.round(l.vatRate * 100)}%`}</td>
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
                <tr key={rate}>{Number(rate) === 0 ? <td colSpan={2}>TVA : autoliquidation</td> : <><td>TVA {Math.round(Number(rate) * 100)}%</td><td>{formatEur(b.vat)}</td></>}</tr>
              ))}
              <tr className="grand"><td>Total TTC</td><td>{formatEur(totals.totalTtc)}</td></tr>
            </tbody>
          </table>
        </div>

        {d.kind === 'quote' ? (
          <div className="sign-row">
            <div className="sign-box"><div>Mention « Bon pour accord »</div><div>Date et signature</div><div className="sign-date">...... / ...... / ............</div><div className="sign-space" /></div>
            <div className="sign-notes">{vatNotes.map((note, i) => <p key={i} className="vat-note">{note}</p>)}</div>
          </div>
        ) : vatNotes.map((note, i) => <p key={i} className="vat-note">{note}</p>)}

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
      {(d.kind === 'invoice' || d.kind === 'deposit_invoice' || d.kind === 'quote') && <section className="sheet general-terms">
        <h1>Conditions générales JJD Consult SRL</h1>
        <div className="cg-cols">{DOCUMENT_TERMS.map((text, i) => <p key={i}>{text}</p>)}</div>
      </section>}
    </>
  );
}

const CSS = `

  .document-logo { display:block; width:220px; height:auto; object-fit:contain; }
  .sheet.general-terms { break-before:page; padding:0; margin:0; max-width:none; line-height:1.25; }
  .general-terms h1 { font-size:13px; color:#173f34; margin:0 0 4mm; }
  .cg-cols { width:178mm; height:248mm; column-count:2; column-gap:6mm; column-fill:auto; font-size:8px; overflow:hidden; }
  .general-terms p { margin:0 0 1.6mm; orphans:1; widows:1; text-align:justify; }
  .sign-row { display:flex; gap:18px; align-items:flex-start; margin-top:14px; break-inside:avoid; }
  .sign-box { flex:none; width:190px; border:1px solid #cfd5cc; border-radius:8px; padding:8px 10px; font-size:10px; color:#55606e; }
  .sign-box .sign-date { margin-top:4px; color:#26372f; letter-spacing:.04em; }
  .sign-box .sign-space { height:44px; }
  .sign-notes { flex:1; min-width:0; }
  .sign-notes .vat-note:first-child { margin-top:0; }
  .intro, .desc, .ln-label { white-space:pre-wrap; overflow-wrap:anywhere; }
  .pay, .totals, .head { break-inside:avoid; }
  @page { size: A4; margin: 16mm; }
  /* sinon Chrome/Firefox n'impriment les couleurs de fond (bandeau vert, encadrés…) que si
     l'utilisateur coche "Graphiques d'arrière-plan" dans la boîte de dialogue d'impression —
     ces règles rendent ce réglage inutile, comme le PDF serveur (printBackground: true). */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  body { background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 12px/1.6 "Segoe UI", -apple-system, Roboto, Arial, sans-serif; color: #26372f; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #e5e7df; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .mark img { width: 90%; height: 90%; object-fit: contain; }
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
  .desc { color: #788078; font-size: 11px; margin-top: 1px; white-space: pre-line; }
  .ln-label ul, .ln-label ol, .desc ul, .desc ol { margin: 2px 0; padding-left: 18px; }
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
  .vat-note { margin: 14px 0 0; color: #788078; font-size: 9.5px; line-height: 1.5; white-space: pre-line; }
  .vat-note + .vat-note { margin-top: 8px; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #173f34; background: #173f34; color: #fff; border-radius: 8px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } }
`;
