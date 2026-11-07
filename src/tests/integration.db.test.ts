import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '../generated/prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {createBooking,rescheduleBooking} from '../lib/booking';
import {daysFrom,todayAt,weekday} from '../lib/time';
if(process.env.CI_INTEGRATION!=='true')throw new Error('DB integration tests require CI_INTEGRATION=true on an isolated test database');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const day=daysFrom(todayAt('Asia/Tehran'),3),w=weekday(day);
const id=()=>crypto.randomUUID();
async function fixture(){
 const org=await db.organization.create({data:{name:'آزمون خودکار',slug:'integration-'+id().slice(0,8),noticeMinutes:0}});
 const branch=await db.branch.create({data:{orgId:org.id,name:'شعبه تست'}});
 await db.branchHours.create({data:{branchId:branch.id,weekday:w,opens:'09:00',closes:'19:00'}});
 const staff=await db.staff.create({data:{orgId:org.id,branchId:branch.id,name:'متخصص تست',slug:'test-'+id().slice(0,8)}});
 await db.staffHours.create({data:{staffId:staff.id,weekday:w,starts:'09:00',ends:'19:00'}});
 const svc=await db.service.create({data:{orgId:org.id,name:'خدمت تست',duration:45,price:150000}});
 await db.staffService.create({data:{staffId:staff.id,serviceId:svc.id}});
 return {org,branch,staff,svc};
}
const inp=(f:Awaited<ReturnType<typeof fixture>>,number:string,time='10:00')=>({branchId:f.branch.id,serviceIds:[f.svc.id],staffId:f.staff.id,date:day,time,name:'مشتری آزمایشی',phone:number,email:''});
const phone=(n:number)=>`0912${String(n).padStart(7,'0')}`;
test('database booking: simultaneous requests, tenant validation, reschedule',async()=>{
 const f=await fixture();
 try {
   const pair=await Promise.allSettled([createBooking(f.org.id,inp(f,phone(1))),createBooking(f.org.id,inp(f,phone(2)))]);
   assert.equal(pair.filter(p=>p.status==='fulfilled').length,1,'only one overlapping booking may succeed');
   const created=pair.find((p):p is PromiseFulfilledResult<Awaited<ReturnType<typeof createBooking>>>=>p.status==='fulfilled')!.value;
   assert.equal(created.ids.length,1);
   const moved=await rescheduleBooking(f.org.id,created.ids[0],day,'12:00');
   assert.equal(moved.count,1);
   const fresh=await createBooking(f.org.id,inp(f,phone(3)));
   assert.equal(fresh.ids.length,1,'released slot is reusable');
   const other=await fixture();
   await assert.rejects(()=>createBooking(f.org.id,{...inp(f,phone(4),'14:00'),branchId:other.branch.id}),/شعبه|خدمات|نامعتبر/);
 }finally{ /* disposable CI database: preserve failed run for inspection */ }
});
test('database booking: capacity-limited group session',async()=>{
 const f=await fixture();
 await db.service.update({where:{id:f.svc.id},data:{capacity:2}});
 const results=await Promise.allSettled([4,5,6].map(n=>createBooking(f.org.id,inp(f,phone(n),'15:00'))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test.after(async()=>{await db.$disconnect();});
