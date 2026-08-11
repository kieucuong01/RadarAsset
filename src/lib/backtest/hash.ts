import { createHash } from "node:crypto";

import { normalizeBacktestSubmission, type BacktestSubmission } from "./contracts";

export function hashBacktestSubmission(input: BacktestSubmission) {
  const normalized = normalizeBacktestSubmission(input);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}
