import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGETS = Object.freeze({
  p95Ms: 200,
  bytes: 250_000,
  gzipBytes: 75_000,
});

export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("percentile requires at least one sample");
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("percentile samples must be finite");
  }
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new RangeError("quantile must be between zero and one");
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

export function assertBudgets(result) {
  const failures = [];
  if (result.p95Ms > BUDGETS.p95Ms) {
    failures.push(`p95 ${result.p95Ms}ms > ${BUDGETS.p95Ms}ms`);
  }
  if (result.bytes > BUDGETS.bytes) {
    failures.push(`payload ${result.bytes} > ${BUDGETS.bytes}`);
  }
  if (result.gzipBytes > BUDGETS.gzipBytes) {
    failures.push(`gzip ${result.gzipBytes} > ${BUDGETS.gzipBytes}`);
  }
  if (Number.isFinite(result.assetCount) && result.assetCount > 25) {
    failures.push(`asset count ${result.assetCount} > 25`);
  }
  if (Number.isFinite(result.maxDecisionInputs) && result.maxDecisionInputs > 12) {
    failures.push(`decision inputs ${result.maxDecisionInputs} > 12`);
  }
  if (Number.isFinite(result.maxEvidence) && result.maxEvidence > 12) {
    failures.push(`evidence ${result.maxEvidence} > 12`);
  }
  if (Number.isFinite(result.maxSupporting) && result.maxSupporting > 5) {
    failures.push(`supporting ${result.maxSupporting} > 5`);
  }
  if (Number.isFinite(result.maxContradicting) && result.maxContradicting > 3) {
    failures.push(`contradicting ${result.maxContradicting} > 3`);
  }
  if (failures.length > 0) throw new Error(failures.join(", "));
}

export async function benchmark({ url, cookie, iterations = 20, fetchImpl = fetch }) {
  if (!url) throw new TypeError("benchmark URL is required");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new RangeError("iterations must be an integer from 1 to 100");
  }

  const headers = cookie
    ? { Accept: "application/json", Cookie: cookie }
    : { Accept: "application/json" };
  const request = async () => {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`benchmark HTTP ${response.status}`);
    return response.text();
  };

  await request();
  const samples = [];
  let body = "";
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    body = await request();
    samples.push(performance.now() - started);
  }

  const parsed = JSON.parse(body);
  const opinions = Array.isArray(parsed?.assetOpinions) ? parsed.assetOpinions : [];
  const assetCount = opinions.length;
  const maximumLength = (key) =>
    Math.max(
      0,
      ...opinions.map((opinion) => (Array.isArray(opinion?.[key]) ? opinion[key].length : 0)),
    );

  return {
    iterations,
    requestCount: iterations + 1,
    assetCount,
    maxDecisionInputs: maximumLength("decisionInputs"),
    maxEvidence: maximumLength("evidence"),
    maxSupporting: maximumLength("supportingEvidenceIds"),
    maxContradicting: maximumLength("contradictingEvidenceIds"),
    p50Ms: Math.round(percentile(samples, 0.5)),
    p95Ms: Math.round(percentile(samples, 0.95)),
    bytes: Buffer.byteLength(body),
    gzipBytes: gzipSync(body).byteLength,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.SMART_INSIGHTS_BENCH_URL;
  if (!url) throw new Error("SMART_INSIGHTS_BENCH_URL is required");
  const result = await benchmark({
    url,
    cookie: process.env.SMART_INSIGHTS_BENCH_COOKIE,
    iterations: 20,
  });
  console.log(JSON.stringify(result));
  assertBudgets(result);
}
