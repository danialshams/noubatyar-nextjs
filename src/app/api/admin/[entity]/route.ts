import { NextRequest,NextResponse } from "next/server";
import {PUBLIC_DEMO_MODE,demoTable} from "@/lib/public-demo";
import { db } from "@/lib/db";
import { requireAuth,requireOrigin,AppError,fail } from "@/lib/auth";
import { entityDefinitions,readOnlyEntities,isMutableEntity,isEntity } from "@/lib/entities";
import { z } from "zod";
import { validateForeign } from "@/lib/validation";
import {zonedDate,daysFrom,validDate} from "@/lib/time";
import {normalizeIranMobile} from "@/lib/numbers";

const objectStore=(name:string)=> (db as unknown as Record<string,any>)[name] as {findMany:(x:any)=>Promise<any[]>;findFirst:(x:any)=>Promise<any>;create:(x:any)=>Promise<any>;};
export async function GET(req:NextRequest,{params}:{params:Promise<{entity:string}>}){try{
  const {entity}=await params;if(!isEntity(entity))throw new AppError(404,"بخش یافت نشد");if(PUBLIC_DEMO_MODE){const q=req.nextUrl.searchParams;return NextResponse.json(demoTable(entity,q.get("q")||"",Number(q.get("limit")||250),q.get("from")||undefined,q.get("to")||undefined));}const {org,member}=await requireAuth();
  const modelName=isMutableEntity(entity)?entityDefinitions[entity].model:readOnlyEntities[entity as keyof typeof readOnlyEntities];const store=objectStore(modelName);
  const search=req.nextUrl.searchParams.get("q")||"";const limit=Math.min(250,Math.max(1,Number(req.nextUrl.searchParams.get("limit")||100)));
  const where:Record<string,unknown>={orgId:org.id};
  if(entity==="appointments"){
    const from=req.nextUrl.searchParams.get("from"),to=req.nextUrl.searchParams.get("to");
    if(from&&to){if(!validDate(from)||!validDate(to)||to<from)throw new AppError(422,"بازه تاریخ نامعتبر است");
      where.startsAt={gte:zonedDate(from,0,org.timezone),lt:zonedDate(daysFrom(to,1),0,org.timezone)};}
  }
  if(member.role==="staff"){
    if(!["appointments","customers","services","staff","branches","resources","timeOff","holidays"].includes(entity))throw new AppError(403,"دسترسی غیرمجاز");
    if(entity==="timeOff")where.staffId=member.staffId||"none";
    if(entity==="appointments")where.staffId=member.staffId||"none";
    if(entity==="customers"){const own=await db.appointment.findMany({where:{orgId:org.id,staffId:member.staffId||"none"},select:{customerId:true}});where.id={in:own.map(x=>x.customerId)};}
  }
  if(search.length&&isMutableEntity(entity))where[entityDefinitions[entity].search]={contains:search.slice(0,80),mode:"insensitive"};
  const items=await store.findMany({where,take:limit,orderBy:entity==="appointments"?{startsAt:"asc"}:{id:"desc"}});
  if(entity==="team"){
    const people=await db.user.findMany({where:{id:{in:items.map(x=>x.userId)}},select:{id:true,name:true,email:true,active:true}});
    const byId=new Map(people.map(p=>[p.id,p]));
    return NextResponse.json({items:items.map(m=>({...m,name:byId.get(m.userId)?.name||"—",email:byId.get(m.userId)?.email||"—",active:byId.get(m.userId)?.active??false}))});
  }
  if(entity==="appointments"){
    const [customers,services,staff]=await Promise.all([db.customer.findMany({where:{orgId:org.id}}),db.service.findMany({where:{orgId:org.id}}),db.staff.findMany({where:{orgId:org.id}})]);
    const map=(arr:{id:string;name:string}[])=>new Map(arr.map(x=>[x.id,x.name]));const c=map(customers),s=map(services),st=map(staff);
    return NextResponse.json({items:items.map(a=>({...a,customerName:c.get(a.customerId)||"—",serviceName:s.get(a.serviceId)||"—",staffName:st.get(a.staffId)||"—"}))});
  }
  if(entity==="payments")return NextResponse.json({items,onlineProvider:"not_configured"});
  return NextResponse.json({items});
}catch(e){return fail(e);}}
export async function POST(req:NextRequest,{params}:{params:Promise<{entity:string}>}){try{if(PUBLIC_DEMO_MODE)throw new AppError(403,"نسخه نمایش عمومی فقط خواندنی است");
  requireOrigin(req);const {entity}=await params;if(!isMutableEntity(entity))throw new AppError(405,"این بخش فقط خواندنی است");const {org,user}=await requireAuth({write:true});const def=entityDefinitions[entity];
  // Zod schema input strictly removes orgId, status of booking and payment fields supplied by client.
  const raw=await req.json();if(entity==="customers")raw.phone=normalizeIranMobile(String(raw.phone||""));
  const data=(def.schema as z.AnyZodObject).parse(raw) as Record<string,any>;
  await validateForeign(entity,data,org.id);
  const staffServices=entity==="staff"?data.serviceIds as string[]|undefined:undefined;
  delete data.serviceIds;
  if(entity==="staff"&&!data.slug)data.slug=`staff-${crypto.randomUUID().slice(0,8)}`;
  if(entity==="coupons"){data.code=String(data.code).toUpperCase();if(data.kind==="percent"&&data.value>100)throw new AppError(422,"درصد تخفیف نامعتبر است");}
  if(entity==="customers")data.phone=String(data.phone).replace(/^(?:\+?98)/,"0");
  if(entity==="coupons"&&typeof data.expiresAt==="string")data.expiresAt=new Date(data.expiresAt);
  if(entity==="timeOff")for(const key of ["startsAt","endsAt"])data[key]=new Date(data[key]);
  const store=objectStore(def.model);
  const item=await store.create({data:{...data,orgId:org.id}});
  if(entity==="branches")await db.branchHours.createMany({data:Array.from({length:7},(_,weekday)=>({branchId:item.id,weekday,opens:"09:00",closes:"19:00",closed:weekday===4}))});
  if(entity==="staff"){
    await db.staffHours.createMany({data:Array.from({length:7},(_,weekday)=>({staffId:item.id,weekday,starts:"09:00",ends:"18:00"}))});
    if(staffServices?.length)await db.staffService.createMany({data:staffServices.map(serviceId=>({staffId:item.id,serviceId})),skipDuplicates:true});
  }
  await db.audit.create({data:{orgId:org.id,userId:user.id,action:"created",objectType:entity,objectId:item.id}});
  return NextResponse.json({item},{status:201});
}catch(e){return fail(e);}}

