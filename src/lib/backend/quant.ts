import type { QuantRunStatus } from "./types";

const allowedTransitions: Record<QuantRunStatus, QuantRunStatus[]> = {
  queued: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function canTransitionQuantRun(from: QuantRunStatus, to: QuantRunStatus) {
  return allowedTransitions[from].includes(to);
}
