'use client';
import { useEffect, useRef, useState } from 'react';
import { jpegsToPdf } from '@/lib/scan-pdf';
import { loadCv, detectQuad, warpAndClean, type Pt, type ScanMode } from '@/lib/doc-cv';

/** `firstPage` : image de la 1re page (scan fait ici) ; null pour un PDF importé tel quel (Genius Scan…). */
export interface ScannedDoc { pdf: File; firstPage: File | null; pages: number }
interface Job { id: number; label: string; status: 'work' | 'ok' | 'err'; text: string }

/** Cadre le document : repère la zone claire (la feuille) sur une vignette, puis recadre et renforce le contraste à pleine résolution. */
async function processFrame(src: CanvasImageSource, sw: number, sh: number): Promise<{ blob: Blob; w: number; h: number }> {
  const k = Math.min(1, 320 / Math.max(sw, sh));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(sw * k));
  small.height = Math.max(1, Math.round(sh * k));
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, small.width, small.height);
  const { data } = sctx.getImageData(0, 0, small.width, small.height);
  const n = small.width * small.height;
  const lum = new Uint8Array(n);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) { const v = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!); lum[i] = v; hist[v]!++; }
  // seuil d'Otsu : sépare la feuille (claire) du fond
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t]!;
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t]!;
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  const W = small.width, H = small.height;
  const rows = new Array<number>(H).fill(0), cols = new Array<number>(W).fill(0);
  let bright = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum[y * W + x]! > thr) { rows[y]!++; cols[x]!++; bright++; }
  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  const frac = bright / n;
  if (frac > 0.1 && frac < 0.9) {
    const ry = rows.map((c) => c > 0.3 * W), cx = cols.map((c) => c > 0.3 * H);
    const fy = ry.indexOf(true), ly = ry.lastIndexOf(true), fx = cx.indexOf(true), lx = cx.lastIndexOf(true);
    if (fy >= 0 && fx >= 0 && (lx - fx) > 0.35 * W && (ly - fy) > 0.35 * H) {
      const mx = Math.round(W * 0.015), my = Math.round(H * 0.015);
      x0 = Math.max(0, fx - mx); y0 = Math.max(0, fy - my); x1 = Math.min(W, lx + mx); y1 = Math.min(H, ly + my);
    }
  }
  const sx = x0 / W * sw, sy = y0 / H * sh, cw = (x1 - x0) / W * sw, ch = (y1 - y0) / H * sh;
  const out = Math.min(1, 2200 / Math.max(cw, ch));
  const cv = document.createElement('canvas');
  cv.width = Math.round(cw * out); cv.height = Math.round(ch * out);
  const ctx = cv.getContext('2d')!;
  try { ctx.filter = 'contrast(1.25) brightness(1.06)'; } catch { /* filtre non supporté : image telle quelle */ }
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Image impossible à créer'))), 'image/jpeg', 0.85));
  return { blob, w: cv.width, h: cv.height };
}

/**
 * Scanner de documents : caméra en direct, cadrage automatique de la feuille, plusieurs pages par document, plusieurs documents à la suite.
 * Chaque document terminé est envoyé à `handle` (lecture + création de la fiche) en arrière-plan, pendant qu'on continue à scanner.
 */
export function DocScanner({ title, singleDefault, handle, onClose }: { title: string; singleDefault: boolean; handle: (d: ScannedDoc) => Promise<string>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [pages, setPages] = useState<{ blob: Blob; w: number; h: number; url: string }[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [single, setSingle] = useState(singleDefault);
  const [busy, setBusy] = useState(false);
  const cvRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<'loading' | 'ready' | 'basic'>('loading');
  const [found, setFound] = useState(false);
  const [waiting, setWaiting] = useState(false); // feuille déjà scannée toujours dans le cadre : en attente qu'on la retire
  const [auto, setAuto] = useState(true);
  const [mode, setMode] = useState<ScanMode>('color');
  const autoRef = useRef(true);
  const busyRef = useRef(false);
  const captureRef = useRef<() => Promise<void>>(async () => undefined);
  const importRef = useRef<HTMLInputElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => undefined); }
      } catch {
        setCamErr('Caméra indisponible (autorisation refusée ou navigateur non compatible). Utilise le bouton « Photo » ci-dessous.');
      }
    })();
    return () => { stop = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    let stop = false;
    loadCv().then((cv) => { if (!stop) { cvRef.current = cv; setEngine('ready'); } }).catch(() => { if (!stop) setEngine('basic'); });
    return () => { stop = true; };
  }, []);

  // Contour de la feuille en direct + validation automatique : quand la feuille reste immobile, un trait vert fait le tour du cadre ;
  // une fois le tour bouclé, le scan est validé tout seul. Il faut ensuite retirer / changer la page pour armer le suivant.
  useEffect(() => {
    if (engine !== 'ready') return;
    let prev: Pt[] | null = null;
    let stableSince: number | null = null;
    let lostSince: number | null = null;
    let armed = true;
    const STABLE_MS = 1300;
    const timer = window.setInterval(() => {
      const v = videoRef.current, o = overlayRef.current, cv = cvRef.current;
      if (!v || !o || !cv || !v.videoWidth || document.hidden) return;
      let quad: Pt[] | null = null;
      try { quad = detectQuad(cv, v, v.videoWidth, v.videoHeight); } catch { quad = null; }
      const now = performance.now();
      let progress = 0;
      if (!quad) {
        prev = null; stableSince = null;
        if (lostSince == null) lostSince = now;
        if (now - lostSince > 800) armed = true;
      } else {
        lostSince = null;
        const moved = prev ? Math.max(...quad.map((p, i) => Math.hypot(p.x - prev![i]!.x, p.y - prev![i]!.y))) : 1;
        if (moved > 0.03 || stableSince == null) stableSince = now;
        prev = quad;
        if (armed && autoRef.current && !busyRef.current) {
          progress = Math.min(1, (now - stableSince) / STABLE_MS);
          if (progress >= 1) { armed = false; stableSince = now; progress = 0; void captureRef.current(); }
        }
      }
      setFound(!!quad); setWaiting(!!quad && !armed);
      o.width = v.videoWidth; o.height = v.videoHeight;
      const ctx = o.getContext('2d')!;
      ctx.clearRect(0, 0, o.width, o.height);
      if (quad) {
        const pts = quad.map((p) => ({ x: p.x * o.width, y: p.y * o.height }));
        const lw = Math.max(5, o.width / 220);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
        ctx.fillStyle = 'rgba(61,220,132,0.14)'; ctx.fill();
        ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.stroke();
        if (progress > 0) {
          // trait de progression qui fait le tour du cadre
          const edges = pts.map((p, i) => ({ a: p, b: pts[(i + 1) % 4]!, len: Math.hypot(pts[(i + 1) % 4]!.x - p.x, pts[(i + 1) % 4]!.y - p.y) }));
          let left = progress * edges.reduce((t, e) => t + e.len, 0);
          ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = lw * 1.4;
          ctx.beginPath(); ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (const e of edges) {
            const f = Math.min(1, left / e.len);
            ctx.lineTo(e.a.x + (e.b.x - e.a.x) * f, e.a.y + (e.b.y - e.a.y) * f);
            left -= e.len; if (left <= 0) break;
          }
          ctx.stroke();
        }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [engine]);

  /** Vrai scan : détecte la feuille, la redresse et nettoie le fond ; sans moteur ou sans feuille détectée, simple recadrage. */
  async function scanFrame(src: CanvasImageSource, w: number, h: number): Promise<{ blob: Blob; w: number; h: number }> {
    const cv = cvRef.current;
    if (cv) {
      try {
        const quad = detectQuad(cv, src, w, h);
        const cvs = warpAndClean(cv, src, w, h, quad, mode);
        const blob = await new Promise<Blob>((res, rej) => cvs.toBlob((b) => (b ? res(b) : rej(new Error('Image impossible à créer'))), 'image/jpeg', 0.85));
        return { blob, w: cvs.width, h: cvs.height };
      } catch { /* retombe sur le recadrage simple */ }
    }
    return processFrame(src, w, h);
  }

  function addPage(p: { blob: Blob; w: number; h: number }, finish: boolean) {
    const page = { ...p, url: URL.createObjectURL(p.blob) };
    const next = [...pages, page];
    if (finish) { setPages([]); void finishDoc(next); } else setPages(next);
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { addPage(await scanFrame(v, v.videoWidth, v.videoHeight), single); } finally { busyRef.current = false; setBusy(false); }
  }
  captureRef.current = capture;
  autoRef.current = auto;
  async function fromFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try { const bmp = await createImageBitmap(f); addPage(await scanFrame(bmp, bmp.width, bmp.height), single); } catch { setCamErr('Image illisible.'); } finally { setBusy(false); }
  }

  /** Fichiers déjà scannés ailleurs (Genius Scan, scanner du téléphone…) : un document par fichier, PDF gardé tel quel. */
  function importFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const id = ++seq.current;
      setJobs((j) => [{ id, label: `Fichier ${f.name}`, status: 'work', text: 'Envoi et lecture…' }, ...j]);
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const doc: ScannedDoc = { pdf: f, firstPage: isPdf ? null : f, pages: 1 };
      chain.current = chain.current.then(async () => {
        try { const text = await handle(doc); setJobs((j) => j.map((x) => (x.id === id ? { ...x, status: 'ok', text } : x))); }
        catch (e) { setJobs((j) => j.map((x) => (x.id === id ? { ...x, status: 'err', text: (e as Error).message || 'Échec' } : x))); }
      });
    }
  }

  async function finishDoc(list: typeof pages) {
    if (!list.length) return;
    const id = ++seq.current;
    const label = `Document ${id} · ${list.length} page${list.length > 1 ? 's' : ''}`;
    setJobs((j) => [{ id, label, status: 'work', text: 'Envoi et lecture…' }, ...j]);
    const bufs = await Promise.all(list.map(async (p) => ({ data: new Uint8Array(await p.blob.arrayBuffer()), w: p.w, h: p.h })));
    list.forEach((p) => URL.revokeObjectURL(p.url));
    const stamp = Date.now();
    const doc: ScannedDoc = {
      pdf: new File([jpegsToPdf(bufs)], `scan-${stamp}.pdf`, { type: 'application/pdf' }),
      firstPage: new File([list[0]!.blob], `scan-${stamp}.jpg`, { type: 'image/jpeg' }),
      pages: list.length,
    };
    // un document à la fois côté serveur, mais on peut déjà scanner le suivant
    chain.current = chain.current.then(async () => {
      try { const text = await handle(doc); setJobs((j) => j.map((x) => (x.id === id ? { ...x, status: 'ok', text } : x))); }
      catch (e) { setJobs((j) => j.map((x) => (x.id === id ? { ...x, status: 'err', text: (e as Error).message || 'Échec' } : x))); }
    });
  }

  const working = jobs.some((j) => j.status === 'work');
  function close() {
    if (pages.length && !window.confirm(`${pages.length} page(s) non terminée(s) seront perdues. Fermer quand même ?`)) return;
    if (working && !window.confirm('Des documents sont encore en cours de traitement. Fermer quand même ?')) return;
    onClose();
  }

  const btn = { border: 'none', borderRadius: 12, padding: '0.9rem 1.1rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' } as const;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#0b0f0d', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.9rem' }}>
        <strong style={{ flex: 1 }}>{title}</strong>
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
        </label>
        <button type="button" onClick={() => setMode((m) => (m === 'color' ? 'bw' : 'color'))} style={{ ...btn, padding: '0.4rem 0.7rem', fontSize: '0.82rem', background: '#2a332e', color: '#fff' }} title="Rendu du scan : document (couleurs, fond blanc) ou noir et blanc">
          {mode === 'color' ? 'Couleur' : 'N&B'}
        </button>
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} /> 1 page = 1 doc
        </label>
        <button type="button" onClick={close} style={{ ...btn, padding: '0.5rem 0.8rem', background: '#2a332e', color: '#fff' }}>Fermer</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center', fontSize: '0.82rem', textShadow: '0 1px 3px #000' }}>
          {engine === 'loading' ? 'Chargement du moteur de scan…' : engine === 'basic' ? 'Mode simple (moteur de scan indisponible)' : waiting ? '✓ Scanné — retire la page ou présente la suivante' : found ? (auto ? 'Ne bouge plus… le scan se valide tout seul' : 'Feuille détectée ✓ — touche Scanner') : 'Cherche la feuille… pose-la sur un fond contrasté'}
        </div>
        {camErr && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '1.5rem', textAlign: 'center' }}>{camErr}</div>}
        {pages.length > 0 && (
          <div style={{ position: 'absolute', left: 8, right: 8, top: 8, display: 'flex', gap: 6, overflowX: 'auto' }}>
            {pages.map((p, i) => <img key={p.url} src={p.url} alt={`Page ${i + 1}`} style={{ height: 72, borderRadius: 6, border: '2px solid #fff' }} />)}
          </div>
        )}
      </div>
      {jobs.length > 0 && (
        <div style={{ maxHeight: '24vh', overflowY: 'auto', padding: '0.4rem 0.9rem', fontSize: '0.84rem', background: '#141a17' }}>
          {jobs.map((j) => (
            <div key={j.id} style={{ padding: '0.2rem 0', color: j.status === 'err' ? '#ff9b9b' : j.status === 'ok' ? '#9be3b4' : '#ddd' }}>
              {j.status === 'work' ? '⏳' : j.status === 'ok' ? '✓' : '✕'} {j.label} — {j.text}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.6rem', padding: '0.7rem 0.9rem calc(0.7rem + env(safe-area-inset-bottom))', alignItems: 'center' }}>
        <button type="button" onClick={() => importRef.current?.click()} style={{ ...btn, background: '#2a332e', color: '#fff' }} title="Importer des PDF ou photos déjà scannés (Genius Scan…)">Importer</button>
        <input ref={importRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} style={{ ...btn, background: '#2a332e', color: '#fff' }}>Photo</button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" disabled={busy || !!camErr} onClick={() => void capture()} style={{ ...btn, flex: 1, background: '#2f8f5b', color: '#fff', opacity: busy || camErr ? 0.5 : 1 }}>
          {busy ? '…' : `📷 Scanner${pages.length ? ` (page ${pages.length + 1})` : ''}`}
        </button>
        {!single && (
          <button type="button" disabled={!pages.length} onClick={() => { const l = pages; setPages([]); void finishDoc(l); }} style={{ ...btn, background: '#fff', color: '#0b0f0d', opacity: pages.length ? 1 : 0.4 }}>
            Document terminé ✓
          </button>
        )}
      </div>
    </div>
  );
}
