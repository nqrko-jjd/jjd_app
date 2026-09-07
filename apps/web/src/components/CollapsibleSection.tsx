'use client';
import { useState } from 'react';

/**
 * Section de fiche repliée par défaut : un résumé toujours visible (compte,
 * total…), le détail (tableau…) derrière un clic. Évite de charger visuellement
 * la fiche (chantier, ouvrier…) avec des tableaux qui peuvent être longs.
 */
export function CollapsibleSection({
  title, icon, hint, summary, defaultOpen = false, children,
}: {
  title: string;
  icon?: string;
  hint?: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card card-pad collapsible" style={{ marginBottom: '1.5rem' }}>
      <button type="button" className="collapsible-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`collapsible-chevron${open ? ' open' : ''}`}>▸</span>
        {icon && <span aria-hidden>{icon}</span>}
        <span className="collapsible-title">{title}</span>
        {hint && <span className="hint">{hint}</span>}
        {summary && <span className="collapsible-summary">{summary}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
