"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_LOCALE, normalizeLocale, translate, type Locale } from "./dictionary";
import { I18nContext, type I18nContextValue } from "./context";

const STORAGE_KEY = "radarasset.locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(normalizeLocale(window.localStorage.getItem(STORAGE_KEY)));
  }, []);

  function setLocale(nextLocale: Locale) {
    const normalized = normalizeLocale(nextLocale);
    setLocaleState(normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
    document.documentElement.lang = normalized;
  }

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
