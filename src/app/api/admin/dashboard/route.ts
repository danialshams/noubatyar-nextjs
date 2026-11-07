import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth,fail } from "@/lib/auth";
import {PUBLIC_DEMO_MODE,demoDashboard} from "@/lib/public-demo";
export async function GET(){try{if(PUBLIC_DEMO_MODE)return NextResponse.json(demoDashboard(),{headers:{"Cache-Control":"public, max-age=60"}});const{org,member}=await requireAuth();const now=new Date(),dayEnd=new Date(now.getTime()+24*3600000),future=new Date(now.getTime()+7*86400000);
  const scope={orgId:org.id,...(member.role==="staff"?{staffId:member.staffId||"none"}:{})};
  const [today,week,pending,customers,services,payments,upcoming,notifications]=await Promise.all([
    db.appointment.count({where:{...scope,startsAt:{gte:now,lt:dayEnd},status:{in:["pending","confirmed","checked_in"]}}}),
    db.appointment.count({where:{...scope,startsAt:{gte:now,lt:future}}}),
    db.appointment.count({where:{...scope,status:"pending"}}),
    member.role==="staff"?db.appointment.findMany({where:{orgId:org.id,staffId:member.staffId||"none"},select:{customerId:true},distinct:["customerId"]}).then(x=>x.length):db.customer.count({where:{orgId:org.id}}),db.service.count({where:{orgId:org.id,active:true}}),
    member.role==="staff"?Promise.resolve([]):db.payment.findMany({where:{orgId:org.id,status:"paid"},select:{amount:true}}),
    db.appointment.findMany({where:{...scope,startsAt:{gte:now},status:{in:["pending","confirmed","checked_in"]}},orderBy:{startsAt:"asc"},take:10}),
    member.role==="staff"?Promise.resolve([]):db.notification.findMany({where:{orgId:org.id,read:false,channel:"in_app"},take:8,orderBy:{createdAt:"desc"}})
  ]);
  const ids=upcoming.map(a=>a.customerId),sid=upcoming.map(a=>a.serviceId),stid=upcoming.map(a=>a.staffId);
  const [cs,ss,st]=await Promise.all([db.customer.findMany({where:{id:{in:ids},orgId:org.id},select:{id:true,name:true}}),db.service.findMany({where:{id:{in:sid},orgId:org.id},select:{id:true,name:true}}),db.staff.findMany({where:{id:{in:stid},orgId:org.id},select:{id:true,name:true}})]);
  const m=(v:{id:string;name:string}[])=>new Map(v.map(x=>[x.id,x.name]));const c=m(cs),s=m(ss),t=m(st);
  return NextResponse.json({today,week,pending,customers,services,revenue:payments.reduce((n,p)=>n+p.amount,0),upcoming:upcoming.map(a=>({...a,customerName:c.get(a.customerId),serviceName:s.get(a.serviceId),staffName:t.get(a.staffId)})),notifications,business:org.name,slug:org.slug,role:member.role});
}catch(e){return fail(e);}}
