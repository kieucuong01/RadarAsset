import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".worktrees/**",
      "**/.worktrees/**",
      "**/*.integration.test.ts",
      "e2e/**",
      "scripts/dev-local.test.mjs",
    ],
  },
});
