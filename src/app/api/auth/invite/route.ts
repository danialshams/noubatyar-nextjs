import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {AppError,fail,hitRate,requestKey} from '@/lib/auth';
export async function GET(req:NextRequest){try{if(PUBLIC_DEMO_MODE)return Response.json({error:"این قابلیت در پیش‌نمایش عمومی غیرفعال است"},{status:403});
  await hitRate(requestKey(req,'invite-preview'),80);
  const token=req.nextUrl.searchParams.get('token')||'';
  if(!/^[a-f0-9]{64}$/.test(token))throw new AppError(404,'دعوت‌نامه معتبر نیست');
  const tokenHash=createHash('sha256').update(token).digest('hex');
  const invite=await db.teamInvite.findUnique({where:{tokenHash}});
  if(!invite||invite.usedAt||invite.expiresAt<new Date())throw new AppError(404,'دعوت‌نامه منقضی شده است');
  const org=await db.organization.findUnique({where:{id:invite.orgId},select:{name:true}});
  return NextResponse.json({business:org?.name,role:invite.role,email:invite.email});
}catch(e){return fail(e);}}
