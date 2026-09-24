'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { api } from '@/lib/api';
import type { StockItemFull } from '@/components/StockItemModal';

interface Label { key: string; code: string; name: string; ref: string; unitLine: string; brand: string | null; image: string | null }

/**
 * Formats d'impression :
 *  - `ql-wide` : Brother QL-600, rouleau DK 38 × 90 mm, étiquette à l'italienne (90 large × 38 haut), une par page ;
 *  - `ql-tall` : même rouleau mais en portrait (38 large × 90 haut), si le pilote impose ce sens ;
 *  - `a4`      : planche A4 d'étiquettes 63 × 38 mm (impression classique).
 */
type Format = 'ql-wide' | 'ql-tall' | 'a4';
const FORMAT_LABEL: Record<Format, string> = { 'ql-wide': 'Brother QL — 38 × 90 mm (à l’italienne)', 'ql-tall': 'Brother QL — 38 × 90 mm (portrait)', a4: 'Planche A4 (63 × 38 mm)' };

/** Un exemplaire d'étiquette : image + QR + code-barres 128 du même code (le terminal lit l'un ou l'autre). */
function LabelCard({ l, format, showImage }: { l: Label; format: Format; showImage: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (svg.current) JsBarcode(svg.current, l.code, { format: 'CODE128', displayValue: false, height: 40, width: 2, margin: 0 });
    QRCode.toDataURL(l.code, { margin: 0, width: 300, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [l.code]);
  const img = showImage && l.image ? l.image : null;
  return (
    <div className={`lbl lbl-${format}`}>
      <div className="lbl-top">
        {img && /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt="" className="lbl-img" />}
        <div className="lbl-txt">
          <div className="lbl-name">{l.name}</div>
          {l.brand && <div className="lbl-sub">{l.brand}</div>}
          <div className="lbl-unit">{l.unitLine}</div>
        </div>
        {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt="" className="lbl-qr" />}
      </div>
      <svg ref={svg} className="lbl-bar" preserveAspectRatio="none" />
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
  const [format, setFormat] = useState<Format>('ql-wide');
  const [showImage, setShowImage] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Étiquettes de stock';
    try {
      const f = localStorage.getItem('jjd_label_format') as Format | null;
      if (f && f in FORMAT_LABEL) setFormat(f);
    } catch { /* stockage indisponible */ }
    api<{ items: StockItemFull[] }>('/api/stock/items')
      .then((r) => setItems(r.items.filter((i) => i.ref && (all || ids.includes(i.id)))))
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickFormat(f: Format) {
    setFormat(f);
    try { localStorage.setItem('jjd_label_format', f); } catch { /* ignore */ }
  }

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!items) return <div style={{ padding: 40 }}>Chargement…</div>;

  const labels: Label[] = items.flatMap((it) => {
    const brand = [it.brand, it.model].filter(Boolean).join(' ') || null;
    const image = it.photoUrl ?? null;
    return [
      { key: `${it.id}:`, code: it.ref!, name: it.name, ref: it.ref!, brand, image, unitLine: `Unité : ${it.unit}` },
      ...it.units.map((u) => ({ key: `${it.id}:${u.name}`, code: `${it.ref}:${u.name}`, name: it.name, ref: it.ref!, brand, image, unitLine: `1 ${u.name} = ${u.factor} ${it.unit}` })),
    ];
  });
  const sheet = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.key}#${i}` })));
  const ql = format !== 'a4';
  const pageSize = format === 'ql-wide' ? '90mm 38mm' : format === 'ql-tall' ? '38mm 90mm' : 'A4';

  return (
    <div className="lbl-page">
      <div className="lbl-controls">
        <strong>{sheet.length} étiquette{sheet.length > 1 ? 's' : ''}</strong>
        <label>Format : <select value={format} onChange={(e) => pickFormat(e.target.value as Format)}>
          {(Object.keys(FORMAT_LABEL) as Format[]).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
        </select></label>
        <label>Exemplaires de chaque : <input type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label><input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} /> Image du produit</label>
        <button onClick={() => window.print()}>Imprimer</button>
        <span className="lbl-help">
          {ql
            ? 'Dans la fenêtre d’impression : choisir la Brother QL-600, papier « 38 mm × 90 mm », marges « aucune », échelle 100 %. Si l’étiquette sort tournée, changer le format ci-dessus (à l’italienne ↔ portrait). '
            : ''}
          Le code de l’étiquette « sac » (ART-0001:sac) fait entrer/sortir 1 sac ; celui sans unité, 1 unité de base.
        </span>
      </div>
      {sheet.length === 0 && <p>Aucun article avec référence à imprimer.</p>}
      <div className={ql ? 'lbl-stack' : 'lbl-grid'}>{sheet.map((l) => <LabelCard key={l.key} l={l} format={format} showImage={showImage} />)}</div>
      <style>{`
        body { background: #fff; }
        .lbl-page { font-family: system-ui, sans-serif; padding: 16px; }
        .lbl-controls { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
        .lbl-controls input[type=number] { width: 60px; }
        .lbl-controls button { padding: 6px 16px; font-weight: 700; cursor: pointer; }
        .lbl-help { color: #666; font-size: 12px; max-width: 900px; }
        .lbl-grid { display: grid; grid-template-columns: repeat(3, 63mm); gap: 3mm; }
        .lbl-stack { display: flex; flex-wrap: wrap; gap: 4mm; align-items: flex-start; }

        .lbl { flex: none; border: 1px dashed #bbb; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; break-inside: avoid; background: #fff; color: #000; }
        .lbl-top { display: flex; gap: 2mm; align-items: flex-start; flex: none; }
        .lbl-txt { min-width: 0; flex: 1; }
        .lbl-name { font-weight: 800; line-height: 1.08; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
        .lbl-sub { color: #222; line-height: 1.15; }
        .lbl-unit { font-weight: 700; margin-top: 0.8mm; line-height: 1.15; }
        .lbl-img { object-fit: contain; flex-shrink: 0; filter: grayscale(1) contrast(1.25); }
        .lbl-qr { flex-shrink: 0; image-rendering: pixelated; }
        .lbl-bar { width: 100%; }
        .lbl-code { text-align: center; font-family: ui-monospace, monospace; letter-spacing: 0.4px; }

        /* planche A4 : 63 × 38 mm */
        .lbl-a4 { width: 63mm; height: 38mm; border-radius: 2mm; padding: 2mm 2.5mm; }
        .lbl-a4 .lbl-name { font-size: 10.5pt; max-height: 11.5mm; }
        .lbl-a4 .lbl-sub { font-size: 8pt; }
        .lbl-a4 .lbl-unit { font-size: 8.5pt; }
        .lbl-a4 .lbl-img { width: 14mm; height: 14mm; }
        .lbl-a4 .lbl-qr { width: 15mm; height: 15mm; }
        .lbl-a4 .lbl-bar { height: 8mm; }
        .lbl-a4 .lbl-code { font-size: 8pt; }

        /* Brother QL, 90 large × 38 haut */
        .lbl-ql-wide { width: 90mm; height: 38mm; padding: 2mm 2.5mm 1.5mm; }
        .lbl-ql-wide .lbl-top { height: 21mm; gap: 2.5mm; }
        .lbl-ql-wide .lbl-img { width: 21mm; height: 21mm; }
        .lbl-ql-wide .lbl-qr { width: 21mm; height: 21mm; }
        .lbl-ql-wide .lbl-txt { max-height: 21mm; overflow: hidden; }
        .lbl-ql-wide .lbl-name { font-size: 10pt; }
        .lbl-ql-wide .lbl-sub { font-size: 9pt; }
        .lbl-ql-wide .lbl-unit { font-size: 9.5pt; }
        .lbl-ql-wide .lbl-bar { height: 8mm; }
        .lbl-ql-wide .lbl-code { font-size: 8.5pt; }

        /* Brother QL, 38 large × 90 haut */
        .lbl-ql-tall { width: 38mm; height: 90mm; padding: 2mm; }
        .lbl-ql-tall .lbl-top { flex-wrap: wrap; gap: 1.5mm; }
        .lbl-ql-tall .lbl-img { width: 34mm; height: 22mm; order: 0; }
        .lbl-ql-tall .lbl-txt { order: 1; flex-basis: 100%; }
        .lbl-ql-tall .lbl-qr { order: 2; width: 21mm; height: 21mm; margin: 0 auto; }
        .lbl-ql-tall .lbl-name { font-size: 10.5pt; max-height: 13mm; }
        .lbl-ql-tall .lbl-sub { font-size: 8.5pt; }
        .lbl-ql-tall .lbl-unit { font-size: 9pt; }
        .lbl-ql-tall .lbl-bar { height: 8mm; }
        .lbl-ql-tall .lbl-code { font-size: 8pt; }

        @media print {
          .lbl-controls { display: none; }
          .lbl-page { padding: 0; }
          .lbl { border: none; }
          .lbl-a4 { border: 1px solid #999; }
          .lbl-stack { display: block; }
          .lbl-ql-wide, .lbl-ql-tall { break-after: page; page-break-after: always; }
          .lbl-ql-wide:last-child, .lbl-ql-tall:last-child { break-after: auto; page-break-after: auto; }
          @page { size: ${pageSize}; margin: ${ql ? '0' : '8mm'}; }
        }
      `}</style>
    </div>
  );
}

export default function LabelsPage() {
  return <Suspense fallback={<div style={{ padding: 40 }}>Chargement…</div>}><Inner /></Suspense>;
}
