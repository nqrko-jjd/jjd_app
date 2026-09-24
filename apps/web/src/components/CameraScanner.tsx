'use client';
import { useEffect, useRef, useState } from 'react';

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * Lecture par caméra (smartphone / tablette sans lecteur physique). Utilise le détecteur natif du
 * navigateur quand il existe (Chrome/Android : rapide), sinon ZXing (iPhone, autres). Le même code
 * n'est pas renvoyé deux fois de suite dans les 1,5 s, pour pouvoir enchaîner plusieurs articles
 * sans fermer la caméra. Nécessite HTTPS (ou localhost).
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
    let controls: { stop: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Map<string, number>();

    function emit(code: string) {
      const now = Date.now();
      if ((seen.get(code) ?? 0) + 1500 > now) return;
      seen.set(code, now);
      setLast(code);
      onScanRef.current(code);
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-media');
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          const video = videoRef.current!;
          video.srcObject = stream;
          await video.play();
          const det = new BD({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'data_matrix'] });
          const loop = async () => {
            if (stopped) return;
            try {
              const found = await det.detect(video);
              if (found[0]) emit(found[0].rawValue);
            } catch { /* frame illisible : on réessaie */ }
            timer = setTimeout(loop, 180);
          };
          loop();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: 'environment' }, audio: false },
            videoRef.current!,
            (result) => { if (result) emit(result.getText()); },
          );
        }
      } catch {
        if (!stopped) setErr('Caméra indisponible : autorisez l’accès à la caméra (et utilisez le site en https).');
      }
    }
    start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Scanner avec la caméra</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
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
            {last ? <>Dernier code lu : <strong className="mono">{last}</strong></> : 'Visez le code-barres ou le QR code de l’étiquette.'}
          </div>
        </div>
        <div className="modal-foot"><button type="button" className="btn primary" onClick={onClose}>Terminer</button></div>
      </div>
    </div>
  );
}
