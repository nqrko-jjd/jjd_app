import type { ReactNode } from 'react';
import {
  WORKSITE_STATUS_LABEL, WORKSITE_PRIORITY_LABEL, ENTITY_LABEL, CRM_STAGE_LABEL, formatEur, formatDateBE,
  type WorksiteStatus, type WorksitePriority,
} from '@jjd/shared';

export { formatEur, formatDateBE };

const STATUS_TONE: Partial<Record<WorksiteStatus, string>> = {
  lead: 'plain',
  to_plan: 'plain',
  scheduled: 'primary',
  in_progress: 'primary',
  done: 'ok',
  invoiced: 'ok',
  closed: 'ok',
  to_invoice: 'warn',
  on_hold: 'warn',
  cancelled: 'crit',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status as WorksiteStatus] ?? '';
  return <span className={`badge ${tone}`}>{WORKSITE_STATUS_LABEL[status as WorksiteStatus] ?? status}</span>;
}

const PRIORITY_TONE: Record<string, string> = { high: 'warn', urgent: 'crit' };
/** N'affiche rien pour normal/low — juste les priorités qui comptent. */
export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority || priority === 'normal' || priority === 'low') return null;
  return <span className={`badge ${PRIORITY_TONE[priority] ?? ''}`}>{WORKSITE_PRIORITY_LABEL[priority as WorksitePriority] ?? priority}</span>;
}

export function EntityBadge({ entity }: { entity: string }) {
  return <span className="badge">{ENTITY_LABEL[entity as keyof typeof ENTITY_LABEL] ?? entity}</span>;
}

export function stageLabel(s: string) {
  return CRM_STAGE_LABEL[s as keyof typeof CRM_STAGE_LABEL] ?? s;
}

export function Money({ value, sign = false }: { value: number | null | undefined; sign?: boolean }) {
  const neg = (value ?? 0) < 0;
  return <span className={`tnum${neg && sign ? ' neg' : ''}`} style={neg && sign ? { color: 'var(--crit)' } : undefined}>{formatEur(value)}</span>;
}

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Petite vignette ronde (photo ou initiales) pour les listes. */
export function Avatar({ src, label, size = 26 }: { src?: string | null; label: string; size?: number }) {
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return (
    <span
      style={{
        display: 'inline-flex', width: size, height: size, borderRadius: '50%', flexShrink: 0,
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
        background: 'var(--surface-2)', border: '1px solid var(--line)', marginRight: 8,
        fontSize: size * 0.4, fontWeight: 700, color: 'var(--ink-3)',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : initials}
    </span>
  );
}

/** Vignette rectangulaire (véhicule) pour les listes. */
export function Thumb({ src, size = 40 }: { src?: string | null; size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', width: size * 1.4, height: size, borderRadius: 6, flexShrink: 0,
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
        background: 'var(--surface-2)', border: '1px solid var(--line)', marginRight: 8,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : <span style={{ fontSize: size * 0.5 }}>🚐</span>}
    </span>
  );
}
