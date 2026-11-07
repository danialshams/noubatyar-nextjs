import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {createHash} from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword,checkPassword,setSession,clearSession,AppError,fail,hitRate,requestKey,requireOrigin,currentUser } from "@/lib/auth";
const registerSchema=z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().toLowerCase().email(),password:z.string().min(10).max(150),businessName:z.string().trim().min(2).max(150)});
const loginSchema=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(1).max(150)});
export async function GET(_req:NextRequest,{params}:{params:Promise<{action:string}>}){const {action}=await params;if(action!=="me")return NextResponse.json({error:"یافت نشد"},{status:404});const a=await currentUser();return a?NextResponse.json({name:a.user.name,email:a.user.email,business:a.org.name,slug:a.org.slug,role:a.member.role}):NextResponse.json({error:"ابتدا وارد شوید"},{status:401});}
export async function POST(req:NextRequest,{params}:{params:Promise<{action:string}>}){try{if(PUBLIC_DEMO_MODE)return Response.json({error:"این قابلیت در پیش‌نمایش عمومی غیرفعال است"},{status:403});
  const {action}=await params;requireOrigin(req);
  if(action==="logout"){const r=NextResponse.json({ok:true});clearSession(r);return r;}
  if(action==="accept-invite"){
    await hitRate(requestKey(req,"accept-invite"),15);
    const x=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().max(120).optional(),password:z.string().min(1).max(150)}).parse(await req.json());
    const tokenHash=createHash("sha256").update(x.token).digest("hex");
    const invitation=await db.teamInvite.findUnique({where:{tokenHash}});
    if(!invitation||invitation.usedAt||invitation.expiresAt<new Date())throw new AppError(404,"دعوت‌نامه معتبر نیست");
    const user=await db.user.findUnique({where:{email:invitation.email}});
    if(user&&!user.active)throw new AppError(403,"حساب کاربری غیرفعال است");
    if(user&&!checkPassword(x.password,user.passwordHash))throw new AppError(401,"رمز عبور حساب درست نیست");
    if(!user&&(!x.name||x.name.length<2||x.password.length<10))throw new AppError(422,"نام و رمز عبور حداقل ۱۰ کاراکتری لازم است");
    const uid=await db.$transaction(async tx=>{
      const used=await tx.teamInvite.updateMany({where:{id:invitation.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
      if(!used.count)throw new AppError(409,"دعوت‌نامه قبلاً استفاده شده است");
      const joined=user||await tx.user.create({data:{name:x.name!,email:invitation.email,passwordHash:hashPassword(x.password)}});
      await tx.membership.upsert({where:{orgId_userId:{orgId:invitation.orgId,userId:joined.id}},create:{orgId:invitation.orgId,userId:joined.id,role:invitation.role,staffId:invitation.staffId},update:{role:invitation.role,staffId:invitation.staffId}});
      return joined.id;
    });
    const r=NextResponse.json({ok:true});setSession(r,uid,invitation.orgId);return r;
  }
  if(action==="register"){
    await hitRate(requestKey(req,"signup"),12);const x=registerSchema.parse(await req.json());
    if(await db.user.findUnique({where:{email:x.email}}))throw new AppError(409,"این ایمیل قبلاً ثبت شده است");
    const a=await db.$transaction(async tx=>{
      const user=await tx.user.create({data:{name:x.name,email:x.email,passwordHash:hashPassword(x.password)}});
      const slug="biz-"+crypto.randomUUID().slice(0,8);
      const org=await tx.organization.create({data:{name:x.businessName,slug}});
      await tx.membership.create({data:{orgId:org.id,userId:user.id,role:"owner"}});
      const b=await tx.branch.create({data:{orgId:org.id,name:"شعبه اصلی"}});
      await tx.branchHours.createMany({data:Array.from({length:7},(_,weekday)=>({branchId:b.id,weekday,opens:"09:00",closes:"19:00",closed:weekday===4}))});
      return{user,org};
    });const r=NextResponse.json({ok:true,slug:a.org.slug});setSession(r,a.user.id,a.org.id);return r;
  }
  if(action==="login"){
    await hitRate(requestKey(req,"login"),30);const x=loginSchema.parse(await req.json());const user=await db.user.findUnique({where:{email:x.email}});
    if(!user||!user.active||!checkPassword(x.password,user.passwordHash))throw new AppError(401,"ایمیل یا رمز عبور اشتباه است");
    const member=await db.membership.findFirst({where:{userId:user.id},orderBy:{id:"asc"}});if(!member)throw new AppError(403,"برای این حساب کسب‌وکاری تعریف نشده است");
    const r=NextResponse.json({ok:true});setSession(r,user.id,member.orgId);return r;
  }
  throw new AppError(404,"عملیات یافت نشد");
}catch(e){return fail(e);}}
