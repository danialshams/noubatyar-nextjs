import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {randomBytes,scryptSync} from "node:crypto";
import {zonedDate} from "../src/lib/time";
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
function hash(password:string){const salt=randomBytes(16).toString("hex");return `scrypt:${salt}:${scryptSync(password,salt,64).toString("hex")}`;}
async function run(){if(process.env.NODE_ENV==="production"||process.env.DEMO_SEED!=="true")throw Error("Demo seed is disabled: use DEMO_SEED=true in development only");
  const existing=await prisma.organization.findUnique({where:{slug:"demo-rose-salon"}});if(existing){console.log("Demo tenant already exists; no change");return;}
  const name="سالن زیبایی رز (نمایشی)";
  const org=await prisma.organization.create({data:{slug:"demo-rose-salon",name,category:"salon",phone:"02100000000",address:"تهران — اطلاعات نمایشی",noticeMinutes:0,bookAheadDays:90,accent:"#3265e8",cancellationPolicy:"لغو رایگان تا ۲۴ ساعت قبل از نوبت امکان‌پذیر است."}});
  const email="demo-admin@example.test",password="DemoOnly!2026-ChangeMe";
  const user=await prisma.user.upsert({where:{email},create:{name:"مدیر نمونه",email,passwordHash:hash(password)},update:{}});
  await prisma.membership.create({data:{orgId:org.id,userId:user.id,role:"owner"}});
  const b1=await prisma.branch.create({data:{orgId:org.id,name:"شعبه مرکزی",address:"تهران، خیابان نمونه"}});
  const b2=await prisma.branch.create({data:{orgId:org.id,name:"شعبه شمال",address:"تهران، میدان نمونه"}});
  const branches=[b1,b2];
  for(const b of branches)await prisma.branchHours.createMany({data:Array.from({length:7},(_,weekday)=>({branchId:b.id,weekday,opens:weekday===4?"09:00":"09:00",closes:weekday===4?"13:00":"19:00",closed:false}))});
  const room=await prisma.resource.create({data:{orgId:org.id,branchId:b1.id,name:"اتاق خدمات پوست",kind:"room"}});
  const spec=[
    ["مشاوره اولیه",30,120000,"مشاوره"],["اصلاح و کوتاهی",45,350000,"مو"],["رنگ و لایت",90,1200000,"مو"],["پاکسازی پوست",60,550000,"پوست"],["میکاپ ویژه",90,1400000,"آرایش"],["کارگاه گروهی",60,180000,"آموزش"]
  ] as const;
  const services=[];
  for(const [nm,duration,price,category] of spec)services.push(await prisma.service.create({data:{orgId:org.id,name:nm,description:"خدمت نمونه قابل رزرو",duration,price,category,capacity:nm==="کارگاه گروهی"?4:1,resourceId:nm==="پاکسازی پوست"?room.id:null}}));
  const staff=[];
  for(const [i,nm] of ["سارا احمدی","نیلوفر رضایی","مریم اکبری","پریسا محمدی","الناز کریمی"].entries()){
    const branchId=i<3?b1.id:b2.id;
    const st=await prisma.staff.create({data:{orgId:org.id,branchId,name:nm,slug:`expert-${i+1}`,title:"متخصص خدمات زیبایی",priority:5-i}});staff.push(st);
    await prisma.staffHours.createMany({data:Array.from({length:7},(_,weekday)=>({staffId:st.id,weekday,starts:"09:00",ends:"18:00",breakStart:"13:00",breakEnd:"14:00"}))});
    await prisma.staffService.createMany({data:services.filter(s=>s.resourceId===null||branchId===b1.id).filter((_,si)=>si!==4||i!==4).map(s=>({staffId:st.id,serviceId:s.id}))});
  }
  const customers=[];
  for(let i=0;i<16;i++)customers.push(await prisma.customer.create({data:{orgId:org.id,name:`مشتری نمونه ${i+1}`,phone:`0912000${String(i).padStart(4,"0")}`,notes:"حساب نمایشی"}}));
  const start=new Date();start.setUTCDate(start.getUTCDate()+1);
  let created=0;
  for(let day=0;day<12;day++){
    const dt=new Date(start);dt.setUTCDate(dt.getUTCDate()+day);
    const date=dt.toISOString().slice(0,10);
    for(let si=0;si<staff.length;si++){
      for(const [ci,hh] of [9,11,15].entries()){
        const svc=services[(si+ci)%3];const begin=zonedDate(date,hh*60,"Asia/Tehran");const finish=new Date(begin.getTime()+svc.duration*60000);
        const c=customers[(day*5+si+ci)%customers.length];
        const a=await prisma.appointment.create({data:{orgId:org.id,branchId:staff[si].branchId,serviceId:svc.id,staffId:staff[si].id,customerId:c.id,startsAt:begin,endsAt:finish,blockStart:begin,blockEnd:finish,status:day%7===0?"pending":"confirmed",price:svc.price,source:"demo"}});created++;
        if(ci===0&&day%3===0)await prisma.payment.create({data:{orgId:org.id,appointmentId:a.id,amount:svc.price,method:"cash",status:"paid"}});
      }
    }
  }
  await prisma.coupon.create({data:{orgId:org.id,code:"ROSE10",kind:"percent",value:10,maxUses:50,minAmount:100000}});
  await prisma.package.create({data:{orgId:org.id,name:"بسته سه جلسه‌ای",serviceId:services[0].id,description:"نمونه اشتراک",sessions:3,price:290000}});
  await prisma.waitlist.create({data:{orgId:org.id,branchId:b1.id,serviceId:services[0].id,customerName:"مشتری در انتظار",phone:"09123456789",preferredDate:start.toISOString().slice(0,10)}});
  await prisma.notification.create({data:{orgId:org.id,kind:"demo",title:"به پنل نمایشی خوش آمدید",body:"این کسب‌وکار و آمار آن صرفاً برای آزمون هستند."}});
  console.log(`Seeded ${name}: ${created} demo appointments. Development login: ${email} / ${password}`);
}
run().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>prisma.$disconnect());
