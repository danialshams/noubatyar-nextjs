import { z } from "zod";
// CRUD allowlists: never accept orgId, role, identity, status or payment state from generic requests.
const text=z.string().trim().min(1).max(180);
const optionalText=z.string().trim().max(2000).optional();
const positive=z.coerce.number().int().min(1).max(1000000000);
const nonneg=z.coerce.number().int().min(0).max(1000000000);
const uuid=z.string().uuid();
const flag=z.boolean();
const optUuid=uuid.nullable().optional();
export const entityDefinitions={
  branches:{model:"branch",schema:z.object({name:text,address:optionalText,phone:optionalText,active:flag.optional()}),title:"شعب",search:"name"},
  services:{model:"service",schema:z.object({name:text,description:optionalText,category:optionalText,duration:positive,price:nonneg,deposit:nonneg.optional(),bufferBefore:nonneg.optional(),bufferAfter:nonneg.optional(),capacity:positive.optional(),resourceId:optUuid,active:flag.optional(),public:flag.optional()}),title:"خدمات",search:"name"},
  staff:{model:"staff",schema:z.object({name:text,slug:z.string().regex(/^[a-z0-9-]{3,60}$/).optional(),branchId:uuid,title:optionalText,phone:optionalText,priority:nonneg.optional(),bufferBefore:nonneg.optional(),bufferAfter:nonneg.optional(),active:flag.optional(),serviceIds:z.array(uuid).optional()}),title:"کارکنان",search:"name"},
  customers:{model:"customer",schema:z.object({name:text,phone:z.string().regex(/^(?:\+?98|0)?9\d{9}$/),email:z.string().email().or(z.literal("")).optional(),notes:optionalText,credit:nonneg.optional()}),title:"مشتریان",search:"name"},
  resources:{model:"resource",schema:z.object({name:text,branchId:uuid,kind:z.enum(["room","equipment"]).optional(),active:flag.optional()}),title:"اتاق‌ها و تجهیزات",search:"name"},
  waitlist:{model:"waitlist",schema:z.object({branchId:uuid,serviceId:uuid,customerName:text,phone:text,preferredDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),status:z.enum(["waiting","offered","booked","cancelled"]).optional()}),title:"لیست انتظار",search:"customerName"},
  coupons:{model:"coupon",schema:z.object({code:z.string().trim().min(2).max(30),kind:z.enum(["percent","fixed"]),value:positive,minAmount:nonneg.optional(),maxUses:positive.nullable().optional(),active:flag.optional(),expiresAt:z.string().datetime().nullable().optional()}),title:"کدهای تخفیف",search:"code"},
  timeOff:{model:"timeOff",schema:z.object({staffId:uuid,startsAt:z.string().datetime(),endsAt:z.string().datetime(),note:optionalText}),title:"مرخصی‌ها",search:"note"},
  holidays:{model:"holiday",schema:z.object({branchId:uuid,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:optionalText}),title:"تعطیلات",search:"reason"},
  packages:{model:"package",schema:z.object({name:text,description:optionalText,serviceId:uuid,sessions:positive,price:nonneg,expiresDays:positive.optional(),active:flag.optional()}),title:"بسته‌ها",search:"name"}
} as const;
export type EntityName=keyof typeof entityDefinitions;
export const readOnlyEntities={appointments:"appointment",payments:"payment",notifications:"notification",audit:"audit",feedback:"feedback",team:"membership",customerPackages:"customerPackage",creditTransactions:"creditTransaction",packageUsages:"packageUsage",recurring:"recurring",outbox:"outbox"} as const;
export const isMutableEntity=(s:string):s is EntityName=>s in entityDefinitions;
export const isEntity=(s:string)=>isMutableEntity(s)||s in readOnlyEntities;
