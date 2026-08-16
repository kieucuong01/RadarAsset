"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FlaskConical,
  Plus,
  Save,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BacktestStrategyPreset } from "@/lib/backtest/preselection";
import { STRATEGY_CATALOG, strategyDefinition } from "@/lib/backtest/strategy-catalog";
import {
  customStrategyReadiness,
  describeCustomStrategy,
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
import { listStrategyLibrary, type StrategyFamily } from "@/lib/strategy-lab/library";
import { useI18n } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";

const FAMILY_LABELS: Record<
  StrategyFamily,
  "strategyLab.technical" | "strategyLab.fundamental" | "strategyLab.systematic"
> = {
  technical: "strategyLab.technical",
  fundamental: "strategyLab.fundamental",
  systematic: "strategyLab.systematic",
};
const STYLE_KEYS = {
  trend: "strategyLab.styles.trend",
  momentum: "strategyLab.styles.momentum",
  mean_reversion: "strategyLab.styles.mean_reversion",
  pattern: "strategyLab.styles.pattern",
} as const;

function guideKey(
  code: string,
  field: "thesis" | "entry" | "exit" | "ideal1" | "ideal2" | "risk1" | "risk2",
) {
  return `strategyLab.guides.${code}.${field}` as TranslationKey;
}

type BuilderKind = CustomStrategyInput["kind"];
type BuilderState = {
  name: string;
  symbol: string;
  kind: BuilderKind;
  strategyCode: string;
  strategyParameters: Record<string, number>;
  amount: number;
  currency: "USD" | "VND";
  dayOfMonth: number;
  priceOperator: "crosses_above" | "crosses_below";
  priceValue: number;
  action: "buy" | "sell";
  sizePct: number;
  metric: "pb" | "pe" | "roe";
  fundamentalOperator: "lt" | "lte" | "gt" | "gte";
  fundamentalValue: number;
};

export type StrategyLabSelection = {
  preset: BacktestStrategyPreset;
  symbols: string[];
};

function initialBuilderState(name: string): BuilderState {
  const strategy = STRATEGY_CATALOG[0];
  return {
    name,
    symbol: "BTC",
    kind: "catalog_preset",
    strategyCode: strategy.code,
    strategyParameters: { ...strategy.defaultParameters },
    amount: 400,
    currency: "USD",
    dayOfMonth: 1,
    priceOperator: "crosses_below",
    priceValue: 50_000,
    action: "sell",
    sizePct: 100,
    metric: "pb",
    fundamentalOperator: "lt",
    fundamentalValue: 4,
  };
}

export function StrategyLab({
  onUsePreset,
}: {
  onUsePreset: (selection: StrategyLabSelection) => void;
}) {
  const { t, locale } = useI18n();
  const library = useMemo(() => listStrategyLibrary(), []);
  const [section, setSection] = useState("library");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<"all" | StrategyFamily>("all");
  const [builder, setBuilder] = useState<BuilderState>(() =>
    initialBuilderState(t("strategyLab.defaultName")),
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

  const filteredLibrary = library.filter((strategy) => {
    const searchLocale = locale === "vi" ? "vi-VN" : "en-US";
    const normalizedQuery = query.trim().toLocaleLowerCase(searchLocale);
    return (
      (family === "all" || family === strategy.family) &&
      (!normalizedQuery ||
        `${strategy.name} ${t(guideKey(strategy.code, "thesis"))} ${t(STYLE_KEYS[strategy.style])}`
          .toLocaleLowerCase(searchLocale)
          .includes(normalizedQuery))
    );
  });

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
    } catch (error) {
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
    setBuilder((current) => {
      if (latest.rule.kind === "scheduled_dca") {
        return {
          ...current,
          name: strategy.name,
          symbol: strategy.description ?? current.symbol,
          kind: "scheduled_dca",
          amount: latest.rule.contributionAmount,
          currency: latest.rule.currency,
          dayOfMonth: latest.rule.dayOfMonth,
        };
      }
      return {
        ...current,
        name: strategy.name,
        symbol: strategy.description ?? current.symbol,
        kind: "price_threshold",
        priceOperator: latest.rule.operator,
        priceValue: latest.rule.threshold,
        currency: latest.rule.currency,
        action: latest.rule.action,
        sizePct: latest.rule.sizePct,
      };
    });
    setSection("builder");
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

        <TabsContent value="library" className="flex flex-col gap-5">
          <Card>
            <CardContent className="pt-6">
              <FieldGroup>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <Field>
                    <FieldLabel htmlFor="strategy-search">{t("strategyLab.search")}</FieldLabel>
                    <div className="relative">
                      <Search
                        aria-hidden="true"
                        className="absolute left-3 top-2.5 size-4 text-muted-foreground"
                      />
                      <Input
                        id="strategy-search"
                        className="pl-9"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="MA, RSI, breakout..."
                      />
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel>{t("strategyLab.family")}</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={family}
                      onValueChange={(value) => value && setFamily(value as typeof family)}
                      variant="outline"
                    >
                      <ToggleGroupItem value="all">{t("strategyLab.all")}</ToggleGroupItem>
                      <ToggleGroupItem value="technical">
                        {t("strategyLab.technical")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="fundamental">
                        {t("strategyLab.fundamental")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="systematic">
                        {t("strategyLab.systematic")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          {family === "fundamental" ? (
            <CapabilityCard family="fundamental" onBuild={() => setSection("builder")} />
          ) : null}
          {family === "systematic" ? (
            <CapabilityCard family="systematic" onBuild={() => setSection("builder")} />
          ) : null}
          {family === "all" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <CapabilityCard family="fundamental" onBuild={() => setSection("builder")} />
              <CapabilityCard family="systematic" onBuild={() => setSection("builder")} />
            </div>
          ) : null}

          {filteredLibrary.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredLibrary.map((strategy) => (
                <Card key={`${strategy.code}@${strategy.version}`}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>{strategy.name}</CardTitle>
                        <CardDescription className="mt-1">
                          {t(guideKey(strategy.code, "thesis"))}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge>{t(FAMILY_LABELS[strategy.family])}</Badge>
                        <Badge variant="outline">{t(STYLE_KEYS[strategy.style])}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="logic">
                        <AccordionTrigger>{t("strategyLab.entryExit")}</AccordionTrigger>
                        <AccordionContent className="flex flex-col gap-2 text-muted-foreground">
                          <p>
                            <strong className="text-foreground">{t("strategyLab.entry")}:</strong>{" "}
                            {t(guideKey(strategy.code, "entry"))}
                          </p>
                          <p>
                            <strong className="text-foreground">{t("strategyLab.exit")}:</strong>{" "}
                            {t(guideKey(strategy.code, "exit"))}
                          </p>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="fit">
                        <AccordionTrigger>{t("strategyLab.fitRisk")}</AccordionTrigger>
                        <AccordionContent className="grid gap-4 md:grid-cols-2">
                          <GuideList
                            title={t("strategyLab.ideal")}
                            items={[
                              t(guideKey(strategy.code, "ideal1")),
                              t(guideKey(strategy.code, "ideal2")),
                            ]}
                          />
                          <GuideList
                            title={t("strategyLab.risk")}
                            items={[
                              t(guideKey(strategy.code, "risk1")),
                              t(guideKey(strategy.code, "risk2")),
                            ]}
                          />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="requirements">
                        <AccordionTrigger>{t("strategyLab.requirements")}</AccordionTrigger>
                        <AccordionContent className="flex flex-col gap-3 text-muted-foreground">
                          <p>
                            {t("strategyLab.data")}: {strategy.dataRequirements.join(", ")} ·{" "}
                            {t("strategyLab.warmup")}: {strategy.requiredWarmup}
                          </p>
                          <p>
                            {t("strategyLab.timeframes")}: {strategy.supportedTimeframes.join(", ")}{" "}
                            · {t("strategyLab.version")} {strategy.version}
                          </p>
                          <p>{strategy.sourceAttribution}</p>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </CardContent>
                  <CardFooter className="flex flex-wrap justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        selectCatalogStrategy(strategy.code);
                        setSection("builder");
                      }}
                    >
                      <Wrench data-icon="inline-start" /> {t("strategyLab.customize")}
                    </Button>
                    <Button
                      onClick={() =>
                        sendCatalogPresetToBacktest({
                          code: strategy.code,
                          version: strategy.version,
                          parameters: strategy.defaultParameters,
                        })
                      }
                    >
                      <FlaskConical data-icon="inline-start" /> {t("strategyLab.useBacktest")}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="builder">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t("strategyLab.visualBuilder")}</CardTitle>
                <CardDescription>{t("strategyLab.visualBuilderDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="custom-strategy-name">
                        {t("strategyLab.strategyName")}
                      </FieldLabel>
                      <Input
                        id="custom-strategy-name"
                        value={builder.name}
                        onChange={(event) =>
                          setBuilder((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="custom-strategy-symbol">
                        {t("strategyLab.assetSymbol")}
                      </FieldLabel>
                      <Input
                        id="custom-strategy-symbol"
                        value={builder.symbol}
                        onChange={(event) =>
                          setBuilder((current) => ({
                            ...current,
                            symbol: event.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="BTC, FPT, XAU"
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel>{t("strategyLab.ruleType")}</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={builder.kind}
                      onValueChange={(value) =>
                        value &&
                        setBuilder((current) => ({ ...current, kind: value as BuilderKind }))
                      }
                      variant="outline"
                      className="flex-wrap justify-start"
                    >
                      <ToggleGroupItem value="catalog_preset">
                        {t("strategyLab.technicalIndicator")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="scheduled_dca">
                        {t("strategyLab.dca")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="price_threshold">
                        {t("strategyLab.priceThreshold")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="fundamental_threshold">
                        {t("strategyLab.fundamentalMetric")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  <RuleFields
                    builder={builder}
                    setBuilder={setBuilder}
                    selectedDefinition={selectedDefinition}
                    onSelectCatalog={selectCatalogStrategy}
                  />
                </FieldGroup>
              </CardContent>
              <CardFooter>
                <Button disabled={saving} onClick={() => void saveDraft()}>
                  <Save data-icon="inline-start" />
                  {editingId ? t("strategyLab.saveNewVersion") : t("strategyLab.saveStrategy")}
                </Button>
              </CardFooter>
            </Card>

            <BuilderPreview builder={builder} />
          </div>
        </TabsContent>

        <TabsContent value="mine">
          {loadingSaved ? (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                {t("strategyLab.loading")}
              </CardContent>
            </Card>
          ) : saved.filter((strategy) => strategy.status === "active").length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("strategyLab.noCustomTitle")}</CardTitle>
                <CardDescription>{t("strategyLab.noCustomDescription")}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button onClick={() => setSection("builder")}>
                  <Plus data-icon="inline-start" /> {t("strategyLab.createStrategy")}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {saved
                .filter((strategy) => strategy.status === "active")
                .map((strategy) => {
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
                          <ReadinessBadge status="executable" />
                        </div>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        {t("strategyLab.dbBacked")}
                      </CardContent>
                      <CardFooter className="flex flex-wrap justify-between gap-3">
                        <Button variant="outline" onClick={() => void archive(strategy.id)}>
                          <Trash2 data-icon="inline-start" /> {t("strategyLab.delete")}
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => edit(strategy)}>
                            <Wrench data-icon="inline-start" /> {t("strategyLab.edit")}
                          </Button>
                          <Button
                            disabled={!latest?.executionCode}
                            onClick={() => {
                              if (!latest?.executionCode) return;
                              sendCatalogPresetToBacktest({
                                code: latest.executionCode,
                                version: latest.version,
                                parameters: {},
                                symbol: strategy.description ?? undefined,
                              });
                            }}
                          >
                            <FlaskConical data-icon="inline-start" /> {t("strategyLab.useBacktest")}
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  );
                })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CapabilityCard({
  family,
  onBuild,
}: {
  family: "fundamental" | "systematic";
  onBuild: () => void;
}) {
  const { t } = useI18n();
  const fundamental = family === "fundamental";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              {fundamental
                ? t("strategyLab.capabilityFundamentalTitle")
                : t("strategyLab.capabilitySystematicTitle")}
            </CardTitle>
            <CardDescription className="mt-1">
              {fundamental
                ? t("strategyLab.capabilityFundamentalDesc")
                : t("strategyLab.capabilitySystematicDesc")}
            </CardDescription>
          </div>
          <Badge variant="outline">
            {fundamental ? t("strategyLab.needsData") : t("strategyLab.executable")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {fundamental
          ? t("strategyLab.capabilityFundamentalBody")
          : t("strategyLab.capabilitySystematicBody")}
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={onBuild}>
          <Wrench data-icon="inline-start" /> {t("strategyLab.buildRule")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function GuideList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-2 list-disc pl-5 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ReadinessBadge({
  status,
}: {
  status: ReturnType<typeof customStrategyReadiness>["status"];
}) {
  const { t } = useI18n();
  if (status === "executable") return <Badge>{t("strategyLab.executable")}</Badge>;
  return (
    <Badge variant="outline">
      {status === "data_required" ? t("strategyLab.needsData") : t("strategyLab.needsEngine")}
    </Badge>
  );
}

function BuilderPreview({ builder }: { builder: BuilderState }) {
  const { t, locale } = useI18n();
  let draft: CustomStrategyInput | null = null;
  try {
    const base = {
      schemaVersion: 1 as const,
      id: "preview",
      name: builder.name || t("strategyLab.unnamedShort"),
      symbol: builder.symbol || "?",
    };
    if (builder.kind === "catalog_preset") {
      const definition = strategyDefinition(builder.strategyCode, "1.0.0");
      draft = {
        ...base,
        kind: "catalog_preset",
        strategyCode: definition.code,
        strategyVersion: definition.version,
        strategyParameters: builder.strategyParameters,
      };
    } else if (builder.kind === "scheduled_dca") {
      draft = {
        ...base,
        kind: "scheduled_dca",
        amount: builder.amount,
        currency: builder.currency,
        frequency: "monthly",
        dayOfMonth: builder.dayOfMonth,
      };
    } else if (builder.kind === "price_threshold") {
      draft = {
        ...base,
        kind: "price_threshold",
        operator: builder.priceOperator,
        value: builder.priceValue,
        currency: builder.currency,
        action: builder.action,
        sizePct: builder.sizePct,
      };
    } else {
      draft = {
        ...base,
        kind: "fundamental_threshold",
        metric: builder.metric,
        operator: builder.fundamentalOperator,
        value: builder.fundamentalValue,
        action: builder.action,
      };
    }
  } catch {
    draft = null;
  }
  const readiness = draft ? customStrategyReadiness(draft) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("strategyLab.normalizedRule")}</CardTitle>
        <CardDescription>{t("strategyLab.normalizedRuleDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draft && readiness ? (
          <>
            <Alert>
              <CheckCircle2 />
              <AlertTitle>{builder.name || t("strategyLab.unnamed")}</AlertTitle>
              <AlertDescription>{describeCustomStrategy(draft, locale)}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <ReadinessBadge status={readiness.status} />
              <span className="text-sm text-muted-foreground">{readiness.detail}</span>
            </div>
          </>
        ) : (
          <Alert>
            <AlertTitle>{t("strategyLab.invalidRule")}</AlertTitle>
            <AlertDescription>{t("strategyLab.invalidRuleDesc")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function RuleFields({
  builder,
  setBuilder,
  selectedDefinition,
  onSelectCatalog,
}: {
  builder: BuilderState;
  setBuilder: React.Dispatch<React.SetStateAction<BuilderState>>;
  selectedDefinition: (typeof STRATEGY_CATALOG)[number];
  onSelectCatalog: (code: string) => void;
}) {
  const { t } = useI18n();
  if (builder.kind === "catalog_preset") {
    return (
      <>
        <Field>
          <FieldLabel htmlFor="catalog-rule">{t("strategyLab.technicalStrategy")}</FieldLabel>
          <Select value={builder.strategyCode} onValueChange={onSelectCatalog}>
            <SelectTrigger id="catalog-rule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {STRATEGY_CATALOG.map((strategy) => (
                  <SelectItem key={strategy.code} value={strategy.code}>
                    {strategy.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          {selectedDefinition.parameterSchema.map((parameter) => (
            <Field key={parameter.name}>
              <FieldLabel htmlFor={`builder-${parameter.name}`}>{parameter.label}</FieldLabel>
              <Input
                id={`builder-${parameter.name}`}
                type="number"
                min={parameter.min}
                max={parameter.max}
                step={parameter.type === "integer" ? 1 : "any"}
                value={builder.strategyParameters[parameter.name] ?? parameter.default}
                onChange={(event) =>
                  setBuilder((current) => ({
                    ...current,
                    strategyParameters: {
                      ...current.strategyParameters,
                      [parameter.name]: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
          ))}
        </div>
      </>
    );
  }
  if (builder.kind === "scheduled_dca") {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <NumberField
          id="dca-amount"
          label={t("strategyLab.dcaAmount")}
          value={builder.amount}
          min={0.01}
          onChange={(amount) => setBuilder((current) => ({ ...current, amount }))}
        />
        <CurrencyField
          value={builder.currency}
          onChange={(currency) => setBuilder((current) => ({ ...current, currency }))}
        />
        <NumberField
          id="dca-day"
          label={t("strategyLab.dayOfMonth")}
          value={builder.dayOfMonth}
          min={1}
          max={28}
          onChange={(dayOfMonth) => setBuilder((current) => ({ ...current, dayOfMonth }))}
        />
      </div>
    );
  }
  if (builder.kind === "price_threshold") {
    return (
      <>
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            id="price-action"
            label={t("strategyLab.action")}
            value={builder.action}
            options={[
              { value: "buy", label: t("common.buy") },
              { value: "sell", label: t("common.sell") },
            ]}
            onChange={(action) =>
              setBuilder((current) => ({ ...current, action: action as "buy" | "sell" }))
            }
          />
          <SelectField
            id="price-operator"
            label={t("strategyLab.whenPrice")}
            value={builder.priceOperator}
            options={[
              { value: "crosses_above", label: t("strategyLab.crossesAbove") },
              { value: "crosses_below", label: t("strategyLab.crossesBelow") },
            ]}
            onChange={(priceOperator) =>
              setBuilder((current) => ({
                ...current,
                priceOperator: priceOperator as BuilderState["priceOperator"],
              }))
            }
          />
          <NumberField
            id="price-value"
            label={t("strategyLab.priceLevel")}
            value={builder.priceValue}
            min={0.000001}
            onChange={(priceValue) => setBuilder((current) => ({ ...current, priceValue }))}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <CurrencyField
            value={builder.currency}
            onChange={(currency) => setBuilder((current) => ({ ...current, currency }))}
          />
          <NumberField
            id="price-size"
            label={t("strategyLab.positionPct")}
            value={builder.sizePct}
            min={0.01}
            max={100}
            onChange={(sizePct) => setBuilder((current) => ({ ...current, sizePct }))}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <Alert>
        <AlertTitle>{t("strategyLab.fundamentalNeedsData")}</AlertTitle>
        <AlertDescription>{t("strategyLab.fundamentalNeedsDataDesc")}</AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          id="fundamental-metric"
          label={t("strategyLab.metric")}
          value={builder.metric}
          options={[
            { value: "pb", label: "P/B" },
            { value: "pe", label: "P/E" },
            { value: "roe", label: "ROE" },
          ]}
          onChange={(metric) =>
            setBuilder((current) => ({ ...current, metric: metric as BuilderState["metric"] }))
          }
        />
        <SelectField
          id="fundamental-operator"
          label={t("strategyLab.condition")}
          value={builder.fundamentalOperator}
          options={[
            { value: "lt", label: t("strategyLab.lessThan") },
            { value: "lte", label: t("strategyLab.lessThanOrEqual") },
            { value: "gt", label: t("strategyLab.greaterThan") },
            { value: "gte", label: t("strategyLab.greaterThanOrEqual") },
          ]}
          onChange={(fundamentalOperator) =>
            setBuilder((current) => ({
              ...current,
              fundamentalOperator: fundamentalOperator as BuilderState["fundamentalOperator"],
            }))
          }
        />
        <NumberField
          id="fundamental-value"
          label={t("strategyLab.threshold")}
          value={builder.fundamentalValue}
          onChange={(fundamentalValue) =>
            setBuilder((current) => ({ ...current, fundamentalValue }))
          }
        />
      </div>
    </>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function CurrencyField({
  value,
  onChange,
}: {
  value: "USD" | "VND";
  onChange: (value: "USD" | "VND") => void;
}) {
  const { t } = useI18n();
  return (
    <SelectField
      id="rule-currency"
      label={t("strategyLab.currency")}
      value={value}
      options={[
        { value: "USD", label: "USD" },
        { value: "VND", label: "VND" },
      ]}
      onChange={(currency) => onChange(currency as "USD" | "VND")}
    />
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
