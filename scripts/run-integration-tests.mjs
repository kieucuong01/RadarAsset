import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateIntegrationDatabases } from "./database-safety.mjs";

const developmentDatabaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
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
