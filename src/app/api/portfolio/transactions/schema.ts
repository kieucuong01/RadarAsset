import { z } from "zod";

function isValidCalendarDate(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, { message: "Execution date must be a valid calendar date." });

export const reportingCurrencySchema = z.enum(["VND", "USD"]);
export const transactionIdSchema = z.string().uuid();

export const transactionSchema = z
  .object({
    symbol: z.string().min(1),
    type: z.enum(["buy", "sell"]),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().positive(),
    fee: z.coerce.number().min(0).default(0),
    currency: reportingCurrencySchema.default("USD"),
    reportingCurrency: reportingCurrencySchema.default("USD"),
    executedAt: z
      .string()
      .datetime()
      .refine((value) => new Date(value).getTime() <= Date.now(), {
        message: "Execution time cannot be in the future.",
      })
      .optional(),
    executionDate: calendarDateSchema.optional(),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
    timeframe: z.enum(["1W", "1M", "YTD", "1Y"]).default("1M"),
    note: z.string().trim().max(500).optional().nullable(),
    sourceSignalId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (value.executedAt && value.executionDate) {
      context.addIssue({
        code: "custom",
        message: "Provide executedAt or executionDate, not both.",
        path: ["executionDate"],
      });
    }
    if (value.executionDate && value.timezoneOffsetMinutes === undefined) {
      context.addIssue({
        code: "custom",
        message: "timezoneOffsetMinutes is required with executionDate.",
        path: ["timezoneOffsetMinutes"],
      });
    }
    if (value.executionDate && value.timezoneOffsetMinutes !== undefined) {
      const localToday = new Date(Date.now() - value.timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 10);
      if (value.executionDate > localToday) {
        context.addIssue({
          code: "custom",
          message: "Execution date cannot be after your local today.",
          path: ["executionDate"],
        });
      }
    }
  })
  .transform(({ executionDate, timezoneOffsetMinutes: _offset, ...value }) => ({
    ...value,
    executedAt: executionDate ? `${executionDate}T12:00:00.000Z` : value.executedAt,
  }));

export function parseReportingCurrency(value: string | null) {
  return reportingCurrencySchema.parse(value ?? "USD");
}
