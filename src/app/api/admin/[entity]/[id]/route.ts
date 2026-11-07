import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import { NextRequest,NextResponse } from "next/server";
import { requireAuth,requireOrigin,AppError,fail } from "@/lib/auth";
import { db } from "@/lib/db";
import { entityDefinitions,isMutableEntity } from "@/lib/entities";
import { validateForeign } from "@/lib/validation";
import {normalizeIranMobile} from "@/lib/numbers";
import { z } from "zod";
const store=(name:string)=>(db as unknown as Record<string,any>)[name] as {findFirst:(a:any)=>Promise<any>;update:(a:any)=>Promise<any>;delete:(a:any)=>Promise<any>};
export async function PATCH(req:NextRequest,{params}:{params:Promise<{entity:string;id:string}>}){try{if(PUBLIC_DEMO_MODE)return Response.json({error:"نسخه نمایشی فقط خواندنی است"},{status:403});requireOrigin(req);const{entity,id}=await params;if(!isMutableEntity(entity))throw new AppError(405,"عملیات مجاز نیست");const{org,user}=await requireAuth({write:true});const def=entityDefinitions[entity];const model=store(def.model);
  const previous=await model.findFirst({where:{id,orgId:org.id}});if(!previous)throw new AppError(404,"رکورد پیدا نشد");
  const raw=await req.json();if(entity==="customers"&&raw.phone)raw.phone=normalizeIranMobile(String(raw.phone));
  const data=(def.schema as z.AnyZodObject).partial().parse(raw) as Record<string,any>;
  await validateForeign(entity,data,org.id);const serviceIds=data.serviceIds as string[]|undefined;delete data.serviceIds;
  if(entity==="coupons"&&data.code)data.code=String(data.code).toUpperCase();
  if(entity==="coupons"&&typeof data.expiresAt==="string")data.expiresAt=new Date(data.expiresAt);
  if(entity==="timeOff")for(const key of ["startsAt","endsAt"])if(typeof data[key]==="string")data[key]=new Date(data[key]);
  if(entity==="customers"&&data.phone)data.phone=String(data.phone).replace(/^(?:\+?98)/,"0");
  const item=await model.update({where:{id},data});
  if(entity==="staff"&&serviceIds){await db.staffService.deleteMany({where:{staffId:id}});if(serviceIds.length)await db.staffService.createMany({data:serviceIds.map(serviceId=>({staffId:id,serviceId}))});}
  await db.audit.create({data:{orgId:org.id,userId:user.id,action:"updated",objectType:entity,objectId:id}});
  return NextResponse.json({item});
}catch(e){return fail(e);}}
export async function DELETE(req:NextRequest,{params}:{params:Promise<{entity:string;id:string}>}){try{if(PUBLIC_DEMO_MODE)return Response.json({error:"نسخه نمایشی فقط خواندنی است"},{status:403});requireOrigin(req);const{entity,id}=await params;if(!isMutableEntity(entity))throw new AppError(405,"حذف مجاز نیست");const{org,user}=await requireAuth({write:true});const model=store(entityDefinitions[entity].model);
  const previous=await model.findFirst({where:{id,orgId:org.id}});if(!previous)throw new AppError(404,"رکورد پیدا نشد");
  // Soft delete wherever meaningful, never destroy appointment histories.
  let item:unknown;if("active" in previous)item=await model.update({where:{id},data:{active:false}});
  else if(entity==="waitlist")item=await model.update({where:{id},data:{status:"cancelled"}});
  else if(["holidays","timeOff"].includes(entity))item=await model.delete({where:{id}});
  else if(entity==="customers"){
    const count=await db.appointment.count({where:{orgId:org.id,customerId:id}});
    if(count)throw new AppError(409,"مشتری دارای سابقه رزرو است؛ حذف سوابق مجاز نیست");item=await model.delete({where:{id}});
  }else throw new AppError(405,"حذف این رکورد پشتیبانی نمی‌شود");
  await db.audit.create({data:{orgId:org.id,userId:user.id,action:"deleted",objectType:entity,objectId:id}});
  return NextResponse.json({ok:true,item});
}catch(e){return fail(e);}}
