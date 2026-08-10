import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for integration tests.");
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must not match DATABASE_URL; integration tests require an isolated database.",
  );
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.BETTER_AUTH_SECRET ??= "integration-test-only-better-auth-secret-64-characters-minimum";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
