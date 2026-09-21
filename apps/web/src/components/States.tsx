'use client';
import { useState, type ReactNode } from 'react';
import { Inbox, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Squelette de liste : lignes à la hauteur finale, pour éviter le saut de mise en page. */
export function SkeletonRows({ rows = 6, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="skel-list" role="status" aria-label="Chargement en cours">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

/** État vide : icône, titre, une phrase d'explication, une action primaire + une secondaire. */
export function EmptyState({
  icon: Icon = Inbox, title, text, action, secondary,
}: { icon?: LucideIcon; title: string; text: string; action?: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="state">
      <div className="ic"><Icon size={22} strokeWidth={1.8} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {(action || secondary) && <div className="acts">{action}{secondary}</div>}
    </div>
  );
}

/** Cause en clair à partir du message technique remonté par l'API / le réseau. */
function plainCause(message: string): string {
  if (/failed to fetch|network|load failed/i.test(message)) return 'La connexion au serveur a échoué. Vérifiez votre réseau puis réessayez.';
  if (/erreur 5\d\d|unexpected token|<html|json/i.test(message)) return 'Le serveur ne répond pas correctement pour le moment. Réessayez dans un instant.';
  if (/erreur 401|erreur 403|non autoris|session/i.test(message)) return 'Votre session a expiré ou vos droits ne suffisent pas pour cette page.';
  return message;
}

/** Erreur de chargement : carte critique, cause en clair, « Réessayer » + « Détails techniques ».
 *  Les filtres de la page restent affichés au-dessus (l'état s'insère à la place de la liste). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="state error" role="alert">
      <div className="ic"><AlertTriangle size={22} strokeWidth={1.8} /></div>
      <h3>Impossible de charger ces données</h3>
      <p>{plainCause(message)}</p>
      <div className="acts">
        {onRetry && <button type="button" className="btn primary" onClick={onRetry}>Réessayer</button>}
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}>{open ? 'Masquer les détails' : 'Détails techniques'}</button>
      </div>
      {open && <pre className="tech">{message}</pre>}
    </div>
  );
}

/** Bandeau de résultat : succès (vert, résultat chiffré + lien vers la suite) ou blocage (doré/rouge,
 *  nomme le champ et l'étape concernés). */
export function Banner({
  tone, title, children, action, onClose,
}: { tone: 'success' | 'warn' | 'crit'; title?: string; children?: ReactNode; action?: ReactNode; onClose?: () => void }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warn' ? ShieldAlert : AlertTriangle;
  return (
    <div className={`banner ${tone}`} role={tone === 'success' ? 'status' : 'alert'}>
      <Icon size={18} strokeWidth={2} />
      <div className="txt">
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {action}
      {onClose && <button type="button" className="banner-x" onClick={onClose} aria-label="Fermer">✕</button>}
    </div>
  );
}

/** Message sous le champ concerné (à associer à `.field.error` ou `.input.error`). */
export function FieldError({ children }: { children: ReactNode }) {
  return <div className="field-error" role="alert">{children}</div>;
}
