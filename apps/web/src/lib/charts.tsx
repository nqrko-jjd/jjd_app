'use client';
import { useId } from 'react';
import { formatEur } from '@jjd/shared';

/* Graphiques SVG légers, sans dépendance. Couleurs = variables du thème. */

const C = {
  ink: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)',
  line: 'var(--line)', primary: 'var(--primary)', ok: 'var(--ok)', crit: 'var(--crit)',
};
const DONUT_PALETTE = ['#d9581f', '#2f6bd0', '#1f9d63', '#c9861d', '#7c5cbf', '#3aa6a6', '#cf4436', '#8a93a6'];

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
          <span className="chart-delta" style={{ color: `var(--${tone})` }}>
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

  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.expenses)));
  const minR = Math.min(0, ...data.map((d) => d.result));
  const maxR = Math.max(0, ...data.map((d) => d.result));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const yR = (v: number) => padT + innerH - ((v - minR) / (maxR - minR || 1)) * innerH;

  const bw = Math.min(slot * 0.34, 26);
  const ticks = [0, 0.5, 1].map((f) => f * max);

  const resultPts = data.map((d, i) => `${padL + slot * (i + 0.5)},${yR(d.result)}`).join(' ');

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
          return (
            <g key={d.month}>
              <rect x={cx - bw - 1} y={y(d.revenue)} width={bw} height={Math.max(0, padT + innerH - y(d.revenue))} rx="2" fill={C.primary} />
              <rect x={cx + 1} y={y(d.expenses)} width={bw} height={Math.max(0, padT + innerH - y(d.expenses))} rx="2" fill="var(--ink-3)" opacity="0.55" />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill={C.ink3}>{monthShort(d.month)}</text>
            </g>
          );
        })}
        <polyline points={resultPts} fill="none" stroke={C.ok} strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={d.month} cx={padL + slot * (i + 0.5)} cy={yR(d.result)} r="2.5" fill={C.ok} />
        ))}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: 'var(--primary)' }} />CA</span>
        <span><i style={{ background: 'var(--ink-3)', opacity: 0.55 }} />Dépenses</span>
        <span><i style={{ background: 'var(--ok)' }} />Résultat</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ barres simples (1 série) */

export function MonthBars({
  data, color = C.primary, height = 200, unit = '',
}: {
  data: { month: string; value: number }[]; color?: string; height?: number; unit?: string;
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
            <g key={d.month}>
              <rect x={cx - bw / 2} y={y(d.value)} width={bw} height={Math.max(0, padT + innerH - y(d.value))} rx="2" fill={color} />
              <text x={cx} y={H - 7} textAnchor="middle" fontSize="10" fill={C.ink3}>{monthShort(d.month)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------ donut */

export function Donut({
  data, size = 190,
}: {
  data: { label: string; total: number }[]; size?: number;
}) {
  const id = useId();
  const total = data.reduce((s, d) => s + Math.abs(d.total), 0) || 1;
  const r = size / 2;
  const stroke = size * 0.16;
  const rr = r - stroke / 2;
  const circ = 2 * Math.PI * rr;
  let acc = 0;
  return (
    <div className="chart-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={r} cy={r} r={rr} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {data.map((d, i) => {
          const frac = Math.abs(d.total) / total;
          const seg = (
            <circle
              key={`${id}-${i}`}
              cx={r} cy={r} r={rr} fill="none"
              stroke={DONUT_PALETTE[i % DONUT_PALETTE.length]}
              strokeWidth={stroke}
              strokeDasharray={`${frac * circ} ${circ}`}
              strokeDashoffset={-acc * circ}
              transform={`rotate(-90 ${r} ${r})`}
            />
          );
          acc += frac;
          return seg;
        })}
      </svg>
      <ul className="chart-donut-legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <i style={{ background: DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
            <span className="l">{d.label}</span>
            <span className="v">{formatEur(d.total)}</span>
          </li>
        ))}
      </ul>
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
