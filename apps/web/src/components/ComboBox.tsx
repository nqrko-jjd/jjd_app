'use client';
import { useId } from 'react';

export interface ComboOption {
  value: string;
  label: string;
}

/**
 * Champ de saisie avec autocomplétion (datalist natif) — pour les longues listes
 * (chantiers, fournisseurs) où un <select> de centaines d'options est lourd.
 * `onChange` émet la `value` de l'option choisie, ou (si `allowFree`) le texte brut.
 */
export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  style,
  allowFree,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  style?: React.CSSProperties;
  allowFree?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const current = options.find((o) => o.value === value);
  return (
    <>
      <input
        className="input"
        list={id}
        style={style}
        placeholder={placeholder}
        disabled={disabled}
        defaultValue={current?.label ?? (allowFree ? value : '')}
        onChange={(e) => {
          const txt = e.target.value;
          const hit = options.find((o) => o.label === txt);
          onChange(hit ? hit.value : allowFree ? txt : '');
        }}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o.value} value={o.label} />
        ))}
      </datalist>
    </>
  );
}
