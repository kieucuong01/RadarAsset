import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { parse } from "dotenv";

import { validateIntegrationDatabases } from "./database-safety.mjs";

const fallbackEnvPath = [resolve(".env.local"), resolve("..", "..", ".env.local")].find(existsSync);
const fileEnv = fallbackEnvPath ? parse(readFileSync(fallbackEnvPath)) : {};
const developmentDatabaseUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
function defaultTestUrl(value) {
  if (!value) return undefined;
  const parsed = new URL(value);
  parsed.pathname = `${parsed.pathname.replace(/_test$/, "")}_test`;
  return parsed.toString();
}
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  fileEnv.TEST_DATABASE_URL ??
  defaultTestUrl(developmentDatabaseUrl);
validateIntegrationDatabases(developmentDatabaseUrl, testDatabaseUrl);

const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

const migration = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  stdio: "inherit",
});
if (migration.status !== 0) process.exit(migration.status ?? 1);

const tests = spawnSync(
  process.execPath,
  [vitestCli, "run", "--config", "vitest.integration.config.ts"],
  {
    env: {
      ...process.env,
      DATABASE_URL: developmentDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
    },
    stdio: "inherit",
  },
);
process.exit(tests.status ?? 1);
