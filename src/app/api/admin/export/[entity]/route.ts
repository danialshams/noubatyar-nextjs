import { NextRequest,NextResponse } from "next/server";
import {PUBLIC_DEMO_MODE,demoRows} from "@/lib/public-demo";
import { db } from "@/lib/db";
import { requireAuth,fail,AppError } from "@/lib/auth";
export async function GET(_req:NextRequest,{params}:{params:Promise<{entity:string}>}){try{
  const {entity}=await params;if(!["customers","appointments","payments"].includes(entity))throw new AppError(404,"خروجی پشتیبانی نمی‌شود");if(PUBLIC_DEMO_MODE){const rows=demoRows(entity);const fields=rows.length?Object.keys(rows[0]).filter(k=>!/(token|password|secret)/i.test(k)):[];const quote=(v:unknown)=>`"${String(v??"").replaceAll(String.fromCharCode(34),String.fromCharCode(34,34))}"`;const csv="\ufeff"+[fields.join(","),...rows.map(x=>fields.map(k=>quote(x[k])).join(","))].join("\r\n");return new NextResponse(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${entity}-demo.csv"`}});}const{org,member}=await requireAuth();if(member.role==="staff"&&entity==="payments")throw new AppError(403,"دسترسی غیرمجاز");
  const store=(db as unknown as Record<string,any>)[entity.slice(0,-1)] as {findMany:(args:any)=>Promise<Record<string,unknown>[]>};
  const where:Record<string,unknown>={orgId:org.id};
  if(member.role==="staff"&&entity==="appointments")where.staffId=member.staffId||"none";
  if(member.role==="staff"&&entity==="customers"){
    const allowed=await db.appointment.findMany({where:{orgId:org.id,staffId:member.staffId||"none"},select:{customerId:true}});
    where.id={in:allowed.map(x=>x.customerId)};
  }
  const items=await store.findMany({where,take:10000});
  const cols=items.length?Object.keys(items[0]).filter(k=>!k.toLowerCase().includes("token")):[];
  const q=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
  const csv="\ufeff"+[cols.join(","),...items.map(x=>cols.map(k=>q(x[k] instanceof Date?(x[k] as Date).toISOString():x[k])).join(","))].join("\r\n");
  return new NextResponse(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${entity}.csv"`}});
}catch(e){return fail(e);}}
