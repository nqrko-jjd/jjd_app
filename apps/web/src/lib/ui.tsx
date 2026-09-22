import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  WORKSITE_STATUS_LABEL, WORKSITE_PRIORITY_LABEL, WORKSITE_SCOPE_LABEL, WORKSITE_BILLING_MODE_LABEL,
  ENTITY_LABEL, CRM_STAGE_LABEL, formatEur, formatDateBE,
  VEHICLE_STATUS_LABEL, type WorksiteStatus, type WorksitePriority, type WorksiteScope, type WorksiteBillingMode, type VehicleStatus,
} from '@jjd/shared';

export { formatEur, formatDateBE };

/** Tuile KPI standard (grille `.kpis`) — icône à droite du libellé, sous-texte toujours
 * rempli (fournir un texte de repli plutôt que de laisser `sub` vide), comme la maquette. */
export function Kpi({ ic: Ic, label, value, sub, hero, warn, neg, history }: {
  ic: LucideIcon; label: string; value: ReactNode; sub?: string; hero?: boolean; warn?: boolean; neg?: boolean;
  /** Petit historique en barres (ex. 6 derniers mois) affiché dans la tuile ; la dernière barre = période en cours. */
  history?: { label: string; value: number }[];
}) {
  const max = history ? Math.max(1, ...history.map((h) => Math.abs(h.value))) : 1;
  return (
    <div className={`kpi${hero ? ' hero' : ''}${warn ? ' warn' : ''}`}>
      <div className="kpi-head">
        <div className="label">{label}</div>
        <span className="ic"><Ic size={16} strokeWidth={2} /></span>
      </div>
      <div className={`value${neg ? ' neg' : ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
      {history && history.length > 1 && (
        <div className="kpi-history" aria-label="Historique des 6 derniers mois">
          {history.map((h, i) => (
            <div key={h.label} className={`bar${i === history.length - 1 ? ' cur' : ''}`} title={`${h.label} · ${Math.round(h.value).toLocaleString('fr-BE')} €`}>
              <span style={{ height: `${Math.max(6, (Math.abs(h.value) / max) * 100)}%` }} />
              <em>{h.label}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

/** N'affiche rien tant que non classé (informatif, la plupart des chantiers historiques ne
 *  le sont pas encore). */
export function ScopeBadge({ scope }: { scope: string | null | undefined }) {
  if (!scope) return null;
  return <span className="badge plain">{WORKSITE_SCOPE_LABEL[scope as WorksiteScope] ?? scope}</span>;
}

export function BillingModeBadge({ billingMode }: { billingMode: string | null | undefined }) {
  if (!billingMode) return null;
  return <span className="badge plain">{WORKSITE_BILLING_MODE_LABEL[billingMode as WorksiteBillingMode] ?? billingMode}</span>;
}

const VEHICLE_STATUS_TONE: Partial<Record<VehicleStatus, string>> = {
  active: 'ok',
  repair: 'warn',
  breakdown: 'crit',
  sold: 'plain',
  retired: 'plain',
};

export function VehicleStatusBadge({ status }: { status: string }) {
  const tone = VEHICLE_STATUS_TONE[status as VehicleStatus] ?? '';
  return <span className={`badge ${tone}`}>{VEHICLE_STATUS_LABEL[status as VehicleStatus] ?? status}</span>;
}

export function stageLabel(s: string) {
  return CRM_STAGE_LABEL[s as keyof typeof CRM_STAGE_LABEL] ?? s;
}

export function Money({ value, sign = false }: { value: number | null | undefined; sign?: boolean }) {
  const neg = (value ?? 0) < 0;
  return <span className={`tnum${neg && sign ? ' neg' : ''}`} style={neg && sign ? { color: 'var(--crit)' } : undefined}>{formatEur(value)}</span>;
}

export function PageHead({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/** Barre d'avancement compacte pour une cellule de tableau (liste de chantiers…). */
export function ProgressCell({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 90 }}>
      <div className="progress-bar" style={{ flex: 1 }}>
        <div className="progress-fill" style={{ width: `${clamped}%` }} />
      </div>
      <span className="tnum muted" style={{ fontSize: '0.78rem', width: '2.4em', textAlign: 'right' }}>{clamped}%</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Petite vignette ronde (photo, initiales, ou texte court affiché tel quel via `raw` — ex.
 *  un numéro de chantier "556" que le calcul d'initiales réduirait à "5"). */
export function Avatar({ src, label, size = 26, raw }: { src?: string | null; label: string; size?: number; raw?: boolean }) {
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const text = raw ? label.slice(0, 4) : initials;
  return (
    <span
      style={{
        display: 'inline-flex', width: size, height: size, borderRadius: '50%', flexShrink: 0,
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
        background: 'var(--surface-2)', border: '1px solid var(--line)', marginRight: 8,
        fontSize: raw ? size * 0.32 : size * 0.4, fontWeight: 700, color: 'var(--ink-3)',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : text}
    </span>
  );
}

/** Vignette rectangulaire (véhicule) pour les listes. */
export function Thumb({ src, size = 40, icon: Icon }: { src?: string | null; size?: number; icon?: LucideIcon }) {
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
      ) : Icon ? (
        <Icon size={size * 0.5} strokeWidth={1.8} color="var(--ink-3)" />
      ) : <span style={{ fontSize: size * 0.5 }}>🚐</span>}
    </span>
  );
}

/** Plaque belge (bandeau UE bleu à étoiles + « B », texte rouge, double liseré noir/rouge) —
 *  identifie un véhicule d'un coup d'œil, mieux qu'une icône générique. SVG à viewBox fixe :
 *  `size` (hauteur en px) définit juste la taille de rendu, tout le dessin reste net. */
export function PlateBE({ plate, size = 26 }: { plate: string; size?: number }) {
  const text = plate.toUpperCase();
  const chars = text.replace(/[^A-Z0-9]/g, '').length || 1;
  // la police rétrécit pour les plaques longues, plafonnée pour ne pas être ridicule sur "LEJ7"
  const fontSize = Math.max(22, Math.min(46, 335 / (chars * 0.62)));
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return { cx: 41 + Math.cos(a) * 16, cy: 38 + Math.sin(a) * 16 };
  });
  return (
    <svg
      width={size * 4.6} height={size} viewBox="0 0 460 100" role="img" aria-label={`Plaque ${text}`}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <rect x="2" y="2" width="456" height="96" rx="12" fill="#fff" stroke="#1a1a1a" strokeWidth="2.5" />
      <rect x="7" y="7" width="446" height="86" rx="9" fill="none" stroke="#c8102e" strokeWidth="4" />
      <path d="M9 18 a10 10 0 0 1 10-10 h53 v84 h-53 a10 10 0 0 1 -10-10 z" fill="#039" />
      {stars.map((s, i) => <circle key={i} cx={s.cx} cy={s.cy} r="1.9" fill="#ffcc00" />)}
      <text x="41" y="80" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={800} fontSize="27" fill="#fff">B</text>
      <text
        x="267" y="66" textAnchor="middle" dominantBaseline="middle"
        fontFamily="Arial, Helvetica, sans-serif" fontWeight={800} fontSize={fontSize} letterSpacing="1.5"
        fill="#c8102e"
      >
        {text}
      </text>
    </svg>
  );
}
