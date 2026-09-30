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
