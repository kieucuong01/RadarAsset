import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  prettier,
  {
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".npm-cache/**",
    ".venv/**",
    ".worktrees/**",
    ".local-data/**",
    ".pytest-*/**",
    "graphify-out/**",
    "node_modules/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
