import { NextRequest,NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth,fail } from "@/lib/auth";
import {PUBLIC_DEMO_MODE,demoReports} from "@/lib/public-demo";
export async function GET(req:NextRequest){try{if(PUBLIC_DEMO_MODE)return NextResponse.json(demoReports());const{org,member}=await requireAuth();const from=req.nextUrl.searchParams.get("from");const to=req.nextUrl.searchParams.get("to");
  const a=from&&/^\d{4}-\d\d-\d\d$/.test(from)?new Date(`${from}T00:00:00Z`):new Date(Date.now()-30*86400000);
  const b=to&&/^\d{4}-\d\d-\d\d$/.test(to)?new Date(`${to}T23:59:59Z`):new Date();
  const where={orgId:org.id,startsAt:{gte:a,lte:b},...(member.role==="staff"?{staffId:member.staffId||"none"}:{})};
  const [bookings,payments,services,staff]=await Promise.all([db.appointment.findMany({where}),member.role==="staff"?Promise.resolve([]):db.payment.findMany({where:{orgId:org.id,status:"paid",createdAt:{gte:a,lte:b}}}),db.service.findMany({where:{orgId:org.id}}),db.staff.findMany({where:{orgId:org.id}})]);
  const status=Object.fromEntries(["pending","confirmed","checked_in","completed","cancelled","no_show"].map(x=>[x,bookings.filter(a=>a.status===x).length]));
  const fav=services.map(s=>({name:s.name,count:bookings.filter(a=>a.serviceId===s.id).length})).sort((x,y)=>y.count-x.count).slice(0,8);
  const performance=staff.map(s=>({name:s.name,bookings:bookings.filter(a=>a.staffId===s.id).length,completed:bookings.filter(a=>a.staffId===s.id&&a.status==="completed").length})).sort((x,y)=>y.completed-x.completed);
  return NextResponse.json({total:bookings.length,paid:payments.reduce((n,p)=>n+p.amount,0),status,favorites:fav,performance});
}catch(e){return fail(e);}}
