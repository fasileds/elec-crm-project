import { prisma } from "@/lib/db";

export async function resetDatabase() {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT LIKE '_prisma_%'");
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(", ")} CASCADE`);
}
