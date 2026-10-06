import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 30_000,
    globalSetup: "./tests/global-setup.ts",
    env: { DATABASE_URL: "file:./test.db?connection_limit=1" },
  },
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
