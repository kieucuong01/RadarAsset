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
  parseStoredCustomStrategies,
  serializeCustomStrategies,
  type CustomStrategy,
  type CustomStrategyInput,
} from "@/lib/strategy-lab/custom-strategy";
import { listStrategyLibrary, type StrategyFamily } from "@/lib/strategy-lab/library";

const STORAGE_KEY = "radarasset.strategy-lab.v1";
const FAMILY_LABELS: Record<StrategyFamily, string> = {
  technical: "Phân tích kỹ thuật",
  fundamental: "Phân tích cơ bản",
  systematic: "Hệ thống / phân bổ",
};
const STYLE_LABELS = {
  trend: "Trend following",
  momentum: "Momentum",
  mean_reversion: "Mean reversion",
  pattern: "Pattern",
} as const;

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

function initialBuilderState(): BuilderState {
  const strategy = STRATEGY_CATALOG[0];
  return {
    name: "Chiến lược của tôi",
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
  const library = useMemo(() => listStrategyLibrary(), []);
  const [section, setSection] = useState("library");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<"all" | StrategyFamily>("all");
  const [builder, setBuilder] = useState<BuilderState>(initialBuilderState);
  const [saved, setSaved] = useState<CustomStrategy[]>([]);

  useEffect(() => {
    setSaved(parseStoredCustomStrategies(window.localStorage.getItem(STORAGE_KEY)));
  }, []);

  const filteredLibrary = library.filter((strategy) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return (
      (family === "all" || family === strategy.family) &&
      (!normalizedQuery ||
        `${strategy.name} ${strategy.thesis} ${STYLE_LABELS[strategy.style]}`
          .toLocaleLowerCase("vi")
          .includes(normalizedQuery))
    );
  });

  function persist(next: CustomStrategy[]) {
    window.localStorage.setItem(STORAGE_KEY, serializeCustomStrategies(next));
    setSaved(next);
  }

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

  function saveDraft() {
    try {
      const strategy = normalizeCustomStrategy(buildDraft());
      persist([...saved, strategy]);
      setSection("mine");
      toast.success("Đã lưu thiết kế chiến lược trên trình duyệt này.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rule chưa hợp lệ.");
    }
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
                <BookOpen /> Strategy Lab
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                Hiểu chiến lược trước khi dùng, thiết kế rule không cần viết code và chỉ đưa vào
                Backtest những rule engine thực sự hỗ trợ.
              </CardDescription>
            </div>
            <Badge variant="secondary">No-code rules · v1</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm md:grid-cols-4">
            {[
              "1. Tối ưu phân bổ",
              "2. Chọn / thiết kế chiến lược",
              "3. Backtest danh mục",
              "4. Theo dõi ở Mock Portfolio",
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
              <BookOpen /> Thư viện
            </TabsTrigger>
            <TabsTrigger value="builder">
              <Wrench /> Thiết kế chiến lược
            </TabsTrigger>
            <TabsTrigger value="mine">
              <Save /> Chiến lược của tôi ({saved.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="library" className="flex flex-col gap-5">
          <Card>
            <CardContent className="pt-6">
              <FieldGroup>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <Field>
                    <FieldLabel htmlFor="strategy-search">Tìm chiến lược</FieldLabel>
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
                    <FieldLabel>Nhóm phân tích</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={family}
                      onValueChange={(value) => value && setFamily(value as typeof family)}
                      variant="outline"
                    >
                      <ToggleGroupItem value="all">Tất cả</ToggleGroupItem>
                      <ToggleGroupItem value="technical">Kỹ thuật</ToggleGroupItem>
                      <ToggleGroupItem value="fundamental">Cơ bản</ToggleGroupItem>
                      <ToggleGroupItem value="systematic">Hệ thống</ToggleGroupItem>
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
                        <CardDescription className="mt-1">{strategy.thesis}</CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge>{FAMILY_LABELS[strategy.family]}</Badge>
                        <Badge variant="outline">{STYLE_LABELS[strategy.style]}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="logic">
                        <AccordionTrigger>Logic mua / bán</AccordionTrigger>
                        <AccordionContent className="flex flex-col gap-2 text-muted-foreground">
                          <p>
                            <strong className="text-foreground">Mua:</strong> {strategy.entryRule}
                          </p>
                          <p>
                            <strong className="text-foreground">Bán:</strong> {strategy.exitRule}
                          </p>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="fit">
                        <AccordionTrigger>Khi nào phù hợp và rủi ro</AccordionTrigger>
                        <AccordionContent className="grid gap-4 md:grid-cols-2">
                          <GuideList title="Phù hợp" items={strategy.idealConditions} />
                          <GuideList title="Rủi ro" items={strategy.risks} />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="requirements">
                        <AccordionTrigger>Dữ liệu, thị trường và tham số</AccordionTrigger>
                        <AccordionContent className="flex flex-col gap-3 text-muted-foreground">
                          <p>
                            Dữ liệu: {strategy.dataRequirements.join(", ")} · Warm-up:{" "}
                            {strategy.requiredWarmup}
                          </p>
                          <p>
                            Khung: {strategy.supportedTimeframes.join(", ")} · Version{" "}
                            {strategy.version}
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
                      <Wrench data-icon="inline-start" /> Tùy chỉnh tham số
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
                      <FlaskConical data-icon="inline-start" /> Dùng trong Backtest
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
                <CardTitle>Visual Rule Builder</CardTitle>
                <CardDescription>
                  Mỗi thiết kế có một tài sản, trigger/điều kiện và hành động rõ ràng.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="custom-strategy-name">Tên chiến lược</FieldLabel>
                      <Input
                        id="custom-strategy-name"
                        value={builder.name}
                        onChange={(event) =>
                          setBuilder((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="custom-strategy-symbol">Mã tài sản</FieldLabel>
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
                    <FieldLabel>Loại rule</FieldLabel>
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
                      <ToggleGroupItem value="catalog_preset">Indicator kỹ thuật</ToggleGroupItem>
                      <ToggleGroupItem value="scheduled_dca">DCA định kỳ</ToggleGroupItem>
                      <ToggleGroupItem value="price_threshold">Ngưỡng giá</ToggleGroupItem>
                      <ToggleGroupItem value="fundamental_threshold">Chỉ số cơ bản</ToggleGroupItem>
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
                <Button onClick={saveDraft}>
                  <Save data-icon="inline-start" /> Lưu chiến lược
                </Button>
              </CardFooter>
            </Card>

            <BuilderPreview builder={builder} />
          </div>
        </TabsContent>

        <TabsContent value="mine">
          {saved.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Chưa có chiến lược tự thiết kế</CardTitle>
                <CardDescription>Tạo rule đầu tiên từ Visual Rule Builder.</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button onClick={() => setSection("builder")}>
                  <Plus data-icon="inline-start" /> Tạo chiến lược
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {saved.map((strategy) => {
                const readiness = customStrategyReadiness(strategy);
                return (
                  <Card key={strategy.id}>
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle>{strategy.name}</CardTitle>
                          <CardDescription className="mt-1">
                            {describeCustomStrategy(strategy)}
                          </CardDescription>
                        </div>
                        <ReadinessBadge status={readiness.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {readiness.detail}
                    </CardContent>
                    <CardFooter className="flex flex-wrap justify-between gap-3">
                      <Button
                        variant="outline"
                        onClick={() => persist(saved.filter((item) => item.id !== strategy.id))}
                      >
                        <Trash2 data-icon="inline-start" /> Xóa
                      </Button>
                      <Button
                        disabled={strategy.kind !== "catalog_preset"}
                        onClick={() => {
                          if (strategy.kind !== "catalog_preset") return;
                          sendCatalogPresetToBacktest({
                            code: strategy.strategyCode,
                            version: strategy.strategyVersion,
                            parameters: strategy.strategyParameters,
                            symbol: strategy.symbol,
                          });
                        }}
                      >
                        <FlaskConical data-icon="inline-start" /> Dùng trong Backtest
                      </Button>
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
  const fundamental = family === "fundamental";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{fundamental ? "Phân tích cơ bản" : "Chiến lược hệ thống"}</CardTitle>
            <CardDescription className="mt-1">
              {fundamental
                ? "P/B, P/E và ROE theo thời điểm công bố."
                : "DCA và rule dòng tiền theo lịch."}
            </CardDescription>
          </div>
          <Badge variant="outline">{fundamental ? "Cần dữ liệu" : "Cần engine"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {fundamental
          ? "Có thể thiết kế và lưu rule ngay, nhưng hệ thống chưa backtest cho đến khi có dữ liệu báo cáo tài chính point-in-time để tránh look-ahead bias."
          : "Có thể thiết kế DCA hàng tháng ngay. Engine portfolio đã có cash-flow assumptions, nhưng chưa thực thi DCA thành lệnh theo từng tài sản."}
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={onBuild}>
          <Wrench data-icon="inline-start" /> Thiết kế rule
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
  if (status === "executable") return <Badge>Có thể backtest</Badge>;
  return (
    <Badge variant="outline">{status === "data_required" ? "Cần dữ liệu" : "Cần engine"}</Badge>
  );
}

function BuilderPreview({ builder }: { builder: BuilderState }) {
  let draft: CustomStrategyInput | null = null;
  try {
    const base = {
      schemaVersion: 1 as const,
      id: "preview",
      name: builder.name || "Chưa đặt tên",
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
        <CardTitle>Rule đã chuẩn hóa</CardTitle>
        <CardDescription>Đây là điều hệ thống hiểu và sẽ lưu.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draft && readiness ? (
          <>
            <Alert>
              <CheckCircle2 />
              <AlertTitle>{builder.name || "Chiến lược chưa đặt tên"}</AlertTitle>
              <AlertDescription>{describeCustomStrategy(draft)}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <ReadinessBadge status={readiness.status} />
              <span className="text-sm text-muted-foreground">{readiness.detail}</span>
            </div>
          </>
        ) : (
          <Alert>
            <AlertTitle>Rule chưa hợp lệ</AlertTitle>
            <AlertDescription>Điền đầy đủ tên, mã và tham số hợp lệ.</AlertDescription>
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
  if (builder.kind === "catalog_preset") {
    return (
      <>
        <Field>
          <FieldLabel htmlFor="catalog-rule">Chiến lược kỹ thuật</FieldLabel>
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
          label="Số tiền mỗi tháng"
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
          label="Ngày trong tháng"
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
            label="Hành động"
            value={builder.action}
            options={[
              { value: "buy", label: "Mua" },
              { value: "sell", label: "Bán" },
            ]}
            onChange={(action) =>
              setBuilder((current) => ({ ...current, action: action as "buy" | "sell" }))
            }
          />
          <SelectField
            id="price-operator"
            label="Khi giá"
            value={builder.priceOperator}
            options={[
              { value: "crosses_above", label: "Cắt lên" },
              { value: "crosses_below", label: "Cắt xuống" },
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
            label="Mức giá"
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
            label="Tỷ lệ vị thế (%)"
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
        <AlertTitle>Fundamental rule cần dữ liệu point-in-time</AlertTitle>
        <AlertDescription>
          Rule được lưu để hoàn thiện quy trình, nhưng nút Backtest sẽ bị khóa cho đến khi hệ thống
          ingest lịch sử báo cáo tài chính theo ngày công bố.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          id="fundamental-metric"
          label="Chỉ số"
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
          label="Điều kiện"
          value={builder.fundamentalOperator}
          options={[
            { value: "lt", label: "Nhỏ hơn" },
            { value: "lte", label: "Nhỏ hơn hoặc bằng" },
            { value: "gt", label: "Lớn hơn" },
            { value: "gte", label: "Lớn hơn hoặc bằng" },
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
          label="Ngưỡng"
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
  return (
    <SelectField
      id="rule-currency"
      label="Đồng tiền"
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
