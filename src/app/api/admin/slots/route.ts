import {PUBLIC_DEMO_MODE,demoSlots} from "@/lib/public-demo";
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {requireAuth,AppError,fail} from '@/lib/auth';
import {scheduleData} from '@/lib/booking';
import {computeAvailableSlots} from '@/lib/availability';
import {validDate} from '@/lib/time';
import {z} from 'zod';
export async function GET(req:NextRequest){try{if(PUBLIC_DEMO_MODE){const q=req.nextUrl.searchParams;return NextResponse.json({slots:demoSlots(q.get("branchId")||"",(q.get("serviceIds")||"").split(",").filter(Boolean),q.get("staffId")||undefined,q.get("date")||"")});}
 const {org,member}=await requireAuth();if(member.role==='staff')throw new AppError(403,'دسترسی غیرمجاز');
 const q=req.nextUrl.searchParams,branchId=z.string().uuid().parse(q.get('branchId'));
 const serviceIds=(q.get('serviceIds')||'').split(',').filter(Boolean),date=q.get('date')||'';
 const staffId=q.get('staffId')||undefined;
 if(!validDate(date)||serviceIds.length<1||serviceIds.length>5||!serviceIds.every(x=>z.string().uuid().safeParse(x).success))throw new AppError(422,'تاریخ یا خدمات معتبر نیست');
 const schedule=await scheduleData(org.id,branchId,serviceIds,date,staffId);
 return NextResponse.json({slots:computeAvailableSlots({...schedule,org:{...schedule.org,bookingEnabled:true}},date,staffId)});
}catch(e){return fail(e);}}
