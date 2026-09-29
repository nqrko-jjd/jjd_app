'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Row { personId: string; name: string; days: number; amount: number; payoutAmount: number }
interface Team { year: number; month: number; totalAmount: number; totalPayoutAmount: number; rows: Row[] }

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const fmtEur = (n: number) => new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(n);

function Inner() {
  const sp = useSearchParams();
  const now = new Date();
  const year = Number(sp.get('year') ?? now.getFullYear());
  const month = Number(sp.get('month') ?? now.getMonth() + 1);
  const [team, setTeam] = useState<Team | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Team>(`/api/statements?year=${year}&month=${month}`)
      .then(setTeam)
      .catch((e) => setErr((e as Error).message));
  }, [year, month]);

  useEffect(() => {
    if (team) {
      document.title = `Décomptes ${MONTHS[team.month - 1]} ${team.year}`;
      if (document.visibilityState === 'visible' && !new URLSearchParams(location.search).has('noprint')) {
        const t = setTimeout(() => window.print(), 500);
        return () => clearTimeout(t);
      }
    }
  }, [team]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!team) return <div style={{ padding: 40 }}>Chargement…</div>;

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div>
            <div className="ref">Décomptes</div>
            <h1>{MONTHS[team.month - 1]} {team.year}</h1>
          </div>
        </header>

        <table className="lines">
          <thead>
            <tr>
              <th>Personne</th><th className="num">Jours</th>
              <th className="num">Prix jour facturé</th><th className="num">Prix jour en main</th>
              <th className="num">Total à facturer</th><th className="num">Total en main</th>
            </tr>
          </thead>
          <tbody>
            {team.rows.map((r) => (
              <tr key={r.personId}>
                <td>{r.name}</td>
                <td className="num">{r.days}</td>
                <td className="num">{r.days > 0 ? fmtEur(r.amount / r.days) : '—'}</td>
                <td className="num">{r.days > 0 ? fmtEur(r.payoutAmount / r.days) : '—'}</td>
                <td className="num">{fmtEur(r.amount)}</td>
                <td className="num">{fmtEur(r.payoutAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td><td className="num">{team.rows.reduce((s, r) => s + r.days, 0)}</td>
              <td></td><td></td>
              <td className="num">{fmtEur(team.totalAmount)}</td><td className="num">{fmtEur(team.totalPayoutAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

export default function PrintDecomptesPage() {
  return <Suspense fallback={<div style={{ padding: 40 }}>Chargement…</div>}><Inner /></Suspense>;
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 13px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2b25; }
  .head { border-bottom: 3px solid #0c2a22; padding-bottom: 14px; }
  .ref { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #c1922a; }
  .head h1 { font-size: 22px; margin: 2px 0 4px; font-family: "Fraunces", Georgia, serif; color: #0c2a22; text-transform: capitalize; }
  .lines { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12.5px; }
  .lines th { text-align: left; border-bottom: 2px solid #0c2a22; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #5a675f; }
  .lines td { padding: 7px 8px; border-bottom: 1px solid #e0e6e2; }
  .lines .num { text-align: right; white-space: nowrap; }
  .lines tfoot td { border-top: 2px solid #0c2a22; border-bottom: none; font-weight: 800; padding-top: 9px; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #0c2a22; background: #0c2a22; color: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } }
`;
