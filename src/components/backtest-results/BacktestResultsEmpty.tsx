"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";

export function BacktestResultsEmpty() {
  const { t } = useI18n();
  const sections = [
    t("backtestResults.activePortfolio"),
    t("backtestResults.equityTitle"),
    t("backtestResults.tradeList.title"),
  ];

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label={t("backtestResults.aria")}>
      {sections.map((title) => (
        <Card key={title} className="min-w-0 max-w-full">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{t("backtestResults.emptyMessage")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("backtestResults.emptyContinue")}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
