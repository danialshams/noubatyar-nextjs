import { NextRequest,NextResponse } from "next/server";
import {PUBLIC_DEMO_MODE,DEMO_SLUG,demoCatalog,demoSlots} from "@/lib/public-demo";
import { z } from "zod";
import { db } from "@/lib/db";
import { availablePublic,createBooking,bookingSchema } from "@/lib/booking";
import { AppError,fail,hitRate,requestKey,requireOrigin } from "@/lib/auth";
import {normalizeIranMobile} from "@/lib/numbers";
import {validDate} from "@/lib/time";
async function findOrg(slug:string){const org=await db.organization.findUnique({where:{slug}});if(!org||!org.bookingEnabled)throw new AppError(404,"صفحه رزرو پیدا نشد");return org;}
export async function GET(req:NextRequest,{params}:{params:Promise<{slug:string;action:string}>}){try{
  const{slug,action}=await params;if(PUBLIC_DEMO_MODE){if(slug!==DEMO_SLUG)throw new AppError(404,"صفحه رزرو پیدا نشد");if(action==="catalog")return NextResponse.json(demoCatalog());if(action==="slots"){const q=req.nextUrl.searchParams;return NextResponse.json({slots:demoSlots(q.get("branchId")||"",(q.get("serviceIds")||"").split(",").filter(Boolean),q.get("staffId")||undefined,q.get("date")||"")});}throw new AppError(404,"یافت نشد");}const org=await findOrg(slug);
  if(action==="catalog"){
    const [branches,services,staff,staffServices]=await Promise.all([
      db.branch.findMany({where:{orgId:org.id,active:true}}),db.service.findMany({where:{orgId:org.id,active:true,public:true}}),db.staff.findMany({where:{orgId:org.id,active:true}}),db.staffService.findMany({where:{serviceId:{in:(await db.service.findMany({where:{orgId:org.id,active:true,public:true},select:{id:true}})).map(x=>x.id)}}})]);
    return NextResponse.json({business:{name:org.name,slug:org.slug,accent:org.accent,timezone:org.timezone,bookAheadDays:org.bookAheadDays,policy:org.cancellationPolicy,depositPercent:org.depositPercent},branches:branches.map(x=>({id:x.id,name:x.name,address:x.address})),services:services.map(s=>({id:s.id,name:s.name,description:s.description,category:s.category,duration:s.duration,price:s.price,deposit:s.deposit,capacity:s.capacity})),staff:staff.map(s=>({id:s.id,name:s.name,title:s.title,slug:s.slug,branchId:s.branchId,serviceIds:staffServices.filter(x=>x.staffId===s.id).map(x=>x.serviceId)}))});
  }
  if(action==="slots"){
    await hitRate(requestKey(req,"slots:"+org.id),180);const url=req.nextUrl.searchParams;
    const day=url.get("date")||"";const branch=url.get("branchId")||"";const services=(url.get("serviceIds")||"").split(",").filter(Boolean);const staff=url.get("staffId")||undefined;
    if(!z.string().uuid().safeParse(branch).success||services.length>5||services.length===0||!services.every(x=>z.string().uuid().safeParse(x).success))throw new AppError(422,"خدمات معتبر نیست");
    const allowed=await db.service.count({where:{orgId:org.id,id:{in:services},public:true,active:true}});if(allowed!==services.length)throw new AppError(422,"خدمات معتبر نیست");
    const available=await availablePublic(org.id,branch,services,day,staff);return NextResponse.json({slots:available});
  }
  throw new AppError(404,"یافت نشد");
}catch(e){return fail(e);}}
export async function POST(req:NextRequest,{params}:{params:Promise<{slug:string;action:string}>}){try{
  const {slug,action}=await params;if(PUBLIC_DEMO_MODE)throw new AppError(403,"نسخه نمایشی فقط برای بازدید است؛ رزرو واقعی یا تغییر اطلاعات غیرفعال است");requireOrigin(req);const org=await findOrg(slug);
  if(action==="book"){
    await hitRate(requestKey(req,"booking:"+org.id),15);const body=await req.json();if(body.website)throw new AppError(422,"درخواست معتبر نیست");
    const data=bookingSchema.parse({...body,phone:normalizeIranMobile(String(body.phone||""))});const publicServices=await db.service.count({where:{id:{in:data.serviceIds},orgId:org.id,public:true,active:true}});
    if(publicServices!==data.serviceIds.length)throw new AppError(422,"خدمت برای رزرو آنلاین فعال نیست");
    const result=await createBooking(org.id,data,"online");return NextResponse.json(result,{status:201});
  }
  if(action==="waitlist"){
    await hitRate(requestKey(req,"waitlist:"+org.id),10);
    const raw=await req.json();const x=z.object({branchId:z.string().uuid(),serviceId:z.string().uuid(),customerName:z.string().trim().min(2).max(120),phone:z.string().regex(/^(?:\+?98|0)?9\d{9}$/),preferredDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse({...raw,phone:normalizeIranMobile(String(raw.phone||""))});
    if(!validDate(x.preferredDate))throw new AppError(422,"تاریخ معتبر نیست");
    const [b,s]=await Promise.all([db.branch.findFirst({where:{id:x.branchId,orgId:org.id,active:true}}),db.service.findFirst({where:{id:x.serviceId,orgId:org.id,public:true,active:true}})]);if(!b||!s)throw new AppError(422,"خدمت یا شعبه معتبر نیست");
    await db.waitlist.create({data:{orgId:org.id,...x}});return NextResponse.json({ok:true},{status:201});
  }
  throw new AppError(404,"عملیات یافت نشد");
}catch(e){return fail(e);}}
