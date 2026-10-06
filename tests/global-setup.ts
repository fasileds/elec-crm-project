import { execSync } from "node:child_process";

export default function setup() {
  process.env.DATABASE_URL = "file:./test.db?connection_limit=1";
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: "file:./test.db?connection_limit=1" } });
}
