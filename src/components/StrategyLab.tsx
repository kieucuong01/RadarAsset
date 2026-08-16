"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Save, Wrench } from "lucide-react";
import { toast } from "sonner";

import { SavedStrategiesPanel } from "@/components/strategy-lab/SavedStrategiesPanel";
import { StrategyBuilderPanel } from "@/components/strategy-lab/StrategyBuilderPanel";
import {
  StrategyLibraryPanel,
  type StrategyLibraryFamily,
} from "@/components/strategy-lab/StrategyLibraryPanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BacktestStrategyPreset } from "@/lib/backtest/preselection";
import { STRATEGY_CATALOG } from "@/lib/backtest/strategy-catalog";
import { useI18n } from "@/lib/i18n/context";
import {
  normalizeCustomStrategy,
  type CustomStrategyInput,
} from "@/lib/strategy-lab/custom-strategy";
import {
  archiveCustomStrategy,
  createCustomStrategy,
  createCustomStrategyVersion,
  listCustomStrategies,
  type CustomStrategySummary,
} from "@/lib/strategy-lab/client";
import { migrateLegacyStrategies } from "@/lib/strategy-lab/legacy-migration";
import {
  applySavedRuleToStrategyBuilder,
  createInitialStrategyBuilderState,
  type StrategyBuilderState,
} from "@/lib/strategy-lab/builder-state";

export type StrategyLabSelection = {
  preset: BacktestStrategyPreset;
  symbols: string[];
};

export function StrategyLab({
  onUsePreset,
}: {
  onUsePreset: (selection: StrategyLabSelection) => void;
}) {
  const { t, locale } = useI18n();
  const [section, setSection] = useState("library");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFamily, setLibraryFamily] = useState<StrategyLibraryFamily>("all");
  const [builder, setBuilder] = useState<StrategyBuilderState>(() =>
    createInitialStrategyBuilderState(t("strategyLab.defaultName"), locale),
  );
  const [saved, setSaved] = useState<CustomStrategySummary[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void migrateLegacyStrategies(window.localStorage, (input) => createCustomStrategy(input))
      .then((result) => {
        if (result.skipped > 0) {
          toast.warning(t("strategyLab.migrationSkipped", { count: result.skipped }));
        }
        return listCustomStrategies();
      })
      .then((strategies) => active && setSaved(strategies))
      .catch(() => toast.error(t("strategyLab.loadError")))
      .finally(() => active && setLoadingSaved(false));
    return () => {
      active = false;
    };
  }, [t]);

  function selectCatalogStrategy(code: string) {
    const strategy = STRATEGY_CATALOG.find((item) => item.code === code);
    if (!strategy) return;
    setBuilder((current) => ({
      ...current,
      strategyCode: code,
      strategyParameters: { ...strategy.defaultParameters },
    }));
  }

  function buildDraft(): CustomStrategyInput {
    const base = {
      schemaVersion: 1 as const,
      id: globalThis.crypto.randomUUID(),
      name: builder.name,
      symbol: builder.symbol,
    };
    if (builder.kind === "catalog_preset") {
      const definition = STRATEGY_CATALOG.find((item) => item.code === builder.strategyCode)!;
      return {
        ...base,
        kind: "catalog_preset",
        strategyCode: definition.code,
        strategyVersion: definition.version,
        strategyParameters: builder.strategyParameters,
      };
    }
    if (builder.kind === "scheduled_dca") {
      return {
        ...base,
        kind: "scheduled_dca",
        amount: builder.amount,
        currency: builder.currency,
        frequency: "monthly",
        dayOfMonth: builder.dayOfMonth,
      };
    }
    if (builder.kind === "price_threshold") {
      return {
        ...base,
        kind: "price_threshold",
        operator: builder.priceOperator,
        value: builder.priceValue,
        currency: builder.currency,
        action: builder.action,
        sizePct: builder.sizePct,
      };
    }
    return {
      ...base,
      kind: "fundamental_threshold",
      metric: builder.metric,
      operator: builder.fundamentalOperator,
      value: builder.fundamentalValue,
      action: builder.action,
    };
  }

  function sendCatalogPresetToBacktest(input: {
    code: string;
    version: string;
    parameters: Record<string, unknown>;
    symbol?: string;
  }) {
    onUsePreset({
      preset: {
        strategyCode: input.code,
        strategyVersion: input.version,
        strategyParameters: input.parameters,
      },
      symbols: input.symbol ? [input.symbol] : [],
    });
  }

  async function saveDraft() {
    try {
      const strategy = normalizeCustomStrategy(buildDraft());
      if (strategy.kind === "catalog_preset") {
        sendCatalogPresetToBacktest({
          code: strategy.strategyCode,
          version: strategy.strategyVersion,
          parameters: strategy.strategyParameters,
          symbol: strategy.symbol,
        });
        return;
      }
      if (strategy.kind === "fundamental_threshold") {
        toast.error(t("strategyLab.fundamentalUnavailable"));
        return;
      }
      setSaving(true);
      const rule =
        strategy.kind === "scheduled_dca"
          ? {
              schemaVersion: 1 as const,
              kind: "scheduled_dca" as const,
              contributionAmount: strategy.amount,
              currency: strategy.currency,
              frequency: "monthly" as const,
              dayOfMonth: strategy.dayOfMonth,
            }
          : {
              schemaVersion: 1 as const,
              kind: "price_threshold" as const,
              operator: strategy.operator,
              threshold: strategy.value,
              currency: strategy.currency,
              action: strategy.action,
              sizePct: strategy.sizePct,
            };
      const result = editingId
        ? await createCustomStrategyVersion(editingId, { rule })
        : await createCustomStrategy({ name: strategy.name, description: strategy.symbol, rule });
      setSaved((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setEditingId(null);
      setSection("mine");
      toast.success(t("strategyLab.saved"));
    } catch {
      toast.error(t("strategyLab.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function archive(id: string) {
    try {
      const archived = await archiveCustomStrategy(id);
      setSaved((current) => current.map((item) => (item.id === archived.id ? archived : item)));
      toast.success(t("strategyLab.archived"));
    } catch {
      toast.error(t("strategyLab.archiveError"));
    }
  }

  function edit(strategy: CustomStrategySummary) {
    const latest = strategy.versions[0];
    if (!latest) return;
    setEditingId(strategy.id);
    setBuilder((current) =>
      applySavedRuleToStrategyBuilder(current, {
        name: strategy.name,
        symbol: strategy.description,
        rule: latest.rule,
      }),
    );
    setSection("builder");
  }

  const selectedDefinition = STRATEGY_CATALOG.find((item) => item.code === builder.strategyCode)!;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen /> {t("strategyLab.title")}
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                {t("strategyLab.description")}
              </CardDescription>
            </div>
            <Badge variant="secondary">{t("strategyLab.badge")}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm md:grid-cols-4">
            {[
              t("strategyLab.flow1"),
              t("strategyLab.flow2"),
              t("strategyLab.flow3"),
              t("strategyLab.flow4"),
            ].map((step, index) => (
              <div key={step} className="flex items-center gap-2 rounded-lg border p-3">
                {index === 1 ? (
                  <CheckCircle2 className="text-primary" />
                ) : (
                  <ArrowRight className="text-muted-foreground" />
                )}
                <span>{step}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={section} onValueChange={setSection}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            <TabsTrigger value="library">
              <BookOpen /> {t("strategyLab.library")}
            </TabsTrigger>
            <TabsTrigger value="builder">
              <Wrench /> {t("strategyLab.builder")}
            </TabsTrigger>
            <TabsTrigger value="mine">
              <Save /> {t("strategyLab.mine", { count: saved.length })}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="library">
          <StrategyLibraryPanel
            query={libraryQuery}
            family={libraryFamily}
            onQueryChange={setLibraryQuery}
            onFamilyChange={setLibraryFamily}
            onBuild={() => setSection("builder")}
            onCustomize={(strategyCode) => {
              selectCatalogStrategy(strategyCode);
              setSection("builder");
            }}
            onUsePreset={sendCatalogPresetToBacktest}
          />
        </TabsContent>

        <TabsContent value="builder">
          <StrategyBuilderPanel
            builder={builder}
            setBuilder={setBuilder}
            selectedDefinition={selectedDefinition}
            saving={saving}
            editing={editingId !== null}
            onSelectCatalog={selectCatalogStrategy}
            onSave={() => void saveDraft()}
          />
        </TabsContent>

        <TabsContent value="mine">
          <SavedStrategiesPanel
            strategies={saved}
            loading={loadingSaved}
            onCreate={() => setSection("builder")}
            onArchive={(id) => void archive(id)}
            onEdit={edit}
            onUseBacktest={(strategy) => {
              const latest = strategy.versions[0];
              if (!latest?.executionCode) return;
              sendCatalogPresetToBacktest({
                code: latest.executionCode,
                version: latest.version,
                parameters: {},
                symbol: strategy.description ?? undefined,
              });
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
