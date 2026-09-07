'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Zone de signature tactile/souris — canvas nu, sans dépendance externe
 * (l'équivalent mobile utilise react-native-signature-canvas, indisponible
 * sur web). `onEmpty` prévient si on tente de valider sans avoir dessiné.
 */
export function SignaturePad({ onDone, onEmpty }: { onDone: (dataUrl: string) => void; onEmpty: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [empty, setEmpty] = useState(true);

  function ctx() {
    return canvasRef.current?.getContext('2d') ?? null;
  }

  function resize() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const c = ctx();
    if (!c) return;
    c.scale(ratio, ratio);
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#1c2b25';
  }

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    const c = ctx();
    if (!c) return;
    const p = point(e);
    c.beginPath();
    c.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const c = ctx();
    if (!c) return;
    const p = point(e);
    c.lineTo(p.x, p.y);
    c.stroke();
    dirty.current = true;
    if (empty) setEmpty(false);
  }
  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    setEmpty(true);
  }

  function confirm() {
    if (!dirty.current || !canvasRef.current) { onEmpty(); return; }
    onDone(canvasRef.current.toDataURL('image/png'));
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 220, touchAction: 'none', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, cursor: 'crosshair' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="row" style={{ marginTop: '0.7rem', justifyContent: 'space-between' }}>
        <button type="button" className="btn" onClick={clear}>Effacer</button>
        <button type="button" className="btn primary" onClick={confirm} disabled={empty}>Valider la signature</button>
      </div>
    </div>
  );
}
