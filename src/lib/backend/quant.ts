import type { QuantRunStatus } from "./types";

const allowedTransitions: Record<QuantRunStatus, QuantRunStatus[]> = {
  queued: ["running", "failed", "cancelled", "timed_out"],
  running: ["succeeded", "failed", "cancel_requested", "timed_out"],
  cancel_requested: ["cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function canTransitionQuantRun(from: QuantRunStatus, to: QuantRunStatus) {
  return allowedTransitions[from].includes(to);
}
