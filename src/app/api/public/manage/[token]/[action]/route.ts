import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import { NextRequest,NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AppError,fail,requireOrigin,hitRate,requestKey } from "@/lib/auth";
import { z } from "zod";
export async function GET(_req:NextRequest,{params}:{params:Promise<{token:string;action:string}>}){try{if(PUBLIC_DEMO_MODE)return Response.json({error:"این قابلیت در پیش‌نمایش عمومی غیرفعال است"},{status:403});const{token,action}=await params;if(action!=="info")throw new AppError(404,"یافت نشد");const a=await db.appointment.findUnique({where:{publicToken:token}});if(!a)throw new AppError(404,"نوبت پیدا نشد");const [group,st,org]=await Promise.all([db.appointment.findMany({where:{orgId:a.orgId,...(a.bookingRef?{bookingRef:a.bookingRef}:{id:a.id})},orderBy:{startsAt:"asc"}}),db.staff.findUnique({where:{id:a.staffId}}),db.organization.findUnique({where:{id:a.orgId}})]);
  const serviceRows=await db.service.findMany({where:{orgId:a.orgId,id:{in:group.map(g=>g.serviceId)}}});
  const byId=new Map(serviceRows.map(s=>[s.id,s.name]));
  return NextResponse.json({date:a.startsAt,service:group.map(x=>byId.get(x.serviceId)).filter(Boolean).join("، "),staff:st?.name,business:org?.name,status:a.status,cancellationHours:org?.cancellationHours,canCancel:group.every(g=>["confirmed","pending"].includes(g.status)&&g.startsAt.getTime()-Date.now()>=(org?.cancellationHours??0)*3600000)});}catch(e){return fail(e);}}
export async function POST(req:NextRequest,{params}:{params:Promise<{token:string;action:string}>}){try{if(PUBLIC_DEMO_MODE)return Response.json({error:"این قابلیت در پیش‌نمایش عمومی غیرفعال است"},{status:403});requireOrigin(req);const{token,action}=await params;await hitRate(requestKey(req,"manage"),25);const a=await db.appointment.findUnique({where:{publicToken:token}});if(!a)throw new AppError(404,"نوبت پیدا نشد");const org=await db.organization.findUnique({where:{id:a.orgId}});if(!org)throw new AppError(404,"یافت نشد");if(action==="cancel"){
  if(!["confirmed","pending"].includes(a.status)||a.startsAt.getTime()-Date.now()<org.cancellationHours*3600000)throw new AppError(409,"مهلت لغو نوبت به پایان رسیده است");
  const data=z.object({reason:z.string().trim().min(3).max(500)}).parse(await req.json());
  await db.$transaction(async tx=>{
    const group=await tx.appointment.findMany({where:{orgId:a.orgId,...(a.bookingRef?{bookingRef:a.bookingRef}:{id:a.id})}});
    if(!group.length||group.some(x=>!["confirmed","pending"].includes(x.status)||x.startsAt.getTime()-Date.now()<org.cancellationHours*3600000))throw new AppError(409,"مهلت لغو یا وضعیت یک خدمت تغییر کرده است");
    const result=await tx.appointment.updateMany({where:{orgId:a.orgId,id:{in:group.map(x=>x.id)},status:{in:["confirmed","pending"]}},data:{status:"cancelled"}});
    if(result.count!==group.length)throw new AppError(409,"وضعیت نوبت تغییر کرده است");
    for(const item of group)await tx.appointmentEvent.create({data:{orgId:a.orgId,appointmentId:item.id,action:"cancelled_by_customer",details:{reason:data.reason}}});
    await tx.notification.create({data:{orgId:a.orgId,kind:"cancelled",title:"لغو رزرو توسط مشتری",body:`${group.length} خدمت لغو شد؛ دلیل: ${data.reason}`}});
  },{isolationLevel:"Serializable"});return NextResponse.json({ok:true});
 }
 if(action==="feedback"){
    if(a.status!=="completed")throw new AppError(403,"ثبت نظر بعد از تکمیل نوبت امکان‌پذیر است");
    const x=z.object({rating:z.number().int().min(1).max(5),comment:z.string().max(1000)}).parse(await req.json());
    await db.feedback.create({data:{orgId:a.orgId,appointmentId:a.id,...x}});return NextResponse.json({ok:true});
 }
 throw new AppError(404,"عملیات یافت نشد");
}catch(e){return fail(e);}}
