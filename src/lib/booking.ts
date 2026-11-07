import { db } from "./db";
import { AppError,isBookingCollision } from "./auth";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { daysFrom, hminutes, validDate } from "./time";
import {planAt,computeAvailableSlots,type Schedule,type Slot} from "./availability";
import {normalizeIranMobile} from "./numbers";
export {planAt,computeAvailableSlots,type Schedule,type Slot} from "./availability";

export const bookingSchema=z.object({branchId:z.string().uuid(),serviceIds:z.array(z.string().uuid()).min(1).max(5),staffId:z.string().uuid().optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate,"تاریخ معتبر نیست"),time:z.string().regex(/^\d{2}:\d{2}$/),name:z.string().trim().min(2).max(120),phone:z.string().regex(/^(?:\+?98|0)?9\d{9}$/),email:z.string().email().optional().or(z.literal("")),notes:z.string().max(1000).optional(),coupon:z.string().max(40).optional()});
export type BookingInput=z.infer<typeof bookingSchema>;
const ACTIVE=["pending","confirmed","checked_in","completed"];
/** Candidate slots are for display. Creation ALWAYS validates again under a PostgreSQL transaction lock. */
export async function scheduleData(orgId:string,branchId:string,serviceIds:string[],date:string,staffId?:string){
  if(!validDate(date))throw new AppError(422,"تاریخ معتبر نیست");
  const [org,branch,services,staff,relations,branchHours,staffHours,holiday,existing,timeoffs]=await Promise.all([
    db.organization.findUnique({where:{id:orgId}}),db.branch.findFirst({where:{id:branchId,orgId,active:true}}),
    db.service.findMany({where:{id:{in:serviceIds},orgId,active:true}}),
    db.staff.findMany({where:{orgId,branchId,active:true,...(staffId?{id:staffId}:{})},orderBy:{priority:"desc"}}),
    db.staffService.findMany({where:{serviceId:{in:serviceIds}}}),db.branchHours.findMany({where:{branchId}}),
    db.staffHours.findMany(),db.holiday.findFirst({where:{branchId,date}}),
    db.appointment.findMany({where:{orgId,blockStart:{lt:new Date(`${daysFrom(date,2)}T23:59:59Z`)},blockEnd:{gt:new Date(`${daysFrom(date,-2)}T00:00:00Z`)},status:{in:ACTIVE}}}),
    db.timeOff.findMany({where:{orgId,startsAt:{lt:new Date(`${daysFrom(date,2)}T23:59:59Z`)},endsAt:{gt:new Date(`${daysFrom(date,-2)}T00:00:00Z`)}}})
  ]);
  if(!org||!branch||services.length!==new Set(serviceIds).size||services.length!==serviceIds.length)throw new AppError(422,"شعبه یا خدمات معتبر نیست");
  const need=services.filter(s=>s.resourceId).map(s=>s.resourceId!);
  if(need.length){const valid=await db.resource.count({where:{orgId,branchId,active:true,id:{in:need}}});if(valid!==new Set(need).size)throw new AppError(422,"منبع موردنیاز خدمت در این شعبه فعال نیست");}
  const byId=new Map(services.map(s=>[s.id,s]));const ordered=serviceIds.map(id=>byId.get(id)!);
  const allowed=staff.filter(s=>serviceIds.every(id=>relations.some(r=>r.staffId===s.id&&r.serviceId===id)));
  return {org,branch,services:ordered,staff:allowed,branchHours,staffHours:staffHours.filter(h=>allowed.some(s=>s.id===h.staffId)),holiday:!!holiday,existing,timeoffs};
}
async function recordNotification(tx:Prisma.TransactionClient,orgId:string,kind:string,title:string,body:string,apptId:string,startsAt:Date){
  await tx.notification.create({data:{orgId,kind,title,body,channel:"in_app",state:"delivered"}});
  for(const dueAt of [new Date(startsAt.getTime()-24*3600000),new Date(startsAt.getTime()-2*3600000)]){
    if(dueAt>new Date()){
      await tx.outbox.create({data:{orgId,appointmentId:apptId,channel:"sms",eventType:"reminder",status:"requires_provider",dueAt}});
      await tx.outbox.create({data:{orgId,appointmentId:apptId,channel:"in_app",eventType:"reminder",status:"queued",dueAt}});
    }
  }
}
export async function createBooking(orgId:string,input:BookingInput,source:"online"|"admin"="online",actorId?:string,seriesId?:string){
  const data=bookingSchema.parse({...input,phone:normalizeIranMobile(input.phone)});
  const org=await db.organization.findUnique({where:{id:orgId}});if(!org)throw new AppError(404,"کسب‌وکار یافت نشد");
  if(!org.bookingEnabled&&source==="online")throw new AppError(403,"رزرو آنلاین غیرفعال است");
  for(let attempt=0;attempt<4;attempt++){
  try{return await db.$transaction(async tx=>{
    // Serialize by all staff/resource keys; ensure stable lock order to avoid deadlocks.
    const srv=await tx.service.findMany({where:{orgId,id:{in:data.serviceIds}}});
    const keys=[`staff:${data.staffId||"auto"}`, ...srv.filter(s=>s.resourceId).map(s=>`resource:${s.resourceId}`)].sort();
    for(const key of keys)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const sched=await scheduleDataInTx(tx,orgId,data.branchId,data.serviceIds,data.date,data.staffId);
    if(source==="admin")sched.org={...sched.org,bookingEnabled:true};
    const options=data.staffId?[data.staffId]:sched.staff.map(x=>x.id);
    let staffId="",plan:ReturnType<typeof planAt>=null;
    for(const sid of options){const proposal=planAt(sched,sid,data.date,hminutes(data.time));if(proposal){staffId=sid;plan=proposal;break;}}
    if(!staffId||!plan)throw new AppError(409,"این زمان دیگر آزاد نیست");
    // For auto assignment obtain staff lock too and reload busy rows under lock.
    if(!data.staffId){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff:${staffId}`}))`; const current=await tx.appointment.findMany({where:{orgId,status:{in:ACTIVE},blockStart:{lt:plan[plan.length-1].blockEnd},blockEnd:{gt:plan[0].blockStart}}}); const s2={...sched,existing:current};plan=planAt(s2,staffId,data.date,hminutes(data.time));if(!plan)throw new AppError(409,"این زمان دیگر آزاد نیست");}
    const phone=data.phone.replace(/^(?:\+?98)/,"0");
    const customer=await tx.customer.upsert({where:{orgId_phone:{orgId,phone}},create:{orgId,name:data.name,phone,email:data.email||""},update:{email:data.email||undefined}});
    let couponId:string|undefined,discount=0;
    if(data.coupon){const c=await tx.coupon.findUnique({where:{orgId_code:{orgId,code:data.coupon.toUpperCase().trim()}}});const sum=plan.reduce((a,p)=>a+p.price,0);if(!c||!c.active||c.expiresAt&&c.expiresAt<new Date()||c.maxUses!==null&&c.used>=c.maxUses||sum<c.minAmount)throw new AppError(422,"کد تخفیف معتبر نیست");discount=Math.min(sum,c.kind==="percent"?Math.round(sum*c.value/100):c.value);couponId=c.id;await tx.coupon.update({where:{id:c.id},data:{used:{increment:1}}});}
    const status=source==="online"&&org.approvalRequired?"pending":"confirmed";
    const bookingIds:string[]=[],bookingRef=crypto.randomUUID();let token="";
    for(const [idx,p] of plan.entries()){
      const item=await tx.appointment.create({data:{orgId,branchId:data.branchId,serviceId:p.serviceId,staffId,customerId:customer.id,resourceId:p.resourceId,startsAt:p.startsAt,endsAt:p.endsAt,blockStart:p.blockStart,blockEnd:p.blockEnd,status,source,notes:data.notes||"",price:p.price,depositRequired:Math.round(p.deposit),groupKey:p.groupKey,bookingRef,seriesId:seriesId||null,discount:idx===0?discount:0,couponId:idx===0?couponId:null}});
      if(!token)token=item.publicToken;bookingIds.push(item.id);
      await tx.appointmentEvent.create({data:{orgId,appointmentId:item.id,actorId:actorId||null,action:"created",details:{source}}});
      if(idx===0)await recordNotification(tx,orgId,"booking_created","رزرو جدید",`${data.name} برای ${data.date} ساعت ${data.time} نوبت گرفت`,item.id,p.startsAt);
    }
    return {ids:bookingIds,bookingRef,token,total:plan.reduce((s,p)=>s+p.price,0),discount,status};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:10000});
  }catch(e){
    if((e as {code?:string})?.code==="P2034" && attempt<3)continue;
    if(e instanceof AppError)throw e;
    if(isBookingCollision(e))throw new AppError(409,"این زمان دیگر آزاد نیست");
    throw e;
  }
  }
  throw new AppError(409,"درخواست رزرو هم‌زمان با درخواست دیگری بود؛ دوباره تلاش کنید");
}
// Same connection must be used inside the transaction; never load availability on a different connection.
async function scheduleDataInTx(tx:Prisma.TransactionClient,orgId:string,branchId:string,serviceIds:string[],date:string,staffId?:string):Promise<Schedule>{
  const [org,branch,services,staff,relations,branchHours,staffHours,holiday,existing,timeoffs]=await Promise.all([
    tx.organization.findUnique({where:{id:orgId}}),tx.branch.findFirst({where:{id:branchId,orgId,active:true}}),tx.service.findMany({where:{id:{in:serviceIds},orgId,active:true}}),
    tx.staff.findMany({where:{orgId,branchId,active:true,...(staffId?{id:staffId}:{})},orderBy:{priority:"desc"}}),
    tx.staffService.findMany({where:{serviceId:{in:serviceIds}}}),tx.branchHours.findMany({where:{branchId}}),tx.staffHours.findMany(),
    tx.holiday.findFirst({where:{branchId,date}}),tx.appointment.findMany({where:{orgId,blockStart:{lt:new Date(`${daysFrom(date,2)}T23:59:59Z`)},blockEnd:{gt:new Date(`${daysFrom(date,-2)}T00:00:00Z`)},status:{in:ACTIVE}}}),
    tx.timeOff.findMany({where:{orgId,startsAt:{lt:new Date(`${daysFrom(date,2)}T23:59:59Z`)},endsAt:{gt:new Date(`${daysFrom(date,-2)}T00:00:00Z`)}}})]);
  if(!org||!branch||services.length!==serviceIds.length||new Set(serviceIds).size!==serviceIds.length)throw new AppError(422,"شعبه یا خدمات معتبر نیست");
  const required=services.filter(s=>s.resourceId).map(s=>s.resourceId!);
  if(required.length){const valid=await tx.resource.count({where:{orgId,branchId,active:true,id:{in:required}}});if(valid!==new Set(required).size)throw new AppError(422,"منبع موردنیاز خدمت در این شعبه فعال نیست");}
  const map=new Map(services.map(s=>[s.id,s]));const qualified=staff.filter(s=>serviceIds.every(id=>relations.some(r=>r.staffId===s.id&&r.serviceId===id)));
  return {org,branch,services:serviceIds.map(id=>map.get(id)!),staff:qualified,branchHours,staffHours:staffHours.filter(h=>qualified.some(s=>s.id===h.staffId)),holiday:!!holiday,existing,timeoffs};
}
export const availablePublic=async(orgId:string,branchId:string,services:string[],date:string,staffId?:string)=>computeAvailableSlots(await scheduleData(orgId,branchId,services,date,staffId),date,staffId);

/** Reschedule every service in a reservation atomically, never just its first service. */
export async function rescheduleBooking(orgId:string,appointmentId:string,day:string,time:string,newStaffId?:string,actorId?:string){
  if(!validDate(day))throw new AppError(422,"تاریخ معتبر نیست");
  const minute=hminutes(time);
  try{return await db.$transaction(async tx=>{
    const first=await tx.appointment.findFirst({where:{orgId,id:appointmentId}});
    if(!first)throw new AppError(404,"نوبت پیدا نشد");
    const original=await tx.appointment.findMany({where:{orgId,...(first.bookingRef?{bookingRef:first.bookingRef}:{id:first.id})},orderBy:[{startsAt:"asc"},{id:"asc"}]});
    if(!original.every(a=>["pending","confirmed"].includes(a.status)))throw new AppError(409,"فقط نوبت‌های فعال قابل جابه‌جایی‌اند");
    if(new Set(original.map(a=>a.branchId)).size!==1)throw new AppError(422,"رزرو متعلق به چند شعبه است");
    const sid=newStaffId||first.staffId;
    const ids=original.map(a=>a.serviceId);
    const services=await tx.service.findMany({where:{orgId,id:{in:ids}}});
    const keys=[...new Set([`staff:${sid}`,...original.map(a=>`staff:${a.staffId}`),...services.filter(s=>s.resourceId).map(s=>`resource:${s.resourceId}`)])].sort();
    for(const key of keys)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const sched=await scheduleDataInTx(tx,orgId,first.branchId,ids,day,sid);
    // Own current slots are not conflicts while moving the same reservation.
    sched.existing=sched.existing.filter(a=>!original.some(old=>old.id===a.id));
    const plan=planAt(sched,sid,day,minute);
    if(!plan||plan.length!==original.length)throw new AppError(409,"این زمان برای جابه‌جایی رزرو آزاد نیست");
    // Temporarily release the original exclusion constraints within this transaction.
    await tx.appointment.updateMany({where:{orgId,id:{in:original.map(a=>a.id)}},data:{status:"cancelled"}});
    for(let i=0;i<original.length;i++){
      const old=original[i],p=plan[i];
      await tx.appointment.update({where:{id:old.id},data:{staffId:sid,resourceId:p.resourceId,startsAt:p.startsAt,endsAt:p.endsAt,blockStart:p.blockStart,blockEnd:p.blockEnd,groupKey:p.groupKey,status:old.status}});
      await tx.appointmentEvent.create({data:{orgId,appointmentId:old.id,actorId:actorId||null,action:"rescheduled",details:{from:old.startsAt.toISOString(),to:p.startsAt.toISOString(),fromStaff:old.staffId,toStaff:sid}}});
    }
    await tx.notification.create({data:{orgId,kind:"booking_rescheduled",title:"رزرو جابه‌جا شد",body:`${original.length} خدمت به ${day} ساعت ${time} منتقل شد`}});
    return {ok:true,count:original.length,startsAt:plan[0].startsAt.toISOString()};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:10000});}
  catch(e){if(e instanceof AppError)throw e;if(isBookingCollision(e))throw new AppError(409,"نوبت جدید با رزرو دیگری تداخل دارد");throw e;}
}
