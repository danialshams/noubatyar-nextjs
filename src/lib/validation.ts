import {db} from "./db";
import {AppError} from "./auth";
export async function validateForeign(entity:string,data:Record<string,unknown>,orgId:string){
  if(data.branchId && !(await db.branch.findFirst({where:{id:String(data.branchId),orgId}})))throw new AppError(422,"شعبه متعلق به این کسب‌وکار نیست");
  if(data.serviceId && !(await db.service.findFirst({where:{id:String(data.serviceId),orgId}})))throw new AppError(422,"خدمت معتبر نیست");
  if(data.staffId && !(await db.staff.findFirst({where:{id:String(data.staffId),orgId}})))throw new AppError(422,"متخصص متعلق به این کسب‌وکار نیست");
  if(entity==="timeOff"&&data.startsAt&&data.endsAt&&String(data.startsAt)>=String(data.endsAt))throw new AppError(422,"زمان پایان باید بعد از شروع باشد");
  if(data.resourceId && !(await db.resource.findFirst({where:{id:String(data.resourceId),orgId}})))throw new AppError(422,"منبع معتبر نیست");
  if(entity==="staff" && Array.isArray(data.serviceIds)){
    const ids=(data.serviceIds as string[]);
    const count=await db.service.count({where:{orgId,id:{in:ids}}});
    if(count!==new Set(ids).size)throw new AppError(422,"خدمات متخصص معتبر نیست");
  }
}
