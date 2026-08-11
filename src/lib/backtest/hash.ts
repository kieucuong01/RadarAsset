import { createHash } from "node:crypto";

import { normalizeBacktestSubmission } from "./contracts";

export function hashBacktestSubmission(input: unknown) {
  const normalized = normalizeBacktestSubmission(input);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}
