import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const fileEnv = loadEnv("test", process.cwd(), "");
const testUrl = process.env.TEST_DATABASE_URL || fileEnv.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Set TEST_DATABASE_URL in .env (a Postgres URL with ?schema=vitest) before running the tests.");
if (testUrl === (process.env.DATABASE_URL || fileEnv.DATABASE_URL) || testUrl === (process.env.DIRECT_URL || fileEnv.DIRECT_URL)) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL/DIRECT_URL: the tests wipe every table in it.");
}
process.env.TEST_DATABASE_URL = testUrl;

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
    globalSetup: "./tests/global-setup.ts",
    // Empty Supabase settings keep test uploads on local disk instead of the real bucket.
    env: { DATABASE_URL: testUrl, DIRECT_URL: testUrl, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  },
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
