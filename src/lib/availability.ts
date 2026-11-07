import {daysFrom,hminutes,timeString,todayAt,weekday,zonedDate,validDate} from './time.ts';
export interface Schedule {
  branch?: {id:string};
  org:{timezone:string;noticeMinutes:number;bookAheadDays:number;bookingEnabled:boolean;depositPercent:number};
  services:Array<{id:string;duration:number;bufferBefore:number;bufferAfter:number;price:number;deposit:number;capacity:number;resourceId:string|null}>;
  staff:Array<{id:string;name:string;priority:number;bufferBefore:number;bufferAfter:number}>;
  branchHours:Array<{weekday:number;opens:string;closes:string;closed:boolean}>;
  staffHours:Array<{staffId:string;weekday:number;starts:string;ends:string;breakStart:string|null;breakEnd:string|null}>;
  holiday:boolean;
  existing:Array<{id?:string;staffId:string;resourceId:string|null;blockStart:Date;blockEnd:Date;groupKey:string|null}>;
  timeoffs:Array<{staffId:string;startsAt:Date;endsAt:Date}>;
}
export interface PlanItem {serviceId:string;staffId:string;resourceId:string|null;startsAt:Date;endsAt:Date;blockStart:Date;blockEnd:Date;groupKey:string|null;price:number;deposit:number;}
export interface Slot {time:string;staffId:string;staffName:string;startsAt:string;endsAt:string;}
const overlap=(a:Date,b:Date,x:Date,y:Date)=>a<y&&x<b;
export function planAt(schedule:Schedule,staffId:string,date:string,minute:number,now=new Date()):PlanItem[]|null {
 const {org,services,staff,branchHours,staffHours,holiday,existing,timeoffs}=schedule;
 if(!validDate(date)||holiday||!org.bookingEnabled||!Number.isInteger(minute)||minute<0||minute>=1440)return null;
 const inDays=(new Date(`${date}T12:00:00Z`).getTime()-new Date(`${todayAt(org.timezone,now)}T12:00:00Z`).getTime())/86400000;
 if(inDays<0||inDays>org.bookAheadDays)return null;
 const st=staff.find(s=>s.id===staffId);if(!st)return null;
 const day=weekday(date), bh=branchHours.find(h=>h.weekday===day),sh=staffHours.find(h=>h.staffId===staffId&&h.weekday===day);
 if(!bh||bh.closed||!sh)return null;
 let cursor=minute;const result:PlanItem[]=[];
 for(const svc of services){
   if(svc.duration<=0||svc.capacity<1)return null;
   const before=svc.bufferBefore+st.bufferBefore;
   const start=result.length?cursor+before:minute;
   const end=start+svc.duration,bs=start-before,be=end+svc.bufferAfter+st.bufferAfter;
   if(start<hminutes(bh.opens)||end>hminutes(bh.closes)||start<hminutes(sh.starts)||end>hminutes(sh.ends))return null;
   if(sh.breakStart&&sh.breakEnd&&start<hminutes(sh.breakEnd)&&hminutes(sh.breakStart)<end)return null;
   const begin=zonedDate(date,start,org.timezone),finish=zonedDate(date,end,org.timezone),blockedFrom=zonedDate(date,bs,org.timezone),blockedTo=zonedDate(date,be,org.timezone);
   if(begin.getTime()<now.getTime()+org.noticeMinutes*60000)return null;
   if(timeoffs.some(o=>o.staffId===staffId&&overlap(blockedFrom,blockedTo,o.startsAt,o.endsAt)))return null;
   const intersect=existing.filter(a=>(a.staffId===staffId||(!!svc.resourceId&&a.resourceId===svc.resourceId))&&overlap(blockedFrom,blockedTo,a.blockStart,a.blockEnd));
   const groupKey=svc.capacity>1?`${svc.id}:${staffId}:${begin.toISOString()}`:null;
   const group=intersect.filter(a=>groupKey&&a.groupKey===groupKey&&a.staffId===staffId);
   if(intersect.some(a=>!groupKey||a.groupKey!==groupKey)||group.length>=svc.capacity)return null;
   result.push({serviceId:svc.id,staffId,resourceId:svc.resourceId,startsAt:begin,endsAt:finish,blockStart:blockedFrom,blockEnd:blockedTo,groupKey,price:svc.price,deposit:Math.min(svc.price,Math.max(svc.deposit,svc.price*org.depositPercent/100))});
   cursor=be;
 }
 for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++){
   if(overlap(result[i].blockStart,result[i].blockEnd,result[j].blockStart,result[j].blockEnd))return null;
 }
 return result;
}
export function computeAvailableSlots(schedule:Schedule,date:string,staffId?:string,now=new Date()):Slot[] {
 if(!validDate(date))return [];
 const slots:Slot[]=[];
 for(let minute=0;minute<1440;minute+=15)for(const staff of schedule.staff){
   if(staffId&&staffId!==staff.id)continue;
   const plan=planAt(schedule,staff.id,date,minute,now);
   if(plan){slots.push({time:timeString(minute),staffId:staff.id,staffName:staff.name,startsAt:plan[0].startsAt.toISOString(),endsAt:plan[plan.length-1].endsAt.toISOString()});if(!staffId)break;}
 }
 return slots;
}
