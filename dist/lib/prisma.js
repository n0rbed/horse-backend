// src/lib/prisma.ts - SINGLE INSTANCE FOR YOUR ENTIRE APP
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
// 1. LOAD ENVIRONMENT VARIABLES FIRST
config({ path: "./config.env" });
const globalForPrisma = globalThis;
// Singleton pattern - ONE instance everywhere
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
// Graceful shutdown for production
process.on("beforeExit", async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=prisma.js.map