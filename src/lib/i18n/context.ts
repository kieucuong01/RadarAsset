"use client";

import { createContext, useContext } from "react";

import type { Locale, TranslationKey } from "./dictionary";

export type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider.");
  return value;
}
