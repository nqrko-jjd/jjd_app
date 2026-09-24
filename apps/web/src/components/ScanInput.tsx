'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, ScanLine } from 'lucide-react';
import { CameraScanner } from './CameraScanner';

/**
 * Champ de scan « toujours actif » : la gâchette d'un terminal Zebra (DataWedge en mode clavier)
 * « tape » le code dans ce champ ; la lecture est validée à la touche Entrée, ou à la fin d'une
 * rafale de caractères tapés très vite (une douchette n'envoie pas toujours Entrée). Un smartphone
 * scanne avec la caméra (bouton). Le clavier à l'écran est masqué par défaut pour ne pas
 * recouvrir l'écran à chaque gâchette — le bouton clavier permet de taper un code à la main.
 */
export function ScanInput({
  onScan, placeholder = 'Scannez un article…', hint, cameraMulti = true,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  hint?: string;
  /** La caméra reste ouverte après une lecture (préparation de commande : on enchaîne les articles). */
  cameraMulti?: boolean;
}) {
  const [value, setValue] = useState('');
  const [typing, setTyping] = useState(false); // clavier à l'écran autorisé
  const [camera, setCamera] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const stamps = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function submit(raw: string) {
    const code = raw.trim();
    stamps.current = [];
    clearTimeout(timer.current);
    setValue('');
    if (code) onScan(code);
  }

  function onChange(v: string) {
    setValue(v);
    stamps.current.push(Date.now());
    clearTimeout(timer.current);
    // rafale = ≥ 4 caractères à moins de 50 ms d'écart en moyenne → lecture de douchette, pas une frappe humaine
    // Terminal tactile (Zebra, smartphone) : le clavier est masqué, tout ce qui arrive dans le champ vient donc de la
    // gâchette — on valide après un court silence, même si DataWedge n'envoie pas « Entrée » ou tape lentement.
    const touch = !typing && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (touch && /^\d{13}$/.test(v)) { submit(v); return; } // EAN-13 complet : inutile d'attendre
    timer.current = setTimeout(() => {
      const t = stamps.current;
      if (touch && v.length >= 5) submit(v);
      else if (v.length >= 4 && t.length >= 4 && (t[t.length - 1]! - t[0]!) / (t.length - 1) < 50) submit(v);
      else stamps.current = [];
    }, touch ? 350 : 140);
  }

  // Garde le focus sur le champ tant que rien d'autre n'est en cours de saisie : la gâchette doit toujours tomber ici.
  useEffect(() => {
    if (camera) return;
    const refocus = () => {
      const a = document.activeElement;
      if (!a || a === document.body) ref.current?.focus({ preventScroll: true });
    };
    refocus();
    const id = setInterval(refocus, 800);
    return () => clearInterval(id);
  }, [camera]);

  // Filet de sécurité : si le focus est ailleurs (bouton cliqué, liste, etc.), la rafale de la gâchette ne doit pas se perdre.
  // On écoute donc aussi le clavier de la page (hors champs de saisie) et on reconnaît une rafale de douchette.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (camera) return;
    let buf = '';
    let n = 0;
    let first = 0;
    let last = 0;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { buf = ''; n = 0; };
    const isBurst = () => buf.length >= 4 && n >= 4 && (last - first) / (n - 1) < 50;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t === ref.current) return; // le champ de scan gère déjà sa propre saisie
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        clearTimeout(quiet);
        if (isBurst()) { e.preventDefault(); const c = buf; reset(); submitRef.current(c); } else reset();
        return;
      }
      if (e.key.length !== 1) return;
      const now = Date.now();
      if (now - last > 100) { reset(); first = now; }
      buf += e.key;
      n += 1;
      last = now;
      clearTimeout(quiet);
      quiet = setTimeout(() => { if (isBurst()) { const c = buf; reset(); submitRef.current(c); } else reset(); }, 140);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(quiet); };
  }, [camera]);

  return (
    <>
      {camera && (
        <CameraScanner
          onScan={(c) => { onScan(c); if (!cameraMulti) setCamera(false); }}
          onClose={() => setCamera(false)}
        />
      )}
      <div className="scan-bar">
        <ScanLine size={26} strokeWidth={2} className="scan-bar-ic" />
        <input
          ref={ref}
          className="scan-bar-input"
          value={value}
          inputMode={typing ? 'text' : 'none'}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={placeholder}
          aria-label="Champ de scan"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(value); } }}
        />
        <button type="button" className={`scan-bar-btn${typing ? ' on' : ''}`} onClick={() => { setTyping((t) => !t); ref.current?.focus(); }} title="Saisir un code à la main" aria-label="Saisir un code à la main">
          <Keyboard size={20} />
        </button>
        <button type="button" className="scan-bar-btn cam" onClick={() => setCamera(true)} title="Scanner avec la caméra" aria-label="Scanner avec la caméra">
          <Camera size={20} /> <span>Caméra</span>
        </button>
      </div>
      {hint && <div className="muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0 0.9rem' }}>{hint}</div>}
    </>
  );
}
