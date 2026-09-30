'use client';
import Link from 'next/link';
import { Clock3, FileText, Fuel, ShoppingCart } from 'lucide-react';
import type { WorksiteMargin } from '@jjd/shared';
import { formatHours } from '@jjd/shared';
import { Money } from '@/lib/ui';

/** Présentation uniquement : toutes les valeurs proviennent du calcul métier existant. */
export function WorksiteFinanceSummary({ margin, worksiteId, billingName, billingContactId, labour, documentCount }: {
  margin: WorksiteMargin;
  worksiteId: string;
  billingName: string;
  billingContactId?: string | null;
  labour: { hours: number; pending: boolean }[];
  documentCount: number;
}) {
  const hours = labour.reduce((sum, row) => sum + row.hours, 0);
  const pendingHours = labour.filter(row => row.pending).reduce((sum, row) => sum + row.hours, 0);
  return (
    <div className="worksite-finance-summary">
      <section className="worksite-finance-heading">
        <div><span className="eyebrow">Finances du chantier</span><h2>Préparer la facturation</h2><p>Destinataire : <strong>{billingName}</strong></p></div>
        <Link className="btn" href={`/app/documents?kind=invoice&worksiteId=${encodeURIComponent(worksiteId)}${billingContactId ? `&billingContactId=${encodeURIComponent(billingContactId)}` : ''}`}><FileText size={17} /> Factures du chantier</Link>
      </section>
      <div className="worksite-finance-totals">
        <article><span>Marché HT</span><strong><Money value={margin.quotedHt} /></strong><small>Devis et montant convenu</small></article>
        <article><span>Facturé HT</span><strong><Money value={margin.invoicedHt} /></strong><small>Factures moins notes de crédit</small></article>
        <article><span>Encaissé HT</span><strong><Money value={margin.paidHt} /></strong><small>Paiements enregistrés</small></article>
        <article className="remaining"><span>Reste à facturer HT</span><strong><Money value={margin.leftToInvoice} /></strong><small>{margin.leftToInvoice < 0 ? 'Dépassement du marché à vérifier' : 'Solde du marché, pas un avancement validé'}</small></article>
      </div>
      <div className="worksite-finance-costs">
        <article><Clock3 size={21} /><div><strong>Main-d’œuvre</strong><span>{formatHours(hours)} enregistrées</span><small>{pendingHours > 0 ? `${formatHours(pendingHours)} sur journées à contrôler` : 'Aucune heure en attente'}</small><button className="btn ghost" onClick={()=>{const el=document.getElementById('worksite-labour');el?.scrollIntoView({behavior:'smooth'});el?.focus({preventScroll:true});}}>Voir les heures par jour</button></div><b><Money value={margin.labourCost} /></b></article>
        <article><ShoppingCart size={21} /><div><strong>Achats / matériaux</strong><span>Coût imputé au chantier</span><Link href={`/app/achats?worksiteId=${encodeURIComponent(worksiteId)}`}>Consulter les achats</Link></div><b><Money value={margin.materialCost} /></b></article>
        <article><Fuel size={21} /><div><strong>Transport</strong><span>Trajets et véhicules imputés</span><small>Calcul existant conservé</small></div><b><Money value={margin.vehicleCost} /></b></article>
      </div>
      <div className="worksite-finance-check">
        <span><strong>{documentCount}</strong> documents liés · <strong><Money value={margin.totalCost} /></strong> de coûts engagés</span>
        <span>Marge prévisionnelle : <strong><Money value={margin.forecastMargin} sign /></strong></span>
      </div>
    </div>
  );
}
