import type {
  MarketDataFreshness,
  MarketDataMarket,
  MarketDataTimeframe,
  MarketIngestionStatus,
} from "@/lib/backend/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FPT_HOURLY_OPENS_UTC = [2, 3, 4, 6, 7] as const;

type FreshnessInput = {
  market: MarketDataMarket;
  timeframe: MarketDataTimeframe;
  coverageEnd: Date | null;
  source: string | null;
  lastStatus: MarketIngestionStatus | null;
  now: Date;
};

function utcMidnight(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function floorUtcHour(value: Date) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
    ),
  );
}

function isWeekday(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

function expectedContinuousBarOpen(timeframe: MarketDataTimeframe, now: Date) {
  return timeframe === "1h"
    ? new Date(floorUtcHour(now).getTime() - HOUR_MS)
    : new Date(utcMidnight(now).getTime() - DAY_MS);
}

function expectedWeekdayBarOpen(timeframe: MarketDataTimeframe, now: Date) {
  let candidate = expectedContinuousBarOpen(timeframe, now);
  const step = timeframe === "1h" ? HOUR_MS : DAY_MS;
  while (!isWeekday(candidate)) {
    candidate = new Date(candidate.getTime() - step);
  }
  return candidate;
}

function expectedFptHourlyBarOpen(now: Date) {
  const today = utcMidnight(now);
  for (let dayOffset = 0; dayOffset < 10; dayOffset += 1) {
    const day = new Date(today.getTime() - dayOffset * DAY_MS);
    if (!isWeekday(day)) continue;
    for (const hour of [...FPT_HOURLY_OPENS_UTC].reverse()) {
      const candidate = new Date(day.getTime() + hour * HOUR_MS);
      if (candidate.getTime() + HOUR_MS <= now.getTime()) return candidate;
    }
  }
  throw new Error("Unable to resolve the latest FPT hourly boundary.");
}

function expectedFptDailyBarOpen(now: Date) {
  const today = utcMidnight(now);
  for (let dayOffset = 0; dayOffset < 10; dayOffset += 1) {
    const sessionDay = new Date(today.getTime() - dayOffset * DAY_MS);
    if (!isWeekday(sessionDay)) continue;
    const sessionClose = new Date(sessionDay.getTime() + 8 * HOUR_MS);
    if (sessionClose <= now) {
      return new Date(sessionDay.getTime() - 7 * HOUR_MS);
    }
  }
  throw new Error("Unable to resolve the latest FPT daily boundary.");
}

export function expectedClosedBarOpen(
  market: MarketDataMarket,
  timeframe: MarketDataTimeframe,
  now: Date,
) {
  if (market === "crypto_spot") return expectedContinuousBarOpen(timeframe, now);
  if (market === "vn_equity") {
    return timeframe === "1h" ? expectedFptHourlyBarOpen(now) : expectedFptDailyBarOpen(now);
  }
  return expectedWeekdayBarOpen(timeframe, now);
}

export function calculateFreshness(input: FreshnessInput): MarketDataFreshness {
  if (input.source === "research_fixture") return "fixture";
  if (!input.coverageEnd || input.lastStatus === "unavailable") return "unavailable";

  const expected = expectedClosedBarOpen(input.market, input.timeframe, input.now);
  const thresholdMs = input.timeframe === "1h" ? 90 * 60_000 : 36 * HOUR_MS;
  const lagMs = Math.max(0, expected.getTime() - input.coverageEnd.getTime());
  return lagMs <= thresholdMs ? "fresh" : "stale";
}
