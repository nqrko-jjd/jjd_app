'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { api } from '@/lib/api';
import type { StockItemFull } from '@/components/StockItemModal';

interface Label { key: string; code: string; name: string; ref: string; unitLine: string; brand: string | null }

/** Un exemplaire d'étiquette : QR + code-barres 128 du même code (le terminal lit l'un ou l'autre). */
function LabelCard({ l }: { l: Label }) {
  const svg = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (svg.current) JsBarcode(svg.current, l.code, { format: 'CODE128', displayValue: false, height: 34, width: 1.6, margin: 0 });
    QRCode.toDataURL(l.code, { margin: 0, width: 220, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [l.code]);
  return (
    <div className="lbl">
      <div className="lbl-top">
        {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt="" className="lbl-qr" />}
        <div className="lbl-txt">
          <div className="lbl-name">{l.name}</div>
          {l.brand && <div className="lbl-sub">{l.brand}</div>}
          <div className="lbl-unit">{l.unitLine}</div>
        </div>
      </div>
      <svg ref={svg} className="lbl-bar" />
      <div className="lbl-code">{l.code}</div>
    </div>
  );
}

function Inner() {
  const sp = useSearchParams();
  const ids = (sp.get('ids') ?? '').split(',').filter(Boolean);
  const all = sp.get('all') === '1';
  const [items, setItems] = useState<StockItemFull[] | null>(null);
  const [copies, setCopies] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Étiquettes de stock';
    api<{ items: StockItemFull[] }>('/api/stock/items')
      .then((r) => setItems(r.items.filter((i) => i.ref && (all || ids.includes(i.id)))))
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!items) return <div style={{ padding: 40 }}>Chargement…</div>;

  const labels: Label[] = items.flatMap((it) => [
    { key: `${it.id}:`, code: it.ref!, name: it.name, ref: it.ref!, brand: it.brand, unitLine: `Unité : ${it.unit}` },
    ...it.units.map((u) => ({ key: `${it.id}:${u.name}`, code: `${it.ref}:${u.name}`, name: it.name, ref: it.ref!, brand: it.brand, unitLine: `1 ${u.name} = ${u.factor} ${it.unit}` })),
  ]);
  const sheet = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.key}#${i}` })));

  return (
    <div className="lbl-page">
      <div className="lbl-controls">
        <strong>{labels.length} étiquette{labels.length > 1 ? 's' : ''}</strong>
        <label>Exemplaires de chaque : <input type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} /></label>
        <button onClick={() => window.print()}>Imprimer</button>
        <span className="lbl-help">Le code de l’étiquette « sac » (ART-0001:sac) fait entrer/sortir 1 sac ; celui sans unité, 1 unité de base.</span>
      </div>
      {sheet.length === 0 && <p>Aucun article avec référence à imprimer.</p>}
      <div className="lbl-grid">{sheet.map((l) => <LabelCard key={l.key} l={l} />)}</div>
      <style>{`
        body { background: #fff; }
        .lbl-page { font-family: system-ui, sans-serif; padding: 16px; }
        .lbl-controls { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
        .lbl-controls input { width: 60px; }
        .lbl-controls button { padding: 6px 16px; font-weight: 700; cursor: pointer; }
        .lbl-help { color: #666; font-size: 12px; }
        .lbl-grid { display: grid; grid-template-columns: repeat(3, 63mm); gap: 3mm; }
        .lbl { width: 63mm; height: 38mm; border: 1px dashed #bbb; border-radius: 2mm; padding: 2mm 2.5mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; break-inside: avoid; }
        .lbl-top { display: flex; gap: 2.5mm; align-items: flex-start; }
        .lbl-qr { width: 15mm; height: 15mm; flex-shrink: 0; }
        .lbl-txt { min-width: 0; }
        .lbl-name { font-weight: 800; font-size: 11pt; line-height: 1.1; max-height: 12mm; overflow: hidden; }
        .lbl-sub { font-size: 8pt; color: #444; }
        .lbl-unit { font-size: 8.5pt; font-weight: 700; margin-top: 1mm; }
        .lbl-bar { width: 100%; height: 9mm; }
        .lbl-code { text-align: center; font-family: ui-monospace, monospace; font-size: 8pt; letter-spacing: 0.5px; }
        @media print {
          .lbl-controls { display: none; }
          .lbl-page { padding: 0; }
          .lbl { border-color: #999; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>
    </div>
  );
}

export default function LabelsPage() {
  return <Suspense fallback={<div style={{ padding: 40 }}>Chargement…</div>}><Inner /></Suspense>;
}
