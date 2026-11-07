import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  if(PUBLIC_DEMO_MODE)return NextResponse.json({error:"نمایش عمومی — پردازش اعلان غیرفعال است"},{status:403});
  const token=process.env.CRON_SECRET;
  // Never allow public cron invocation without a configured secret.
  if(!token||req.headers.get('authorization')!==`Bearer ${token}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  const jobs=await db.outbox.findMany({where:{channel:'in_app',status:'queued',dueAt:{lte:new Date()}},orderBy:{dueAt:'asc'},take:100});
  let processed=0;
  for(const job of jobs){
    await db.$transaction(async tx=>{
      const claimed=await tx.outbox.updateMany({where:{id:job.id,status:'queued'},data:{status:'processing',attempts:{increment:1}}});
      if(!claimed.count)return;
      const appt=await tx.appointment.findFirst({where:{id:job.appointmentId,orgId:job.orgId}});
      if(!appt||!['pending','confirmed','checked_in'].includes(appt.status)){
        await tx.outbox.update({where:{id:job.id},data:{status:'skipped'}});return;
      }
      const org=await tx.organization.findUnique({where:{id:job.orgId},select:{timezone:true}});
      const zone=org?.timezone||'Asia/Tehran';
      await tx.notification.upsert({where:{outboxId:job.id},create:{orgId:job.orgId,kind:'reminder',title:'یادآوری نوبت آینده',body:`یک نوبت در ${appt.startsAt.toLocaleString('fa-IR',{timeZone:zone})} در پیش است.`,channel:'in_app',state:'delivered',outboxId:job.id},update:{}});
      await tx.outbox.update({where:{id:job.id},data:{status:'sent'}});
      processed++;
    });
  }
  return NextResponse.json({ok:true,processed,checked:jobs.length});
}
