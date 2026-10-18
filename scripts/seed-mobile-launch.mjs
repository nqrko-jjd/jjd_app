// Synthetic fixture for the isolated mobile CI database only.
import { PrismaClient } from '@prisma/client';
if (process.env.JJD_SKIP_ENV_FILE !== '1' || process.env.DATABASE_URL !== 'file:./mobile-launch.db') throw new Error('Isolated mobile database required');
const p = new PrismaClient();
const person = await p.person.create({data:{firstName:'Mobile',normalizedName:'mobile test',role:'worker',hourlyRate:20,source:'test'}});
await p.user.update({where:{email:'ouvrier@jjd-consult.be'},data:{personId:person.id}});
const ws = await p.worksite.create({data:{ref:'R-MOBILE-TEST',title:'Chantier de test mobile',source:'test',lat:50.8467,lng:4.3525}});
const today = new Date(); today.setHours(0,0,0,0);
await p.planningEvent.create({data:{worksiteId:ws.id,startAt:today,endAt:new Date(today.getTime()+86400000),allDay:true,assignments:{create:{personId:person.id}}}});
await p.$disconnect();
