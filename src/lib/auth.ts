import { createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
export class AppError extends Error {constructor(public status:number, message:string){super(message);}}
function secret(){const s=process.env.SESSION_SECRET; if(!s || s.length<32) throw new Error("SESSION_SECRET must be at least 32 characters");return s;}
export function hashPassword(password:string) {const salt=randomBytes(16).toString("hex");const key=scryptSync(password,salt,64).toString("hex");return `scrypt:${salt}:${key}`;}
export function checkPassword(password:string,hashed:string) {const [algorithm,salt,key]=hashed.split(":");if(algorithm!=="scrypt"||!salt||!key)return false;const expected=Buffer.from(key,"hex");const found=scryptSync(password,salt,expected.length);return expected.length===found.length && timingSafeEqual(expected,found);}
export type SessionPayload={uid:string;org:string;exp:number};
export function signSession(uid:string,org:string) {const payload=Buffer.from(JSON.stringify({uid,org,exp:Date.now()+7*86400000} satisfies SessionPayload)).toString("base64url");const sig=createHmac("sha256",secret()).update(payload).digest("base64url");return payload+"."+sig;}
export function parseSession(value?:string):SessionPayload|null {if(!value)return null;const [p,mac]=value.split(".");if(!p||!mac)return null;const sig=createHmac("sha256",secret()).update(p).digest("base64url");const a=Buffer.from(sig),b=Buffer.from(mac);if(a.length!==b.length||!timingSafeEqual(a,b))return null;try{const x=JSON.parse(Buffer.from(p,"base64url").toString()) as SessionPayload;return x.exp>Date.now()&&typeof x.uid==="string"&&typeof x.org==="string"?x:null;}catch{return null;}}
export function setSession(res:NextResponse,uid:string,org:string){res.cookies.set("ny_session",signSession(uid,org),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:604800});}
export function clearSession(res:NextResponse){res.cookies.delete("ny_session");}
export async function currentUser(){const session=parseSession((await cookies()).get("ny_session")?.value);if(!session)return null;const member=await db.membership.findUnique({where:{orgId_userId:{orgId:session.org,userId:session.uid}}});if(!member)return null;const [user,org]=await Promise.all([db.user.findUnique({where:{id:session.uid}}),db.organization.findUnique({where:{id:session.org}})]);if(!user?.active||!org)return null;return {user,org,member};}
export async function requireAuth(opts:{write?:boolean; owner?:boolean}={}){const a=await currentUser();if(!a)throw new AppError(401,"ابتدا وارد حساب خود شوید");if(opts.owner&&a.member.role!=="owner")throw new AppError(403,"دسترسی مدیر اصلی لازم است");if(opts.write&&!(["owner","manager"].includes(a.member.role)))throw new AppError(403,"اجازه تغییر اطلاعات ندارید");return a;}
export function requireOrigin(req:NextRequest){const origin=req.headers.get("origin");if(!origin)return;const expected=new URL(req.url).origin;const configured=process.env.APP_URL;const allowed=[expected,...(configured?[new URL(configured).origin]:[])];if(!allowed.includes(origin))throw new AppError(403,"درخواست از مبدأ غیرمجاز");}
export function requestKey(req:NextRequest,tag:string){const ip=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||"unknown";return createHash("sha256").update(`${tag}:${ip}`).digest("hex");}
export function isBookingCollision(error:unknown):boolean {
  if (!(error instanceof Error)) return false;
  const value=error as Error & {code?:string;meta?:{code?:string;database_error?:string}};
  // Prisma can wrap PostgreSQL exclusion/trigger violations as P2004 or P2010.
  const postgresCode=String(value.meta?.code||'');
  const details=String(value.meta?.database_error||'');
  return ['P2002','P2004','P2010','P2034'].includes(value.code||'') &&
    (['P2002','P2034'].includes(value.code||'') || /23P01|BOOKING_CONFLICT|exclusion|conflict/i.test(postgresCode+' '+details+' '+value.message))
    || /BOOKING_CONFLICT|23P01/i.test(value.message);
}
export async function hitRate(key:string,limit:number,windowMs=3600000){const now=new Date();const start=new Date(now.getTime()-windowMs);const record=await db.rateLimit.upsert({where:{key},create:{key,hits:1,windowStart:now},update:{hits:{increment:1}}});if(record.windowStart<start){await db.rateLimit.update({where:{key},data:{hits:1,windowStart:now}});return;}if(record.hits>limit)throw new AppError(429,"تعداد درخواست‌ها بیش از حد مجاز است");}
export function fail(error:unknown){if(error instanceof AppError)return NextResponse.json({error:error.message},{status:error.status});if(error instanceof Error&&error.name==="ZodError")return NextResponse.json({error:"اطلاعات واردشده معتبر نیست"},{status:422});if(isBookingCollision(error))return NextResponse.json({error:"زمان موردنظر دیگر آزاد نیست؛ ساعت دیگری انتخاب کنید"},{status:409});console.error("Server error:",error);return NextResponse.json({error:"خطای سرور؛ دوباره تلاش کنید"},{status:500});}
export async function headersSession(){void headers;return currentUser();}
