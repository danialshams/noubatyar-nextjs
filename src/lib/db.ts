import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;
export const db = globalDb.prisma ?? new PrismaClient({
  adapter: new PrismaPg({connectionString}),
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
