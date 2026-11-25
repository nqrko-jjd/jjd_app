/** Paid daily guarantee is distinct from measured time. Historical imports are unchanged. */
export function computePaidTime(entries: {date: Date | string | null; hours: number | null; amount: number | null; rateUsed?: number | null; source?: string | null; status: string}[], dailyHours = 10, defaultRate: number | null = null) {
 const round = (n:number) => Math.round(n*100)/100;
 const approved = entries.filter(e=>e.status==='approved');
 const days=new Set<string>();
 const grouped=new Map<string,{hours:number;amount:number;rate:number|null}>();
 let actualHours=0, actualAmount=0;
 for(const e of approved){
  actualHours+=e.hours??0;actualAmount+=e.amount??0;
  if(!e.date)continue;
  const key=new Date(e.date).toISOString().slice(0,10);days.add(key);
  if(e.source==='xlsx')continue;
  const row=grouped.get(key)??{hours:0,amount:0,rate:null};
  row.hours+=e.hours??0;row.amount+=e.amount??0;row.rate??=e.rateUsed??null;grouped.set(key,row);
 }
 let addedHours=0, addedAmount=0;
 for(const row of grouped.values()){
  addedHours+=Math.max(0,dailyHours-row.hours);
  const rate=row.rate??defaultRate;
  if(rate!=null)addedAmount+=Math.max(0,round(dailyHours*rate)-row.amount);
 }
 return {actualHours:round(actualHours),actualAmount:round(actualAmount),paidHours:round(actualHours+addedHours),paidAmount:round(actualAmount+addedAmount),guaranteeHours:round(addedHours),guaranteeAmount:round(addedAmount),days:days.size,pendingCount:entries.filter(e=>e.status==='submitted').length};
}

/**
 * Montants « à la journée » : les ouvriers sont payés par jour presté, pas à l'heure. Pour chaque jour pointé dans l'app,
 * le montant du jour (payoutPerDay, sinon taux × heures/jour) est réparti sur les pointages de ce jour au prorata des heures
 * (un jour sur deux chantiers = une seule journée, partagée). L'historique importé (source « xlsx ») garde son montant réel.
 * Sans montant journalier connu, le montant du pointage est gardé.
 */
export function dayBasedAmounts<T extends { id: string; date: Date | string | null; hours: number | null; amount: number | null; source?: string | null }>(
  entries: T[], dayAmount: number | null,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const byDay = new Map<string, T[]>();
  for (const e of entries) {
    if (dayAmount == null || e.source === 'xlsx' || !e.date) { out.set(e.id, e.amount); continue; }
    const k = new Date(e.date).toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  for (const list of byDay.values()) {
    const hours = list.reduce((s, e) => s + Math.max(0, e.hours ?? 0), 0);
    let left = dayAmount!;
    list.forEach((e, i) => {
      const share = i === list.length - 1 ? left : Math.round((hours > 0 ? dayAmount! * Math.max(0, e.hours ?? 0) / hours : dayAmount! / list.length) * 100) / 100;
      left = Math.round((left - share) * 100) / 100;
      out.set(e.id, share);
    });
  }
  return out;
}

/** Montant journalier d'un ouvrier : ce qui lui est remis par jour, sinon son jour coûté (taux horaire × heures/jour). */
export function personDayAmount(p: { payoutPerDay?: number | null; hourlyRate?: number | null; dailyHours?: number | null } | null | undefined): number | null {
  if (!p) return null;
  if (p.payoutPerDay != null) return p.payoutPerDay;
  return p.hourlyRate != null ? Math.round(p.hourlyRate * (p.dailyHours ?? 10) * 100) / 100 : null;
}
