import { enCommon } from "./dictionaries/en/common";
import { enPortfolio } from "./dictionaries/en/portfolio";
import { enQuant } from "./dictionaries/en/quant";
import { enSmartInsights } from "./dictionaries/en/smart-insights";
import type { DictionaryShape } from "./dictionaries/types";
import { viCommon } from "./dictionaries/vi/common";
import { viPortfolio } from "./dictionaries/vi/portfolio";
import { viQuant } from "./dictionaries/vi/quant";
import { viSmartInsights } from "./dictionaries/vi/smart-insights";

export const LOCALES = [
  { code: "vi", label: "Tiếng Việt", shortLabel: "VI" },
  { code: "en", label: "English", shortLabel: "EN" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "vi";

const viDictionary = {
  ...viCommon,
  ...viSmartInsights,
  ...viPortfolio,
  ...viQuant,
} as const;

const enDictionary = {
  ...enCommon,
  ...enSmartInsights,
  ...enPortfolio,
  ...enQuant,
} as const satisfies DictionaryShape<typeof viDictionary>;

export const dictionaries = {
  vi: viDictionary,
  en: enDictionary,
} as const;

type DottedKeys<T> = {
  [K in Extract<keyof T, string>]: T[K] extends string ? K : `${K}.${DottedKeys<T[K]>}`;
}[Extract<keyof T, string>];

export type TranslationKey = DottedKeys<typeof viDictionary>;

export function normalizeLocale(value: unknown): Locale {
  return value === "en" || value === "vi" ? value : DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: Record<string, string | number> = {},
) {
  const text = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, dictionaries[locale]);
  if (typeof text !== "string") return key;
  return Object.entries(values).reduce(
    (output, [name, value]) => output.replaceAll(`{${name}}`, String(value)),
    text,
  );
}
