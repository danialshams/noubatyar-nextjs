import { NextRequest,NextResponse } from "next/server";
import {PUBLIC_DEMO_MODE,demoOrg,demoHours} from "@/lib/public-demo";
import { z } from "zod";
import {randomBytes,createHash} from "node:crypto";
import { db } from "@/lib/db";
import { requireAuth,requireOrigin,AppError,fail } from "@/lib/auth";
import { createBooking,rescheduleBooking,bookingSchema } from "@/lib/booking";
import {daysFrom} from "@/lib/time";
const STATUSES:Record<string,string[]>={pending:["confirmed","cancelled"],confirmed:["checked_in","completed","no_show","cancelled"],checked_in:["completed","no_show"],completed:[],cancelled:[],no_show:[]};
export async function GET(req:NextRequest){try{const type=req.nextUrl.searchParams.get("type")||"";const id=req.nextUrl.searchParams.get("id")||"";if(PUBLIC_DEMO_MODE){if(type==="settings")return NextResponse.json({item:demoOrg,demo:true});if(["staff.hours","branch.hours"].includes(type))return NextResponse.json({items:demoHours(type,id),demo:true});throw new AppError(404,"عملیات یافت نشد");}const{org}=await requireAuth();
  if(type==="settings")return NextResponse.json({item:org});
  if(type==="staff.hours"){
    if(!(await db.staff.findFirst({where:{id,orgId:org.id}})))throw new AppError(404,"متخصص پیدا نشد");
    return NextResponse.json({items:await db.staffHours.findMany({where:{staffId:id},orderBy:{weekday:"asc"}})});
  }
  if(type==="branch.hours"){
    if(!(await db.branch.findFirst({where:{id,orgId:org.id}})))throw new AppError(404,"شعبه پیدا نشد");
    return NextResponse.json({items:await db.branchHours.findMany({where:{branchId:id},orderBy:{weekday:"asc"}})});
  }
  throw new AppError(404,"عملیات پیدا نشد");
}catch(e){return fail(e);}}
export async function POST(req:NextRequest){try{if(PUBLIC_DEMO_MODE)throw new AppError(403,"نسخه نمایش عمومی فقط خواندنی است");
  requireOrigin(req);const a=await requireAuth();const data=await req.json() as Record<string,unknown>;const action=String(data.action||"");const orgId=a.org.id;
  if(a.member.role==="staff"&&action!=="booking.status")throw new AppError(403,"دسترسی غیرمجاز");
  if(action==="team.invite"){
    if(a.member.role!=="owner")throw new AppError(403,"فقط مدیر اصلی می‌تواند دعوت کند");
    const x=z.object({email:z.string().trim().toLowerCase().email(),role:z.enum(["manager","staff"]),staffId:z.string().uuid().nullable().optional()}).parse(data);
    if(x.role==="staff"&&!x.staffId)throw new AppError(422,"برای نقش متخصص، متخصص مربوطه را انتخاب کنید");
    if(x.staffId&&!(await db.staff.findFirst({where:{id:x.staffId,orgId}})))throw new AppError(422,"متخصص معتبر نیست");
    const token=randomBytes(32).toString("hex"),tokenHash=createHash("sha256").update(token).digest("hex");
    await db.teamInvite.create({data:{orgId,email:x.email,role:x.role,staffId:x.role==="staff"?x.staffId:null,tokenHash,expiresAt:new Date(Date.now()+7*86400000),createdBy:a.user.id}});
    return NextResponse.json({url:`${process.env.APP_URL||new URL(req.url).origin}/join/${token}`,expiresInDays:7});
  }
  if(action==="team.role"){
    if(a.member.role!=="owner")throw new AppError(403,"فقط مدیر اصلی می‌تواند نقش‌ها را تغییر دهد");
    const x=z.object({membershipId:z.string().uuid(),role:z.enum(["manager","staff"]),staffId:z.string().uuid().nullable().optional()}).parse(data);
    const member=await db.membership.findFirst({where:{id:x.membershipId,orgId}});
    if(!member||member.role==="owner")throw new AppError(403,"نقش مدیر اصلی قابل تغییر نیست");
    if(x.role==="staff"&&!x.staffId)throw new AppError(422,"متخصص لازم است");
    if(x.staffId&&!(await db.staff.findFirst({where:{id:x.staffId,orgId}})))throw new AppError(422,"متخصص معتبر نیست");
    await db.membership.update({where:{id:member.id},data:{role:x.role,staffId:x.role==="staff"?x.staffId:null}});
    await db.audit.create({data:{orgId,userId:a.user.id,action:"team_role_changed",objectType:"membership",objectId:member.id}});
    return NextResponse.json({ok:true});
  }
  if(action==="booking.recurring"){
    const x=z.object({payload:bookingSchema,frequency:z.enum(["daily","weekly"]),count:z.number().int().min(2).max(12)}).parse(data);
    const series=await db.recurring.create({data:{orgId,frequency:x.frequency,total:x.count}});
    const created:unknown[]=[],conflicts:string[]=[];
    for(let i=0;i<x.count;i++){
      const date=daysFrom(x.payload.date,i*(x.frequency==="weekly"?7:1));
      try{const result=await createBooking(orgId,{...x.payload,date},"admin",a.user.id,series.id);created.push({date,...result});}
      catch(e){if(e instanceof AppError&&e.status===409)conflicts.push(date);else throw e;}
    }
    return NextResponse.json({seriesId:series.id,created,conflicts,status:conflicts.length?"partial":"complete"},{status:201});
  }
  if(action==="booking.create"){
    const r=await createBooking(orgId,data.payload as Parameters<typeof createBooking>[1],"admin",a.user.id);return NextResponse.json(r,{status:201});
  }
  if(action==="booking.reschedule"){
    const x=z.object({id:z.string().uuid(),date:z.string(),time:z.string().regex(/^\d\d:\d\d$/),staffId:z.string().uuid().optional()}).parse(data);
    const result=await rescheduleBooking(orgId,x.id,x.date,x.time,x.staffId,a.user.id);
    return NextResponse.json(result);
  }
  if(action==="booking.status"){
    const id=z.string().uuid().parse(data.id),status=z.enum(["pending","confirmed","checked_in","completed","cancelled","no_show"]).parse(data.status),reason=z.string().max(500).optional().parse(data.reason)||"";
    const old=await db.appointment.findFirst({where:{orgId,id}});if(!old)throw new AppError(404,"نوبت پیدا نشد");
    if(a.member.role==="staff"&&(old.staffId!==a.member.staffId||!["checked_in","completed"].includes(status)))throw new AppError(403,"متخصص فقط می‌تواند نوبت‌های خود را پذیرش یا تکمیل کند");
    if(!STATUSES[old.status]?.includes(status))throw new AppError(409,"تغییر وضعیت مجاز نیست");if(status==="cancelled"&&!reason.trim())throw new AppError(422,"دلیل لغو الزامی است");
    await db.$transaction(async tx=>{
      const group=await tx.appointment.findMany({where:{orgId,...(old.bookingRef?{bookingRef:old.bookingRef}:{id:old.id})}});
      if(!group.length||!group.every(g=>STATUSES[g.status]?.includes(status)))throw new AppError(409,"وضعیت رزرو تغییر کرده است");
      if(a.member.role==="staff"&&!group.every(g=>g.staffId===a.member.staffId))throw new AppError(403,"دسترسی غیرمجاز");
      const x=await tx.appointment.updateMany({where:{orgId,id:{in:group.map(g=>g.id)},status:old.status},data:{status}});
      if(x.count!==group.length)throw new AppError(409,"وضعیت رزرو تغییر کرده است");
      for(const g of group)await tx.appointmentEvent.create({data:{orgId,appointmentId:g.id,actorId:a.user.id,action:"status_changed",details:{from:g.status,to:status,reason}}});
      await tx.notification.create({data:{orgId,kind:"status_changed",title:"وضعیت رزرو تغییر کرد",body:`${group.length} خدمت به ${status} تغییر کرد`}});
    },{isolationLevel:"Serializable"});return NextResponse.json({ok:true});
  }
  if(action==="payment.manual"){
    const x=z.object({appointmentId:z.string().uuid(),amount:z.number().int().positive(),method:z.enum(["cash","card","transfer"])}).parse(data);
    // Lock the appointment row so two simultaneous cash entries cannot exceed the outstanding balance.
    const p=await db.$transaction(async tx=>{
      const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Appointment" WHERE id=${x.appointmentId}::uuid AND "orgId"=${orgId}::uuid FOR UPDATE`;
      if(!locked.length)throw new AppError(404,"نوبت پیدا نشد");
      const app=await tx.appointment.findFirst({where:{id:x.appointmentId,orgId}});
      if(!app)throw new AppError(404,"نوبت پیدا نشد");
      const paid=await tx.payment.aggregate({where:{orgId,appointmentId:app.id,status:"paid"},_sum:{amount:true}});
      if(x.amount>Math.max(0,app.price-app.discount-(paid._sum.amount||0)))throw new AppError(422,"مبلغ پرداخت بیشتر از مانده قابل دریافت این نوبت است");
      const result=await tx.payment.create({data:{orgId,appointmentId:x.appointmentId,amount:x.amount,method:x.method,status:"paid"}});
      await tx.audit.create({data:{orgId,userId:a.user.id,action:"manual_payment_recorded",objectType:"appointment",objectId:app.id}});
      return result;
    },{isolationLevel:"Serializable"});
    return NextResponse.json({item:p});
  }
  if(action==="notification.read"){
    const id=z.string().uuid().parse(data.id);await db.notification.updateMany({where:{id,orgId},data:{read:true}});return NextResponse.json({ok:true});
  }
  if(action==="settings.save"){
    const x=z.object({name:z.string().trim().min(2).max(150).optional(),phone:z.string().max(30).optional(),address:z.string().max(500).optional(),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),bookingEnabled:z.boolean().optional(),approvalRequired:z.boolean().optional(),noticeMinutes:z.number().int().min(0).max(10080).optional(),bookAheadDays:z.number().int().min(1).max(365).optional(),cancellationHours:z.number().int().min(0).max(720).optional(),depositPercent:z.number().int().min(0).max(100).optional(),cancellationPolicy:z.string().max(2000).optional()}).parse(data.payload);
    const org=await db.organization.update({where:{id:orgId},data:x});return NextResponse.json({item:org});
  }
  if(action==="staff.schedule"){
    const x=z.object({staffId:z.string().uuid(),hours:z.array(z.object({weekday:z.number().int().min(0).max(6),starts:z.string().regex(/^\d\d:\d\d$/),ends:z.string().regex(/^\d\d:\d\d$/),breakStart:z.string().regex(/^\d\d:\d\d$/).nullable().optional(),breakEnd:z.string().regex(/^\d\d:\d\d$/).nullable().optional()}))}).parse(data);
    if(!await db.staff.findFirst({where:{orgId,id:x.staffId}}))throw new AppError(404,"متخصص پیدا نشد");
    await db.$transaction([db.staffHours.deleteMany({where:{staffId:x.staffId}}),db.staffHours.createMany({data:x.hours.map(h=>({...h,staffId:x.staffId}))})]);return NextResponse.json({ok:true});
  }
  if(action==="branch.hours"){
    const x=z.object({branchId:z.string().uuid(),hours:z.array(z.object({weekday:z.number().int().min(0).max(6),opens:z.string().regex(/^\d\d:\d\d$/),closes:z.string().regex(/^\d\d:\d\d$/),closed:z.boolean()}))}).parse(data);
    if(!await db.branch.findFirst({where:{orgId,id:x.branchId}}))throw new AppError(404,"شعبه پیدا نشد");
    await db.$transaction([db.branchHours.deleteMany({where:{branchId:x.branchId}}),db.branchHours.createMany({data:x.hours.map(h=>({...h,branchId:x.branchId}))})]);return NextResponse.json({ok:true});
  }
  if(action==="staff.assign"){
    const x=z.object({staffId:z.string().uuid(),serviceIds:z.array(z.string().uuid())}).parse(data);
    if(!await db.staff.findFirst({where:{orgId,id:x.staffId}}))throw new AppError(404,"متخصص پیدا نشد");
    if((await db.service.count({where:{orgId,id:{in:x.serviceIds}}}))!==new Set(x.serviceIds).size)throw new AppError(422,"خدمات معتبر نیست");
    await db.$transaction([db.staffService.deleteMany({where:{staffId:x.staffId}}),db.staffService.createMany({data:x.serviceIds.map(serviceId=>({staffId:x.staffId,serviceId}))})]);return NextResponse.json({ok:true});
  }
  if(action==="customer.credit.adjust"){
    const x=z.object({customerId:z.string().uuid(),change:z.number().int().min(-100000000).max(100000000).refine(x=>x!==0),note:z.string().trim().min(3).max(500)}).parse(data);
    const result=await db.$transaction(async tx=>{
      const cust=await tx.customer.findFirst({where:{orgId,id:x.customerId}});
      if(!cust)throw new AppError(404,"مشتری پیدا نشد");
      const next=cust.credit+x.change;if(next<0)throw new AppError(409,"اعتبار مشتری کافی نیست");
      const updated=await tx.customer.update({where:{id:cust.id},data:{credit:next}});
      await tx.creditTransaction.create({data:{orgId,customerId:cust.id,change:x.change,balanceAfter:next,note:x.note,actorId:a.user.id}});
      await tx.audit.create({data:{orgId,userId:a.user.id,action:"credit_adjusted",objectType:"customer",objectId:cust.id}});
      return updated;
    },{isolationLevel:"Serializable"});
    return NextResponse.json({item:result});
  }
  if(action==="package.redeem"){
    const x=z.object({customerPackageId:z.string().uuid(),appointmentId:z.string().uuid()}).parse(data);
    await db.$transaction(async tx=>{
      const cp=await tx.customerPackage.findFirst({where:{id:x.customerPackageId,orgId}});
      const appointment=await tx.appointment.findFirst({where:{id:x.appointmentId,orgId}});
      if(!cp||!appointment||appointment.customerId!==cp.customerId)throw new AppError(422,"بسته یا نوبت متعلق به مشتری نیست");
      const pack=await tx.package.findFirst({where:{id:cp.packageId,orgId}});
      if(!pack||pack.serviceId!==appointment.serviceId)throw new AppError(422,"این بسته شامل خدمت نوبت نیست");
      if(cp.remaining<1||cp.expiresAt<new Date())throw new AppError(409,"اعتبار بسته تمام یا منقضی شده است");
      if(await tx.packageUsage.findFirst({where:{appointmentId:appointment.id}}))throw new AppError(409,"این خدمت قبلاً با یک بسته تسویه شده است");
      const updated=await tx.customerPackage.updateMany({where:{id:cp.id,orgId,remaining:{gt:0},expiresAt:{gt:new Date()}},data:{remaining:{decrement:1}}});
      if(!updated.count)throw new AppError(409,"ظرفیت بسته تمام شده است");
      await tx.packageUsage.create({data:{orgId,customerPackageId:cp.id,appointmentId:appointment.id,actorId:a.user.id}});
      await tx.audit.create({data:{orgId,userId:a.user.id,action:"package_redeemed",objectType:"appointment",objectId:appointment.id}});
    },{isolationLevel:"Serializable"});return NextResponse.json({ok:true});
  }
  if(action==="package.assign"){
    const x=z.object({packageId:z.string().uuid(),customerId:z.string().uuid()}).parse(data);
    const [p,c]=await Promise.all([db.package.findFirst({where:{id:x.packageId,orgId,active:true}}),db.customer.findFirst({where:{id:x.customerId,orgId}})]);if(!p||!c)throw new AppError(422,"بسته یا مشتری معتبر نیست");
    await db.customerPackage.create({data:{orgId,packageId:p.id,customerId:c.id,remaining:p.sessions,expiresAt:new Date(Date.now()+p.expiresDays*86400000)}});return NextResponse.json({ok:true});
  }
  throw new AppError(404,"عملیات ناشناخته است");
}catch(e){return fail(e);}}
