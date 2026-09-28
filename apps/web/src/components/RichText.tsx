'use client';
import { useEffect, useRef, useState } from 'react';

const COLORS = ['#26372f', '#173f34', '#ad4a41', '#c5a35d', '#2f6fb0', '#788078'];

/**
 * Champ de texte enrichi minimal (gras/italique/souligné/couleur) pour les lignes de
 * devis/factures — contentEditable + execCommand plutôt qu'une librairie : suffisant pour ce
 * besoin (pas de listes/tableaux/liens à gérer) et évite une dépendance lourde. La barre d'outils
 * n'apparaît qu'au focus pour ne pas alourdir une liste de plusieurs lignes.
 */
export function RichText({
  value, onChange, placeholder, bold, minHeight, onBlur, autoFocus,
}: {
  value: string; onChange: (html: string) => void; placeholder?: string; bold?: boolean; minHeight?: number;
  onBlur?: () => void; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
    // ne dépend que du montage — autoFocus ne doit jouer qu'à l'ouverture du champ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // contrôlé sans casser le curseur : on ne réécrit le DOM que si la valeur externe diverge
  // vraiment de ce que l'utilisateur est en train de taper (ex. changement de ligne, undo global).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  function exec(cmd: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  }
  // preventDefault sur mousedown : sinon le clic sur le bouton fait perdre la sélection de texte
  // avant que la commande de mise en forme ne s'applique.
  const btn = (cmd: string, label: string, title: string, arg?: string) => (
    <button
      type="button"
      className="rt-btn"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); exec(cmd, arg); }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ position: 'relative' }}>
      {focused && (
        <div className="rt-toolbar" onMouseDown={(e) => e.preventDefault()}>
          {btn('bold', 'G', 'Gras')}
          {btn('italic', 'I', 'Italique')}
          {btn('underline', 'S', 'Souligné')}
          {btn('strikeThrough', 'B', 'Barré')}
          <span className="rt-sep" />
          {btn('insertUnorderedList', '•', 'Liste à puces')}
          {btn('insertOrderedList', '1.', 'Liste numérotée')}
          <span className="rt-sep" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="rt-swatch"
              style={{ background: c }}
              title={`Couleur ${c}`}
              onMouseDown={(e) => { e.preventDefault(); exec('foreColor', c); }}
            />
          ))}
          <input
            type="color"
            className="rt-color-pick"
            title="Autre couleur"
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => exec('foreColor', e.target.value)}
          />
          {btn('removeFormat', '✕', 'Effacer la mise en forme')}
        </div>
      )}
      <div
        ref={ref}
        className="input rt-edit"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ fontWeight: bold ? 700 : undefined, minHeight }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onPaste={(e) => {
          // colle en texte brut : un copier-coller depuis Word/Excel/le web charrie sinon des
          // styles/classes qu'on ne maîtrise pas et que le nettoyage serveur retirerait de toute
          // façon (voir sanitizeLineHtml côté API), mieux vaut ne jamais les afficher.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}
