/** Ventilation des charges existantes ; conserve les signes des avoirs. */
export function expenseBucket(section: string): 'purchases' | 'payroll' | 'otherExpenses' {
  if (section === 'salaires') return 'payroll';
  if (['materiel', 'sous_traitance', 'chantier_divers'].includes(section)) return 'purchases';
  return 'otherExpenses';
}
