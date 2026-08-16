import type {
  MarketDataFreshness,
  MarketDataMarket,
  MarketDataTimeframe,
  MarketIngestionStatus,
} from "@/lib/backend/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function isWeekday(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

function expectedContinuousBarOpen(_timeframe: MarketDataTimeframe, now: Date) {
  return new Date(utcMidnight(now).getTime() - DAY_MS);
}

function expectedWeekdayBarOpen(timeframe: MarketDataTimeframe, now: Date) {
  let candidate = expectedContinuousBarOpen(timeframe, now);
  while (!isWeekday(candidate)) {
    candidate = new Date(candidate.getTime() - DAY_MS);
  }
  return candidate;
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
  if (market === "vn_equity") return expectedFptDailyBarOpen(now);
  return expectedWeekdayBarOpen(timeframe, now);
}

export function calculateFreshness(input: FreshnessInput): MarketDataFreshness {
  if (input.source === "research_fixture") return "fixture";
  if (!input.coverageEnd || input.lastStatus === "unavailable") return "unavailable";

  const expected = expectedClosedBarOpen(input.market, input.timeframe, input.now);
  const lagMs = Math.max(0, expected.getTime() - input.coverageEnd.getTime());
  return lagMs <= 36 * HOUR_MS ? "fresh" : "stale";
}
