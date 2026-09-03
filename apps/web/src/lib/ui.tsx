import type { ReactNode } from 'react';
import {
  WORKSITE_STATUS_LABEL, ENTITY_LABEL, CRM_STAGE_LABEL, formatEur, formatDateBE,
  type WorksiteStatus,
} from '@jjd/shared';

export { formatEur, formatDateBE };

const STATUS_TONE: Partial<Record<WorksiteStatus, string>> = {
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
