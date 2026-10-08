'use client';
import { SkeletonRows } from '@/components/States';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, Kpi, formatEur } from '@/lib/ui';
import { api } from '@/lib/api';
import { WorksitePicker } from '@/components/WorksitePicker';
import { TrendingUp, TrendingDown, Scale, Percent } from 'lucide-react';

interface Pnl {
  revenue: { total: number; byEntity: Record<string, number>; creditNotes: number; net: number };
  expenses: { total: number; sections: { key: string; label: string; total: number; lines: { label: string; amount: number }[] }[] };
  labour: number;
  result: number;
  margin: number | null;
}
interface ProfitDetail { id: string; ref: string; title: string; sell: number; buy: number; labour: number; transport: number; profit: number }
interface ForecastItem { worksiteId: string | null; ref: string; title: string; quotedHt: number; invoicedHt: number; remaining: number; documentId?: string; number?: string | null; client?: string | null; subject?: string | null }
interface Forecast { total: number; items: ForecastItem[] }
interface Share {
  jjd: { worksites: number; profit: number; david: number; julien: number };
  tonton: {
    worksites: number; profit: number; partGt: number; resteJjd: number;
    materielTonton: number; dejaPayeTonton: number; solde: number; details: ProfitDetail[];
  };
  m7: { worksites: number; profit: number; details: ProfitDetail[] };
}
const MONTHS = ['—', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const ENT_LABEL: Record<string, string> = { jjd: 'JJD', tonton: 'Tonton', m7: 'M7', autre: 'Non attribué' };

export default function FinancesPage() {
  const { user } = useAuth();
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [entity, setEntity] = useState('');
  const { data: yearsData } = useApi<{ years: number[] }>('/api/finance/years');
  const qs = new URLSearchParams();
  if (year) qs.set('year', year);
  if (month) qs.set('month', month);
  if (entity) qs.set('entity', entity);
  const { data } = useApi<Pnl>(`/api/finance/consolidated?${qs}`);
  const { data: share } = useApi<Share>(user?.isPartner ? '/api/finance/profit-share' : null);
  const { data: forecast, reload: reloadForecast } = useApi<Forecast>('/api/finance/forecast');
  // liste des chantiers (clôturés/archivés compris) pour imputer un R- à un devis accepté sans chantier
  const { data: pickers } = useApi<{ worksites: { id: string; name: string; city?: string | null }[] }>('/api/meta/pickers');
  const wsOptions = (pickers?.worksites ?? []).map((w) => ({ id: w.id, ref: w.name.split(' · ')[0]!, title: w.name, city: w.city ?? null }));
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  async function assignWorksite(documentId: string, worksiteId: string) {
    if (!worksiteId) return;
    try {
      await api(`/api/documents/${documentId}`, { method: 'PATCH', body: { worksiteId } });
      setAssignMsg('Chantier imputé au devis.');
      reloadForecast();
    } catch (e) {
      setAssignMsg(`Échec : ${(e as Error).message}`);
    }
  }
  const [openSec, setOpenSec] = useState<string | null>(null);
  const [showTontonDetail, setShowTontonDetail] = useState(false);


  return (
    <>
      <PageHead
        eyebrow="Comptabilité"
        title="Finances"
        sub="Compte de résultat consolidé"
        action={
          <div className="row">
            <Link href="/app/finances/fournisseurs" className="btn">Comptes fournisseurs →</Link>
            <Link href="/app/finances/grand-livre" className="btn">Rapprochement grand livre →</Link>
            <Link href="/app/finances/banque" className="btn">Rapprochement bancaire →</Link>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1.3rem' }}>
        <select className="select" style={{ maxWidth: 130 }} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes années</option>
          {(yearsData?.years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={month} onChange={(e) => setMonth(e.target.value)} disabled={!year}>
          <option value="">Toute l'année</option>
          {MONTHS.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Toutes entités</option>
          <option value="jjd">JJD</option>
          <option value="tonton">Tonton</option>
          <option value="m7">M7</option>
        </select>
      </div>

      {!data ? <SkeletonRows /> : (
        <>
          <div className="card card-pad muted" style={{ marginBottom: '1.3rem', fontSize: '0.85rem', borderLeft: '3px solid var(--warn)' }}>
            Le chiffre d'affaires par entité correspond exactement au fichier Excel. La <strong>ventilation des dépenses</strong>
            reste à affiner avec le comptable (certaines catégories du grand livre — crédits, notes de crédit — sont à reclasser).
          </div>
          <div className="kpis" style={{ marginBottom: '1.6rem' }}>
            <Kpi
              ic={TrendingUp}
              label="Chiffre d'affaires net"
              value={<Money value={data.revenue.net} />}
              sub={data.revenue.creditNotes !== 0 ? `dont ${formatEur(data.revenue.creditNotes)} de notes de crédit` : 'Toutes entités confondues'}
            />
            <Kpi
              ic={TrendingDown}
              label="Dépenses"
              value={<Money value={data.expenses.total} />}
              sub={`Réparties sur ${data.expenses.sections.length} poste${data.expenses.sections.length > 1 ? 's' : ''}`}
            />
            <Kpi
              ic={Scale}
              label="Résultat"
              value={<Money value={data.result} />}
              sub={data.margin != null ? `Marge ${data.margin} %` : 'Marge non calculable'}
              neg={data.result < 0}
              hero
            />
            <Kpi
              ic={Percent}
              label="Marge"
              value={data.margin != null ? `${data.margin} %` : '—'}
              sub={`Résultat ${formatEur(data.result)}`}
              neg={(data.margin ?? 0) < 0}
            />
          </div>

          <div className="section-title">Chiffre d'affaires par entité</div>
          <div className="tbl-wrap" style={{ marginBottom: '1.6rem' }}>
            <table className="tbl">
              <tbody>
                {Object.entries(data.revenue.byEntity).filter(([, v]) => v !== 0).map(([k, v]) => (
                  <tr key={k}><td>{ENT_LABEL[k] ?? k}</td><td style={{ textAlign: 'right' }}><Money value={v} /></td></tr>
                ))}
                {data.revenue.creditNotes !== 0 && (
                  <tr><td className="muted">Notes de crédit vente</td><td style={{ textAlign: 'right' }}><Money value={data.revenue.creditNotes} /></td></tr>
                )}
              </tbody>
              <tfoot><tr><td>CA net</td><td style={{ textAlign: 'right' }}><Money value={data.revenue.net} /></td></tr></tfoot>
            </table>
          </div>

          <div className="section-title">Dépenses <span className="hint">cliquer pour le détail</span></div>
          <div className="tbl-wrap" style={{ marginBottom: '1.6rem' }}>
            <table className="tbl">
              <tbody>
                {data.expenses.sections.map((s) => (
                  <Fragment key={s.key}>
                    <tr onClick={() => setOpenSec(openSec === s.key ? null : s.key)} style={{ cursor: 'pointer' }}>
                      <td>{openSec === s.key ? '▾' : '▸'} {s.label}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}><Money value={s.total} /></td>
                    </tr>
                    {openSec === s.key && s.lines.map((l) => (
                      <tr key={l.label} style={{ background: 'var(--surface-2)' }}>
                        <td style={{ paddingLeft: '2rem' }} className="muted">{l.label}</td>
                        <td style={{ textAlign: 'right' }} className="muted"><Money value={l.amount} /></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr><td>Total dépenses</td><td style={{ textAlign: 'right' }}><Money value={data.expenses.total} /></td></tr></tfoot>
            </table>
          </div>

          {forecast && forecast.items.length > 0 && (
            <div id="previsionnel" style={{ marginBottom: '1.6rem' }}>
              <div className="section-title">
                Prévisionnel — reste à facturer sur devis acceptés
                <span className="hint">travail déjà acté, pas encore totalement facturé</span>
              </div>
              <div className="card card-pad muted" style={{ marginBottom: '0.8rem', fontSize: '0.85rem' }}>
                Seuls les devis explicitement marqués « accepté » comptent. Un chantier démarré dont le
                devis est resté « envoyé » n'apparaît pas ici tant que son statut n'est pas corrigé.
              </div>
              {assignMsg && <div className="muted" role="status" style={{ margin: '0 0 0.5rem' }}>{assignMsg}</div>}
              {/* overflow visible : la liste déroulante du sélecteur de chantier ne doit pas être coupée par le conteneur du tableau */}
              <div className="tbl-wrap" style={{ overflow: 'visible' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Chantier</th>
                      <th style={{ textAlign: 'right' }}>Devis accepté HT</th>
                      <th style={{ textAlign: 'right' }}>Déjà facturé HT</th>
                      <th style={{ textAlign: 'right' }}>Reste à facturer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.items.map((it) => (
                      <tr key={it.worksiteId ?? it.documentId ?? it.title}>
                        <td>
                          {it.worksiteId ? (
                            <><Link href={`/app/chantiers/${it.worksiteId}`}>{it.ref}</Link> <span className="muted">{it.title}</span></>
                          ) : (
                            <div style={{ minWidth: 260 }}>
                              <div>
                                {it.documentId ? <Link href={`/app/documents/${it.documentId}`} style={{ fontWeight: 600 }}>{it.number ?? 'Devis'}</Link> : it.ref}
                                {it.client && <> · {it.client}</>} <span className="muted">— devis sans chantier lié</span>
                              </div>
                              {it.subject && <div className="muted" style={{ fontSize: '0.78rem', margin: '0.1rem 0 0.3rem' }}>{it.subject}</div>}
                              {it.documentId && (
                                <WorksitePicker value="" onChange={(id) => assignWorksite(it.documentId!, id)} options={wsOptions} placeholder="Imputer à un chantier (R-… ou nom)" />
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}><Money value={it.quotedHt} /></td>
                        <td style={{ textAlign: 'right' }}><Money value={it.invoicedHt} /></td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}><Money value={it.remaining} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td>Total</td><td /><td /><td style={{ textAlign: 'right' }}><Money value={forecast.total} /></td></tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {user?.isPartner && share && (
            <>
              <div className="section-title">Partage des bénéfices <span className="hint">réservé aux associés · marges réelles par chantier</span></div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginBottom: '2rem' }}>
                <div className="card card-pad">
                  <div className="eyebrow">JJD — {share.jjd.worksites} chantiers</div>
                  <div className="value" style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.3rem 0 0.6rem' }}><Money value={share.jjd.profit} /></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>David</span><strong><Money value={share.jjd.david} /></strong></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Julien</span><strong><Money value={share.jjd.julien} /></strong></div>
                </div>
                <div className="card card-pad">
                  <div className="eyebrow">Tonton — {share.tonton.worksites} chantiers</div>
                  <div className="value" style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.3rem 0 0.6rem' }}><Money value={share.tonton.profit} /></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Part GT (⅓)</span><strong><Money value={share.tonton.partGt} /></strong></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Reste JJD</span><strong><Money value={share.tonton.resteJjd} /></strong></div>
                </div>
                <div className="card card-pad">
                  <div className="eyebrow">Solde Tonton</div>
                  <div
                    className="value"
                    style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.3rem 0 0.6rem', color: share.tonton.solde > 0 ? 'var(--crit)' : 'var(--ok)' }}
                  >
                    <Money value={share.tonton.solde} sign />
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                    {share.tonton.solde > 0 ? 'Reste à lui verser' : share.tonton.solde < 0 ? 'Il a reçu plus que dû' : 'À jour'}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Part GT (⅓)</span><strong><Money value={share.tonton.partGt} /></strong></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>+ Matériel avancé</span><strong><Money value={share.tonton.materielTonton} /></strong></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>− Déjà versé</span><strong><Money value={share.tonton.dejaPayeTonton} /></strong></div>
                </div>
              </div>

              {share.tonton.details.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                  <div className="section-title" style={{ cursor: 'pointer' }} onClick={() => setShowTontonDetail((v) => !v)}>
                    {showTontonDetail ? '▾' : '▸'} Détail du calcul — chantiers Tonton <span className="hint">pour vérifier le total ci-dessus</span>
                  </div>
                  {showTontonDetail && (
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Chantier</th>
                            <th style={{ textAlign: 'right' }}>Vendu HT</th>
                            <th style={{ textAlign: 'right' }}>Acheté HT</th>
                            <th style={{ textAlign: 'right' }}>Main d'œuvre</th>
                            <th style={{ textAlign: 'right' }}>Transport</th>
                            <th style={{ textAlign: 'right' }}>Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {share.tonton.details.map((d) => (
                            <tr key={d.ref}>
                              <td><Link href={`/app/chantiers/${d.ref}`}>{d.ref}</Link> <span className="muted">{d.title}</span></td>
                              <td style={{ textAlign: 'right' }}><Money value={d.sell} /></td>
                              <td style={{ textAlign: 'right' }}><Money value={d.buy} /></td>
                              <td style={{ textAlign: 'right' }}><Money value={d.labour} /></td>
                              <td style={{ textAlign: 'right' }}><Money value={d.transport} /></td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}><Money value={d.profit} /></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr><td>Total</td><td /><td /><td /><td /><td style={{ textAlign: 'right' }}><Money value={share.tonton.profit} /></td></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
