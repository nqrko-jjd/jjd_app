'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useRef, useState } from 'react';

type Detector = { detect: (v: CanvasImageSource) => Promise<{ rawValue: string }[]> };

// Doit correspondre à .cam-aim (globals.css) : la zone de visée affichée à l'écran.
const AIM = { top: 0.22, bottom: 0.22, left: 0.12, right: 0.12 };

/**
 * Lecture par caméra (smartphone / tablette sans lecteur physique). Utilise le détecteur natif du
 * navigateur quand il existe (Chrome/Android : rapide), sinon ZXing (iPhone, autres). Le même code
 * n'est pas renvoyé deux fois de suite dans les 1,5 s, pour pouvoir enchaîner plusieurs articles
 * sans fermer la caméra. Nécessite HTTPS (ou localhost).
 *
 * Décode uniquement la zone de visée (recadrée, agrandie 1,5×) plutôt que l'image entière : un
 * code-barres d'emballage n'occupe souvent qu'une petite partie du cadre large-angle du
 * téléphone — le décodeur dispose ainsi de bien plus de pixels sur le code lui-même, au lieu de
 * « gâcher » sa résolution sur tout le reste de l'image (fond, mains, étagères…). Constaté en
 * prod le 2026-10-01 : lectures erratiques/erronées sur un code noir-sur-blanc pourtant net à
 * l'œil, alors qu'un code bleu plus contrasté passait sans souci.
 */
export function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Map<string, number>();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function emit(code: string) {
      const now = Date.now();
      if ((seen.get(code) ?? 0) + 1500 > now) return;
      seen.set(code, now);
      setLast(code);
      onScanRef.current(code);
    }

    /** Recadre la zone de visée du flux vidéo courant sur le canvas, agrandie pour plus de détail. */
    function captureAim(video: HTMLVideoElement): HTMLCanvasElement | null {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!ctx || !vw || !vh) return null;
      const sx = vw * AIM.left;
      const sy = vh * AIM.top;
      const sw = vw * (1 - AIM.left - AIM.right);
      const sh = vh * (1 - AIM.top - AIM.bottom);
      const scale = 1.5;
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-media');
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        // Haute résolution des deux côtés : la zone de visée n'étant qu'une partie du cadre, un
        // flux vidéo par défaut (souvent 640×480) laisserait trop peu de pixels sur le code.
        const videoConstraints = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        if (BD) {
          const det = new BD({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'data_matrix'] });
          const loop = async () => {
            if (stopped) return;
            try {
              const aim = captureAim(video);
              if (aim) { const found = await det.detect(aim); if (found[0]) emit(found[0].rawValue); }
            } catch { /* frame illisible : on réessaie */ }
            timer = setTimeout(loop, 180);
          };
          loop();
        } else {
          const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([
            import('@zxing/browser'),
            import('@zxing/library'),
          ]);
          // TRY_HARDER : passe plus lente mais bien plus tolérante (angle, distance, contraste) —
          // sans ça, ZXing (seul décodeur dispo sur iOS/Safari, pas de BarcodeDetector natif) rate
          // beaucoup de codes-barres réels pourtant lisibles à l'œil.
          const hints = new Map();
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints);
          const loop = () => {
            if (stopped) return;
            try {
              const aim = captureAim(video);
              if (aim) emit(reader.decodeFromCanvas(aim).getText());
            } catch { /* rien trouvé sur cette image : on réessaie */ }
            timer = setTimeout(loop, 150);
          };
          loop();
        }
      } catch {
        if (!stopped) setErr('Caméra indisponible : autorisez l’accès à la caméra (et utilisez le site en https).');
      }
    }
    start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Scanner avec la caméra</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div style={{ padding: '1rem' }}>
          {err ? (
            <div className="badge crit" style={{ padding: '0.6rem 0.8rem' }}>{err}</div>
          ) : (
            <div className="cam-frame">
              <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block', borderRadius: 12, background: '#000' }} />
              <div className="cam-aim" />
            </div>
          )}
          <div className="muted" style={{ marginTop: '0.6rem', fontSize: '0.85rem', minHeight: '1.2rem' }}>
            {last ? <>Dernier code lu : <strong className="mono">{last}</strong></> : 'Visez le code-barres ou le QR code dans le cadre.'}
          </div>
        </div>
        <div className="modal-foot"><button type="button" className="btn primary" onClick={onClose}>{tr("Terminer")}</button></div>
      </div>
    </div>
  );
}
