import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseBucket} from './analytics-breakdown.js';
test('la ventilation conserve exactement les coûts existants, y compris avoirs et postes inconnus',()=>{
 const entries=[['salaires',1000],['materiel',450],['sous_traitance',200],['chantier_divers',50],['notes_credit',-75],['charges_fixes',150],['fiscal',80],['nouveau poste',15]] as const;
 const buckets={payroll:0,purchases:0,otherExpenses:0};
 for(const [section,amount] of entries)buckets[expenseBucket(section)]+=amount;
 assert.deepEqual(buckets,{payroll:1000,purchases:700,otherExpenses:170});
 assert.equal(Object.values(buckets).reduce((a,n)=>a+n,0),entries.reduce((a,[,n])=>a+n,0));
});
