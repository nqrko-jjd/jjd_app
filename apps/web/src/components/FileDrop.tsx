'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Zone de dépôt de fichier (glisser-déposer + clic pour parcourir).
 * `file` = fichier sélectionné non encore envoyé ; `existingUrl` = pièce déjà
 * jointe (URL blob) à afficher tant qu'aucun nouveau fichier n'est choisi.
 */
export function FileDrop({
  file,
  onFile,
  existingUrl,
  accept = 'application/pdf,image/*',
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  existingUrl?: string | null;
  accept?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [file]);

  function take(f: File | undefined | null) {
    if (f) onFile(f);
  }

  return (
    <div
      className={`filedrop${over ? ' over' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (disabled) return; e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click(); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
      />
      {file ? (
        <div className="filedrop-row">
          {preview ? <img src={preview} alt="" /> : <span className="filedrop-ic">📄</span>}
          <span className="filedrop-name">{file.name}</span>
          {!disabled && (
            <button type="button" className="btn ghost" onClick={(e) => { e.stopPropagation(); onFile(null); }} aria-label="Retirer">✕</button>
          )}
        </div>
      ) : existingUrl ? (
        <div className="filedrop-row">
          <span className="filedrop-ic">📎</span>
          <a href={existingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Voir la pièce jointe</a>
          {!disabled && <span className="muted" style={{ fontSize: '0.8rem' }}>· glisser un fichier pour remplacer</span>}
        </div>
      ) : (
        <div className="filedrop-row filedrop-empty">
          <span className="filedrop-ic">⬆</span>
          <div>
            <strong>Glisser un PDF ou une photo ici</strong>
            <div className="muted" style={{ fontSize: '0.8rem' }}>ou cliquer pour parcourir</div>
          </div>
        </div>
      )}
    </div>
  );
}
