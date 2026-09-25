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

  const valueRef = useRef('');
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const isEditable = (el: Element | null) => {
    const a = el as HTMLElement | null;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  };
  const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  // Garde le focus sur le champ : la gâchette doit toujours tomber ici. Sur un terminal tactile, un clic sur un bouton
  // (« Réceptionner »…) donne le focus au bouton : on le rend aussitôt au champ de scan.
  useEffect(() => {
    if (camera) return;
    const refocus = () => {
      const a = document.activeElement;
      if (a === ref.current) return;
      if (!a || a === document.body || (isTouch() && !isEditable(a))) ref.current?.focus({ preventScroll: true });
    };
    refocus();
    const id = setInterval(refocus, 800);
    const onClick = () => setTimeout(refocus, 40);
    window.addEventListener('click', onClick);
    return () => { clearInterval(id); window.removeEventListener('click', onClick); };
  }, [camera]);

  // Filet de sécurité : une touche tapée alors que le focus est ailleurs (bouton, liste…) — c'est la gâchette de la Zebra
  // en mode clavier — est redirigée vers le champ de scan, qui applique sa logique habituelle (Entrée ou silence).
  useEffect(() => {
    if (camera) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t === ref.current || isEditable(t)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        if (valueRef.current.trim().length >= 3) { e.preventDefault(); submitRef.current(valueRef.current); }
        return;
      }
      if (e.key.length !== 1) return;
      e.preventDefault();
      ref.current?.focus({ preventScroll: true });
      const next = valueRef.current + e.key;
      valueRef.current = next; // plusieurs touches peuvent arriver avant le rendu React
      onChangeRef.current(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
