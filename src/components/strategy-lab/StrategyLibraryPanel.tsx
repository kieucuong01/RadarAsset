"use client";

import { useMemo } from "react";
import { FlaskConical, Search, Wrench } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/dictionary";
import { listStrategyLibrary, type StrategyFamily } from "@/lib/strategy-lab/library";

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

export type StrategyLibraryFamily = "all" | StrategyFamily;

export function StrategyLibraryPanel({
  query,
  family,
  onQueryChange,
  onFamilyChange,
  onBuild,
  onCustomize,
  onUsePreset,
}: {
  query: string;
  family: StrategyLibraryFamily;
  onQueryChange: (query: string) => void;
  onFamilyChange: (family: StrategyLibraryFamily) => void;
  onBuild: () => void;
  onCustomize: (strategyCode: string) => void;
  onUsePreset: (input: {
    code: string;
    version: string;
    parameters: Record<string, unknown>;
  }) => void;
}) {
  const { t, locale } = useI18n();
  const library = useMemo(() => listStrategyLibrary(), []);
  const searchLocale = locale === "vi" ? "vi-VN" : "en-US";
  const normalizedQuery = query.trim().toLocaleLowerCase(searchLocale);
  const filteredLibrary = library.filter(
    (strategy) =>
      (family === "all" || family === strategy.family) &&
      (!normalizedQuery ||
        `${strategy.name} ${t(guideKey(strategy.code, "thesis"))} ${t(STYLE_KEYS[strategy.style])}`
          .toLocaleLowerCase(searchLocale)
          .includes(normalizedQuery)),
  );

  return (
    <div className="flex flex-col gap-5">
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
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="MA, RSI, bứt phá..."
                  />
                </div>
              </Field>
              <Field>
                <FieldLabel>{t("strategyLab.family")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={family}
                  onValueChange={(value) => value && onFamilyChange(value as StrategyLibraryFamily)}
                  variant="outline"
                >
                  <ToggleGroupItem value="all">{t("strategyLab.all")}</ToggleGroupItem>
                  <ToggleGroupItem value="technical">{t("strategyLab.technical")}</ToggleGroupItem>
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

      {family === "fundamental" ? <CapabilityCard family="fundamental" onBuild={onBuild} /> : null}
      {family === "systematic" ? <CapabilityCard family="systematic" onBuild={onBuild} /> : null}
      {family === "all" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CapabilityCard family="fundamental" onBuild={onBuild} />
          <CapabilityCard family="systematic" onBuild={onBuild} />
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
                        {t("strategyLab.timeframes")}: {strategy.supportedTimeframes.join(", ")} ·{" "}
                        {t("strategyLab.version")} {strategy.version}
                      </p>
                      <p>{strategy.sourceAttribution}</p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
              <CardFooter className="flex flex-wrap justify-between gap-3">
                <Button variant="outline" onClick={() => onCustomize(strategy.code)}>
                  <Wrench data-icon="inline-start" /> {t("strategyLab.customize")}
                </Button>
                <Button
                  onClick={() =>
                    onUsePreset({
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
