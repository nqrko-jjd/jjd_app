'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PO_STATUS_LABEL } from '@/lib/stock-orders-ui';
import type { Company } from '@/lib/doc-ui';

interface Line {
  id: string; qty: number; price: number | null; unitName: string | null;
  stockItem: { ref: string | null; name: string; brand: string | null; model: string | null; unit: string };
}
interface Order {
  id: string; ref: string; status: string; expectedOn: string | null; supplierRef: string | null; note: string | null;
  contact: { name: string; customerNumber: string | null; phone: string | null; email: string | null };
  worksite: { ref: string; title: string } | null;
  lines: Line[];
}

const fmtQty = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);
const fmtEur = (n: number) => new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(n);
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });

export default function PrintOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ order: Order }>(`/api/purchasing/orders/${id}`),
      api<{ company: Company }>('/api/settings/company'),
    ])
      .then(([o, c]) => { setOrder(o.order); setCompany(c.company); })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (order && company) {
      document.title = `Commande ${order.ref} — ${order.contact.name}`;
      if (document.visibilityState === 'visible' && !new URLSearchParams(location.search).has('noprint')) {
        const t = setTimeout(() => window.print(), 500);
        return () => clearTimeout(t);
      }
    }
  }, [order, company]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!order || !company) return <div style={{ padding: 40 }}>Chargement…</div>;

  const total = order.lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0);

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div>
            <div className="ref">Bon de commande {order.ref}</div>
            <h1>{order.contact.name}</h1>
            {order.worksite && <div className="sub">Pour le chantier {order.worksite.ref} · {order.worksite.title}</div>}
          </div>
          <div className="when">
            <div className="date">{PO_STATUS_LABEL[order.status] ?? order.status}</div>
            {order.expectedOn && <div className="hours">attendue le {dateLabel(order.expectedOn)}</div>}
          </div>
        </header>

        <section className="grid2">
          <div className="box">
            <div className="lbl">De</div>
            <div className="big">{company.name}</div>
            <div>{company.address}</div>
            <div>{[company.postalCode, company.city].filter(Boolean).join(' ')}</div>
            {company.phone && <div>{company.phone}</div>}
            {company.email && <div>{company.email}</div>}
            {company.vat && <div>TVA {company.vat}</div>}
          </div>
          <div className="box">
            <div className="lbl">Fournisseur</div>
            <div className="big">{order.contact.name}</div>
            {order.contact.customerNumber && <div>N° client : {order.contact.customerNumber}</div>}
            {order.contact.phone && <div>{order.contact.phone}</div>}
            {order.contact.email && <div>{order.contact.email}</div>}
            {order.supplierRef && <div>Réf. : {order.supplierRef}</div>}
          </div>
        </section>

        <table className="lines">
          <thead>
            <tr><th>Réf.</th><th>Article</th><th className="num">Qté</th><th className="num">Prix unit.</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const unit = l.unitName ?? l.stockItem.unit;
              return (
                <tr key={l.id}>
                  <td className="mono">{l.stockItem.ref ?? '—'}</td>
                  <td>{l.stockItem.name}{(l.stockItem.brand || l.stockItem.model) ? ` (${[l.stockItem.brand, l.stockItem.model].filter(Boolean).join(' ')})` : ''}</td>
                  <td className="num">{fmtQty(l.qty)} {unit}</td>
                  <td className="num">{l.price != null ? fmtEur(l.price) : '—'}</td>
                  <td className="num">{l.price != null ? fmtEur(l.qty * l.price) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          {total > 0 && (
            <tfoot>
              <tr><td colSpan={4}>Total HT</td><td className="num">{fmtEur(total)}</td></tr>
            </tfoot>
          )}
        </table>

        {order.note && (
          <section className="instructions">
            <div className="lbl">Note</div>
            <p>{order.note}</p>
          </section>
        )}
      </div>
    </>
  );
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 13px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2b25; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid #0c2a22; padding-bottom: 14px; }
  .ref { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #c1922a; }
  .head h1 { font-size: 22px; margin: 2px 0 4px; font-family: "Fraunces", Georgia, serif; color: #0c2a22; }
  .sub { color: #5a675f; font-size: 12px; }
  .when { text-align: right; white-space: nowrap; }
  .when .date { font-weight: 700; text-transform: capitalize; }
  .when .hours { font-size: 13px; color: #5a675f; margin-top: 2px; }
  section { margin-top: 16px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .box { border: 1px solid #dbe3dd; border-radius: 8px; padding: 10px 12px; }
  .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: #8a938c; font-weight: 700; margin-bottom: 4px; }
  .big { font-weight: 700; font-size: 14px; }
  .lines { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12.5px; }
  .lines th { text-align: left; border-bottom: 2px solid #0c2a22; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #5a675f; }
  .lines td { padding: 7px 8px; border-bottom: 1px solid #e0e6e2; }
  .lines .num { text-align: right; white-space: nowrap; }
  .lines tfoot td { border-top: 2px solid #0c2a22; border-bottom: none; font-weight: 800; padding-top: 9px; }
  .mono { font-family: "SFMono-Regular", Consolas, monospace; font-size: 11.5px; }
  .instructions { background: #eef4f0; border-left: 4px solid #0c2a22; border-radius: 6px; padding: 12px 14px; }
  .instructions p { margin: 0; white-space: pre-wrap; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #0c2a22; background: #0c2a22; color: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } .box { break-inside: avoid; } }
`;
