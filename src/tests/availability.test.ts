import { describe,expect,it } from "vitest";
import {computeAvailableSlots,planAt,type Schedule} from "../lib/booking";
import {zonedDate} from "../lib/time";
const day="2026-11-10"; // Tuesday, Tehran timezone, weekday 1
const now=new Date("2026-11-07T06:00:00Z");
function fixture():Schedule{
 const org={id:"org",slug:"org",name:"test",timezone:"Asia/Tehran",noticeMinutes:60,bookAheadDays:30,bookingEnabled:true,depositPercent:0};
 const staff={id:"s1",name:"Sara",branchId:"b1",priority:10,bufferBefore:0,bufferAfter:0};
 const service={id:"svc1",duration:60,bufferBefore:0,bufferAfter:0,price:300000,deposit:0,capacity:1,resourceId:null};
 return {org,branch:{id:"b1"},services:[service],staff:[staff],branchHours:[{weekday:1,opens:"09:00",closes:"13:00",closed:false}],staffHours:[{staffId:"s1",weekday:1,starts:"10:00",ends:"13:00",breakStart:null,breakEnd:null}],holiday:false,existing:[],timeoffs:[]} as unknown as Schedule;
}
describe("Tehran scheduling core",()=>{
 it("converts a Tehran wall clock to UTC",()=>expect(zonedDate(day,10*60,"Asia/Tehran").toISOString()).toBe("2026-11-10T06:30:00.000Z"));
 it("only allows times inside branch and staff hours",()=>expect(computeAvailableSlots(fixture(),day,undefined,now).map(x=>x.time)).toEqual(["10:00","10:15","10:30","10:45","11:00","11:15","11:30","11:45","12:00"]));
 it("blocks staff overlap",()=>{const f=fixture();const x=zonedDate(day,11*60,"Asia/Tehran");const y=zonedDate(day,12*60,"Asia/Tehran");(f.existing as any).push({staffId:"s1",resourceId:null,blockStart:x,blockEnd:y,groupKey:null});expect(computeAvailableSlots(f,day,undefined,now).map(x=>x.time)).not.toContain("11:00");});
 it("blocks holidays",()=>{const f=fixture();f.holiday=true;expect(computeAvailableSlots(f,day,undefined,now)).toEqual([]);});
 it("blocks leave",()=>{const f=fixture();(f.timeoffs as any).push({staffId:"s1",startsAt:zonedDate(day,10*60,"Asia/Tehran"),endsAt:zonedDate(day,11*60,"Asia/Tehran")});expect(computeAvailableSlots(f,day,undefined,now).map(x=>x.time)).not.toContain("10:00");});
 it("chains multiple services",()=>{const f=fixture();(f.services as any).push({id:"svc2",duration:30,bufferBefore:0,bufferAfter:0,price:100000,deposit:0,capacity:1,resourceId:null});const x=planAt(f,"s1",day,10*60,now);expect(x?.length).toBe(2);expect(x?.[0].endsAt.getTime()).toBe(x?.[1].startsAt.getTime());});
 it("supports capacity-limited group sessions",()=>{const f=fixture();(f.services[0] as any).capacity=2;const startsAt=zonedDate(day,10*60,"Asia/Tehran"),endsAt=zonedDate(day,11*60,"Asia/Tehran"),groupKey=`svc1:s1:${startsAt.toISOString()}`;const a={staffId:"s1",resourceId:null,serviceId:"svc1",startsAt,blockStart:startsAt,blockEnd:endsAt,groupKey};(f.existing as any).push(a);expect(planAt(f,"s1",day,10*60,now)).not.toBeNull();(f.existing as any).push(a);expect(planAt(f,"s1",day,10*60,now)).toBeNull();});
});
