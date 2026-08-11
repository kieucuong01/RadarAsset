import { getPrisma } from "@/lib/db/prisma";

export const APPROVED_PROVIDER_CODES = [
  "binance-public",
  "msn-via-vnstock",
  "vnstock-vci-free",
] as const;

type ApprovedProviderCode = (typeof APPROVED_PROVIDER_CODES)[number];
type ProviderMarket = "vn_equity" | "crypto_spot" | "metal_spot";

export type ProviderInstrumentResult = {
  id: string;
  providerCode: ApprovedProviderCode;
  providerSymbol: string;
  assetId: string;
  symbol: string;
  name: string;
  market: ProviderMarket;
  venue: string | null;
  currency: string;
  supportedTimeframes: Array<"1d" | "1h">;
};

const include = { provider: true, asset: true } as const;

function approvedCode(value: string): value is ApprovedProviderCode {
  return APPROVED_PROVIDER_CODES.includes(value as ApprovedProviderCode);
}

function market(value: string): ProviderMarket {
  if (value === "vn_equity" || value === "crypto_spot" || value === "metal_spot") return value;
  throw new Error("Provider instrument uses an unsupported market.");
}

function mapRow(row: {
  id: string;
  providerSymbol: string;
  provider: { code: string; status: string };
  asset: {
    id: string;
    symbol: string;
    name: string;
    market: string;
    venue: string | null;
    currency: string;
  };
}): ProviderInstrumentResult {
  if (!approvedCode(row.provider.code) || row.provider.status !== "active") {
    throw new Error("Provider instrument is not approved and active.");
  }
  const mappedMarket = market(row.asset.market);
  return {
    id: row.id,
    providerCode: row.provider.code,
    providerSymbol: row.providerSymbol,
    assetId: row.asset.id,
    symbol: row.asset.symbol,
    name: row.asset.name,
    market: mappedMarket,
    venue: row.asset.venue,
    currency: row.asset.currency,
    supportedTimeframes:
      mappedMarket === "metal_spot" && row.provider.code === "msn-via-vnstock"
        ? ["1d"]
        : ["1d", "1h"],
  };
}

export async function searchProviderInstruments(input: { q: string; limit?: number }) {
  const q = input.q.trim().toUpperCase().slice(0, 40);
  const take = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = await getPrisma().providerInstrument.findMany({
    where: {
      provider: { status: "active", code: { in: [...APPROVED_PROVIDER_CODES] } },
      ...(q
        ? {
            OR: [
              { providerSymbol: { contains: q, mode: "insensitive" as const } },
              { asset: { symbol: { contains: q, mode: "insensitive" as const } } },
              { asset: { name: { startsWith: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include,
    orderBy: [{ asset: { symbol: "asc" } }, { providerSymbol: "asc" }],
    take,
  });
  return { items: rows.map(mapRow) };
}

export async function resolveProviderInstrument(providerCode: string, providerSymbol: string) {
  const normalizedCode = providerCode.trim().toLowerCase();
  if (!approvedCode(normalizedCode)) throw new Error("Provider is not approved.");
  const normalizedSymbol = providerSymbol.trim().toUpperCase();
  const row = await getPrisma().providerInstrument.findFirst({
    where: {
      providerSymbol: normalizedSymbol,
      provider: { code: normalizedCode, status: "active" },
    },
    include,
  });
  if (!row) throw new Error("Provider instrument is unavailable.");
  return mapRow(row);
}
