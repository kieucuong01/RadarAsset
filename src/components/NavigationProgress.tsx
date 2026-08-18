"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n/context";

import { TopLoadingBar } from "./TopLoadingBar";

const NAVIGATION_TIMEOUT_MS = 10_000;

export function isInternalNavigation(href: string | null, currentUrl: string): boolean {
  if (!href || href.startsWith("#")) return false;

  try {
    const nextUrl = new URL(href, currentUrl);
    const current = new URL(currentUrl);
    return (
      nextUrl.origin === current.origin &&
      (nextUrl.pathname !== current.pathname || nextUrl.search !== current.search)
    );
  } catch {
    return false;
  }
}

export function NavigationProgress() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    setActive(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = target?.getAttribute("href") ?? null;
      if (!isInternalNavigation(href, window.location.href)) return;

      setActive(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setActive(false);
        timeoutRef.current = null;
      }, NAVIGATION_TIMEOUT_MS);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return <TopLoadingBar active={active} label={t("common.loading")} />;
}
