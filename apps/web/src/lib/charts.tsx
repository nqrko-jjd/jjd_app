'use client';
import { formatEur } from '@jjd/shared';

/* Graphiques SVG légers, sans dépendance. Couleurs = variables du thème. */

const C = {
  ink: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)',
  line: 'var(--line)', primary: 'var(--primary)', gold: 'var(--gold)', strong: 'var(--line-strong)', ok: 'var(--ok)', crit: 'var(--crit)',
};

const eurShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)} M`;
  if (a >= 1_000) return `${Math.round(n / 1000)} k`;
  return String(Math.round(n));
};
const monthShort = (k: string) => {
  const [y, m] = k.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-BE', { month: 'short' }).replace('.', '');
};

/* ------------------------------------------------------------ tuile à tendance */

export function TrendTile({
  label, value, delta, deltaSuffix = '', invert = false, sub,
}: {
  label: string; value: string; delta?: number | null; deltaSuffix?: string; invert?: boolean; sub?: string;
}) {
  const up = (delta ?? 0) > 0;
  const good = delta == null ? null : invert ? !up : up;
  const tone = good == null ? 'ink3' : good ? 'ok' : 'crit';
  return (
    <div className="chart-tile">
      <div className="chart-tile-label">{label}</div>
      <div className="chart-tile-value">{value}</div>
      <div className="chart-tile-foot">
        {delta != null && Number.isFinite(delta) && (
          <span className={`chart-delta ${tone}`}>
            {up ? '▲' : delta < 0 ? '▼' : '·'} {Math.abs(delta).toLocaleString('fr-BE', { maximumFractionDigits: 1 })}{deltaSuffix}
          </span>
        )}
        {sub && <span className="chart-tile-sub">{sub}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------ CA / dépenses / résultat par mois */

export function RevenueChart({
  data, height = 260,
}: {
  data: { month: string; revenue: number; expenses: number; result: number }[];
  height?: number;
}) {
  const W = 720;
  const H = height;
  const padL = 44;
  const padB = 26;
  const padT = 12;
  const innerW = W - padL - 8;
  const innerH = H - padB - padT;
  const n = Math.max(data.length, 1);
  const slot = innerW / n;

  // échelle commune aux trois séries, ligne de base à 0 (le résultat peut être négatif)
  const vals = data.flatMap((d) => [d.revenue, d.expenses, d.result]);
  const top = Math.max(1, ...vals);
  const bottom = Math.min(0, ...vals);
  const range = top - bottom || 1;
  const y = (v: number) => padT + innerH - ((v - bottom) / range) * innerH;
  const y0 = y(0);

  const bw = Math.min(slot * 0.26, 18);
  const ticks = [bottom, 0, top].filter((t, i, a) => a.indexOf(t) === i);

  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="CA, dépenses et résultat par mois">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} stroke={C.line} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={C.ink3}>{eurShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * (i + 0.5);
          const bar = (v: number, x: number, fill: string) => (
            <rect x={x} y={Math.min(y(v), y0)} width={bw} height={Math.abs(y(v) - y0)} rx="2" fill={fill} />
          );
          return (
            <g key={d.month}>
              {bar(d.revenue, cx - bw * 1.5 - 1, C.primary)}
              {bar(d.expenses, cx - bw * 0.5, C.strong)}
              {bar(d.result, cx + bw * 0.5 + 1, C.gold)}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill={C.ink3}>{monthShort(d.month)}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: C.primary }} />CA</span>
        <span><i style={{ background: C.strong }} />Dépenses</span>
        <span><i style={{ background: C.gold }} />Résultat</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ barres simples (1 série) */

export function MonthBars({
  data, color = C.primary, height = 200, unit = '',
}: {
  data: { month: string; value: number; tooltip?: string }[]; color?: string; height?: number; unit?: string;
}) {
  const W = 640, H = height, padL = 38, padB = 24, padT = 10;
  const innerW = W - padL - 6, innerH = H - padB - padT;
  const n = Math.max(data.length, 1);
  const slot = innerW / n;
  const max = Math.max(1, ...data.map((d) => d.value));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const bw = Math.min(slot * 0.55, 30);
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {[0, 0.5, 1].map((f, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 4} y1={y(f * max)} y2={y(f * max)} stroke={C.line} />
            <text x={padL - 6} y={y(f * max) + 3} textAnchor="end" fontSize="10" fill={C.ink3}>{eurShort(f * max)}{unit}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * (i + 0.5);
          return (
            <g key={d.month} style={{ cursor: d.tooltip ? 'pointer' : undefined }}>
              {d.tooltip && <title>{d.tooltip}</title>}
              <rect
                x={cx - bw / 2} y={y(d.value)} width={bw} height={Math.max(0, padT + innerH - y(d.value))} rx="2" fill={color}
                className={d.tooltip ? 'chart-bar-hover' : undefined}
              />
              <text x={cx} y={H - 7} textAnchor="middle" fontSize="10" fill={C.ink3}>{monthShort(d.month)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------ barre empilée (remplace le donut) */

/** Palette sobre de la charte : vert / or / gris-vert (pas de bleu). */
const STACK_PALETTE = ['var(--primary)', 'var(--gold)', 'var(--line-strong)'];

/** Répartition en une seule barre 100 % + légende (libellé, montant, part). */
export function StackedBar({ data }: { data: { label: string; total: number }[] }) {
  const total = data.reduce((s, d) => s + Math.abs(d.total), 0) || 1;
  return (
    <div className="stackbar">
      <div className="stackbar-track" role="img" aria-label={data.map((d) => `${d.label} ${Math.round((Math.abs(d.total) / total) * 100)} %`).join(', ')}>
        {data.map((d, i) => (
          <span
            key={d.label}
            style={{ width: `${(Math.abs(d.total) / total) * 100}%`, background: STACK_PALETTE[i % STACK_PALETTE.length] }}
            title={`${d.label} · ${formatEur(d.total)}`}
          />
        ))}
      </div>
      <ul className="stackbar-legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <i style={{ background: STACK_PALETTE[i % STACK_PALETTE.length] }} />
            <span className="l">{d.label}</span>
            <span className="v">{formatEur(d.total)}</span>
            <span className="p">{Math.round((Math.abs(d.total) / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Blocs de progression à plusieurs barres (ex. Avancement : facturé / encaissé / coûts engagés). */
export function ProgressBars({ rows }: { rows: { label: string; value: number; of: number; tone?: 'primary' | 'gold' | 'muted'; note?: string }[] }) {
  return (
    <div className="progbars">
      {rows.map((r) => {
        const pct = r.of > 0 ? Math.max(0, Math.round((r.value / r.of) * 100)) : 0;
        return (
          <div key={r.label} className="progbar">
            <div className="hd"><span>{r.label}</span><strong>{pct} %</strong></div>
            <div className="track"><span className={r.tone ?? 'primary'} style={{ width: `${Math.min(100, pct)}%` }} /></div>
            <div className="ft">{r.note ?? `${formatEur(r.value)} sur ${formatEur(r.of)}`}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ barres horizontales */

export function HBars({
  rows, format = (n: number) => formatEur(n), max: forcedMax,
}: {
  rows: { label: string; value: number; hint?: string }[]; format?: (n: number) => string; max?: number;
}) {
  const max = forcedMax ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="chart-hbars">
      {rows.map((r) => (
        <div key={r.label} className="chart-hbar">
          <span className="lbl" title={r.label}>{r.label}</span>
          <span className="track">
            <span
              className="fill"
              style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.value < 0 ? C.crit : C.primary }}
            />
          </span>
          <span className="val">{format(r.value)}{r.hint ? <em> {r.hint}</em> : null}</span>
        </div>
      ))}
    </div>
  );
}
