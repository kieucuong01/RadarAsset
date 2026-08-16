"use client";

import { FlaskConical, Plus, Trash2, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";
import type { CustomStrategySummary } from "@/lib/strategy-lab/client";

export function SavedStrategiesPanel({
  strategies,
  loading,
  onCreate,
  onArchive,
  onEdit,
  onUseBacktest,
}: {
  strategies: CustomStrategySummary[];
  loading: boolean;
  onCreate: () => void;
  onArchive: (id: string) => void;
  onEdit: (strategy: CustomStrategySummary) => void;
  onUseBacktest: (strategy: CustomStrategySummary) => void;
}) {
  const { t } = useI18n();
  const activeStrategies = strategies.filter((strategy) => strategy.status === "active");

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          {t("strategyLab.loading")}
        </CardContent>
      </Card>
    );
  }

  if (activeStrategies.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("strategyLab.noCustomTitle")}</CardTitle>
          <CardDescription>{t("strategyLab.noCustomDescription")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={onCreate}>
            <Plus data-icon="inline-start" /> {t("strategyLab.createStrategy")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {activeStrategies.map((strategy) => {
        const latest = strategy.versions[0];
        return (
          <Card key={strategy.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{strategy.name}</CardTitle>
                  <CardDescription className="mt-1">
                    {strategy.description ?? t("strategyLab.noDescription")} ·{" "}
                    {t("strategyLab.version")} {latest?.version ?? "—"}
                  </CardDescription>
                </div>
                <Badge>{t("strategyLab.executable")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("strategyLab.dbBacked")}
            </CardContent>
            <CardFooter className="flex flex-wrap justify-between gap-3">
              <Button variant="outline" onClick={() => onArchive(strategy.id)}>
                <Trash2 data-icon="inline-start" /> {t("strategyLab.delete")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onEdit(strategy)}>
                  <Wrench data-icon="inline-start" /> {t("strategyLab.edit")}
                </Button>
                <Button disabled={!latest?.executionCode} onClick={() => onUseBacktest(strategy)}>
                  <FlaskConical data-icon="inline-start" /> {t("strategyLab.useBacktest")}
                </Button>
              </div>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
