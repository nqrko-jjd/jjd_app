/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Moteur de « vrai scanner » : repère la feuille (contour à 4 coins), la redresse en vue de dessus (correction de perspective)
 * et nettoie le fond (ombres, éclairage inégal) comme le font les applis de scan. S'appuie sur OpenCV.js, chargé à la demande
 * (≈10 Mo, mis en cache par le navigateur). Sans lui, le scanner retombe sur le simple recadrage.
 */
const CV_URL = 'https://docs.opencv.org/4.9.0/opencv.js';
let loading: Promise<any> | null = null;

export function loadCv(): Promise<any> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as any;
    // le module OpenCV est lui-même « thenable » : on le rend avant de le renvoyer par une promesse, sinon elle ne se résout jamais
    const done = () => { const cv = w.cv; try { delete cv.then; } catch { /* propriété non supprimable */ } resolve(cv); };
    if (w.cv && w.cv.Mat) { done(); return; }
    const s = document.createElement('script');
    s.src = CV_URL; s.async = true;
    s.onload = () => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (w.cv && w.cv.Mat) { window.clearInterval(timer); done(); }
        else if (Date.now() - started > 60_000) { window.clearInterval(timer); loading = null; reject(new Error('OpenCV trop long à démarrer')); }
      }, 100);
    };
    s.onerror = () => { loading = null; reject(new Error('Chargement du moteur de scan impossible')); };
    document.head.appendChild(s);
  });
  return loading;
}

export type Pt = { x: number; y: number };

/** Ordonne 4 points : haut-gauche, haut-droit, bas-droit, bas-gauche. */
function order(p: Pt[]): Pt[] {
  const bySum = [...p].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...p].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0]!, byDiff[0]!, bySum[3]!, byDiff[3]!];
}

/** Cherche le plus grand quadrilatère convexe de l'image (la feuille). Points en fraction de la largeur/hauteur (0‑1), ou null. */
export function detectQuad(cv: any, src: CanvasImageSource, sw: number, sh: number): Pt[] | null {
  const k = Math.min(1, 480 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  const mats: any[] = [];
  const M = (m: any) => { mats.push(m); return m; };
  try {
    const img = M(cv.imread(c));
    const gray = M(new cv.Mat());
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const edges = M(new cv.Mat());
    cv.Canny(gray, edges, 50, 150);
    const kernel = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, kernel);
    const contours = M(new cv.MatVector());
    const hier = M(new cv.Mat());
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const frame = c.width * c.height;
    let best: Pt[] | null = null, bestArea = 0.2 * frame; // une feuille couvre au moins 20 % de l'image
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > bestArea) {
        const peri = cv.arcLength(cnt, true);
        const ap = new cv.Mat();
        cv.approxPolyDP(cnt, ap, 0.02 * peri, true);
        if (ap.rows === 4 && cv.isContourConvex(ap)) {
          best = order(Array.from({ length: 4 }, (_, j) => ({ x: ap.data32S[j * 2]! / c.width, y: ap.data32S[j * 2 + 1]! / c.height })));
          bestArea = area;
        }
        ap.delete();
      }
      cnt.delete();
    }
    return best;
  } finally { mats.forEach((m) => { try { m.delete(); } catch { /* déjà libérée */ } }); }
}

/** Redresse la feuille (4 coins en fraction) en vue de dessus, puis uniformise le fond pour un rendu « scan ». */
export type ScanMode = 'color' | 'bw';

export function warpAndClean(cv: any, src: CanvasImageSource, sw: number, sh: number, quad: Pt[] | null, mode: ScanMode = 'color'): HTMLCanvasElement {
  const full = document.createElement('canvas');
  const limit = Math.min(1, 2400 / Math.max(sw, sh));
  full.width = Math.round(sw * limit); full.height = Math.round(sh * limit);
  full.getContext('2d')!.drawImage(src, 0, 0, full.width, full.height);
  const mats: any[] = [];
  const M = (m: any) => { mats.push(m); return m; };
  try {
    let mat = M(cv.imread(full));
    if (quad) {
      const q = quad.map((p) => ({ x: p.x * full.width, y: p.y * full.height }));
      const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
      let W = Math.round(Math.max(d(q[0]!, q[1]!), d(q[3]!, q[2]!)));
      let H = Math.round(Math.max(d(q[0]!, q[3]!), d(q[1]!, q[2]!)));
      // une feuille A4 (ratio 1,414) photographiée en biais : on remet exactement le format A4, comme un scanner
      const ratio = Math.max(W, H) / Math.min(W, H);
      if (Math.abs(ratio - 1.4142) < 0.12) { if (H >= W) W = Math.round(H / 1.4142); else H = Math.round(W / 1.4142); }
      const from = M(cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x, p.y])));
      const to = M(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]));
      const tf = M(cv.getPerspectiveTransform(from, to));
      const out = M(new cv.Mat());
      cv.warpPerspective(mat, out, tf, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      mat = out;
    }
    // fond uniformisé : chaque pixel est divisé par l'éclairage local (flou large) → fond blanc, texte net, ombres supprimées
    const rgb = M(new cv.Mat());
    cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
    // l'éclairage est estimé sur une version réduite (8× plus petite) puis agrandie : même résultat, bien plus rapide sur téléphone
    const sm = M(new cv.Mat());
    cv.resize(rgb, sm, new cv.Size(Math.max(1, Math.round(rgb.cols / 8)), Math.max(1, Math.round(rgb.rows / 8))), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(sm, sm, new cv.Size(0, 0), Math.max(3, Math.round(Math.max(sm.cols, sm.rows) / 40)));
    const bg = M(new cv.Mat());
    cv.resize(sm, bg, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR);
    const norm = M(new cv.Mat());
    cv.divide(rgb, bg, norm, 255);
    const result = document.createElement('canvas');
    if (mode === 'bw') {
      // noir et blanc pur (seuil d'Otsu sur le fond uniformisé) : texte noir, fond blanc
      const gray = M(new cv.Mat());
      cv.cvtColor(norm, gray, cv.COLOR_RGB2GRAY);
      const bw = M(new cv.Mat());
      cv.threshold(gray, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.imshow(result, bw);
    } else {
      // « document » : fond blanc pur, texte renforcé, couleurs conservées (courbe de niveaux : noir à 55, blanc à 215)
      const lo = 55, hi = 215, alpha = 255 / (hi - lo);
      const lev = M(new cv.Mat());
      norm.convertTo(lev, -1, alpha, -lo * alpha);
      cv.imshow(result, lev);
    }
    return result;
  } finally { mats.forEach((m) => { try { m.delete(); } catch { /* déjà libérée */ } }); }
}
