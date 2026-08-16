"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AssetOpinionFormula, AssetOpinionHighlights } from "./AssetOpinionCalculation";
import { AssetOpinionSourcesDisclosure } from "./AssetOpinionSourcesDisclosure";
import {
  failedGateLabel,
  isTechnicalQuantOpinion,
  metricLabel,
  pillarLabel,
  technicalQuantLimitation,
} from "./asset-opinion-labels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";
import { formatPercent, formatScore } from "@/lib/financial-format";

type Locale = "vi" | "en";

const ACTIONS: Record<string, { vi: string; en: string }> = {
  HOLD: { vi: "Giữ và theo dõi", en: "Hold and monitor" },
  REVIEW_INCREASE: { vi: "Xem xét tăng tỷ trọng", en: "Review increasing exposure" },
  REVIEW_REDUCE_RISK: { vi: "Xem xét giảm rủi ro", en: "Review reducing risk" },
  WAIT_CONFIRMATION: { vi: "Chờ dữ liệu xác nhận", en: "Wait for confirmation" },
  NO_ACTION_INSUFFICIENT_DATA: { vi: "Chưa hành động", en: "No action yet" },
};

const INVALIDATION_LABELS: Record<string, { vi: string; en: string }> = {
  ASSET_SCORE_BELOW_40: { vi: "Điểm tài sản giảm xuống dưới 40", en: "Asset score falls below 40" },
  ASSET_SCORE_BELOW_15: { vi: "Điểm tài sản giảm xuống dưới 15", en: "Asset score falls below 15" },
  ASSET_SCORE_ABOVE_NEGATIVE_15: {
    vi: "Điểm tài sản phục hồi lên trên -15",
    en: "Asset score recovers above -15",
  },
  ASSET_SCORE_ABOVE_NEGATIVE_40: {
    vi: "Điểm tài sản phục hồi lên trên -40",
    en: "Asset score recovers above -40",
  },
  ASSET_SCORE_OUTSIDE_NEGATIVE_15_TO_15: {
    vi: "Điểm tài sản thoát vùng trung tính -15 đến 15",
    en: "Asset score leaves the neutral -15 to 15 range",
  },
  BTC_TREND_TURNS_NEGATIVE: {
    vi: "Xu hướng BTC chuyển sang âm",
    en: "BTC trend turns negative",
  },
  BTC_TREND_TURNS_POSITIVE: {
    vi: "Xu hướng BTC chuyển sang dương",
    en: "BTC trend turns positive",
  },
  ALTCOIN_SEASON_BELOW_75: {
    vi: "Altcoin Season giảm xuống dưới 75",
    en: "Altcoin Season falls below 75",
  },
  ALTCOIN_SEASON_ABOVE_75: {
    vi: "Altcoin Season tăng lên trên 75",
    en: "Altcoin Season rises above 75",
  },
  ALTCOIN_SEASON_ABOVE_25: {
    vi: "Altcoin Season phục hồi lên trên 25",
    en: "Altcoin Season recovers above 25",
  },
  ETH_ETF_FLOW_TURNS_NEGATIVE: {
    vi: "Dòng tiền ETF ETH chuyển sang âm",
    en: "ETH ETF flow turns negative",
  },
  ETH_ETF_FLOW_TURNS_POSITIVE: {
    vi: "Dòng tiền ETF ETH chuyển sang dương",
    en: "ETH ETF flow turns positive",
  },
  SOL_ETF_FLOW_TURNS_NEGATIVE: {
    vi: "Dòng tiền ETF SOL chuyển sang âm",
    en: "SOL ETF flow turns negative",
  },
  SOL_ETF_FLOW_TURNS_POSITIVE: {
    vi: "Dòng tiền ETF SOL chuyển sang dương",
    en: "SOL ETF flow turns positive",
  },
};

function actionLabel(action: string, locale: Locale) {
  return ACTIONS[action]?.[locale] ?? action.replaceAll("_", " ");
}

function analysisStatus(opinion: AssetOpinionModel, locale: Locale) {
  if (opinion.explanationStatus === "accepted") {
    return locale === "vi" ? "AI đã phân tích" : "AI analyzed";
  }
  if (opinion.explanationStatus === "quant_only") {
    if (isTechnicalQuantOpinion(opinion)) {
      return locale === "vi" ? "Quant kỹ thuật" : "Technical quant";
    }
    return locale === "vi" ? "Phân tích định lượng" : "Quant analysis";
  }
  return locale === "vi" ? "Chưa đủ dữ liệu" : "Insufficient data";
}

function Scenario({
  kind,
  title,
  body,
}: {
  kind: "bull" | "base" | "bear";
  title: string;
  body: string | null;
}) {
  const Icon = kind === "bull" ? TrendingUp : kind === "bear" ? TrendingDown : CheckCircle2;
  return (
    <article className="flex min-h-36 flex-col gap-3 rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2">
        <Icon
          className={kind === "bull" ? "text-bull" : kind === "bear" ? "text-bear" : "text-primary"}
          aria-hidden="true"
        />
        <h4 className="font-semibold">{title}</h4>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{body ?? "—"}</p>
    </article>
  );
}

function Charts({ opinion, locale }: { opinion: AssetOpinionModel; locale: Locale }) {
  const pillarBars = opinion.pillars.map((pillar) => ({
    code: pillarLabel(pillar.code, locale),
    score: Number(pillar.score ?? 0),
  }));
  const contributionBars = opinion.decisionInputs.slice(0, 8).map((input) => ({
    code: metricLabel(input.metricCode, locale),
    contribution: Number(input.contribution),
  }));
  const maxContribution = Math.max(
    5,
    ...contributionBars.map((row) => Math.ceil(Math.abs(row.contribution))),
  );

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <section className="min-w-0 rounded-xl border bg-background p-4">
        <h4 className="font-semibold">
          {locale === "vi" ? "Dữ liệu đóng góp vào kết luận" : "Decision contributions"}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {locale === "vi"
            ? "Thanh xanh ủng hộ; thanh đỏ phản biện. Chỉ gồm dữ liệu thật sự được dùng."
            : "Green supports; red contradicts. Only decision inputs are included."}
        </p>
        {contributionBars.length ? (
          <div
            className="mt-4 h-72 min-w-0"
            role="img"
            aria-label={`${opinion.symbol} decision contribution chart`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={contributionBars}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.24} horizontal={false} />
                <XAxis type="number" domain={[-maxContribution, maxContribution]} fontSize={11} />
                <YAxis type="category" dataKey="code" width={138} fontSize={11} />
                <Tooltip />
                <ReferenceLine x={0} stroke="var(--border)" />
                <Bar dataKey="contribution" radius={4} isAnimationActive={false}>
                  {contributionBars.map((row) => (
                    <Cell
                      key={row.code}
                      fill={row.contribution >= 0 ? "var(--bull)" : "var(--bear)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {locale === "vi"
              ? "Chưa có dữ liệu đạt chuẩn để tính đóng góp."
              : "No qualified contribution data."}
          </p>
        )}
      </section>

      <section className="min-w-0 rounded-xl border bg-background p-4">
        <h4 className="font-semibold">{locale === "vi" ? "Điểm hiện tại" : "Current scores"}</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {locale === "vi" ? "So sánh các trụ cột định lượng." : "Quant pillar comparison."}
        </p>
        {pillarBars.length ? (
          <div
            className="mt-4 h-64 min-w-0"
            role="img"
            aria-label={`${opinion.symbol} current pillar scores`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={pillarBars}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.24} horizontal={false} />
                <XAxis type="number" domain={[-100, 100]} fontSize={11} />
                <YAxis type="category" dataKey="code" width={76} fontSize={11} />
                <Tooltip />
                <Bar
                  dataKey="score"
                  fill="var(--chart-1)"
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function AssetOpinionScenarios({
  opinion,
  locale,
}: {
  opinion: AssetOpinionModel;
  locale: Locale;
}) {
  return (
    <div className="flex flex-col gap-4">
      {opinion.explanationStatus === "accepted" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Scenario
            kind="bull"
            title={locale === "vi" ? "Kịch bản tích cực" : "Bull case"}
            body={opinion.bullCase}
          />
          <Scenario
            kind="base"
            title={locale === "vi" ? "Kịch bản cơ sở" : "Base case"}
            body={opinion.baseCase}
          />
          <Scenario
            kind="bear"
            title={locale === "vi" ? "Kịch bản tiêu cực" : "Bear case"}
            body={opinion.bearCase}
          />
        </div>
      ) : null}

      {opinion.invalidationConditions.length || opinion.quantInvalidationConditions.length ? (
        <section className="rounded-xl border border-bear/20 bg-bear/5 p-4">
          <div className="flex items-center gap-2 font-semibold text-bear">
            <ShieldAlert aria-hidden="true" />
            {locale === "vi" ? "Điều kiện đổi quan điểm" : "Conditions that change the view"}
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {[
              ...opinion.invalidationConditions,
              ...opinion.quantInvalidationConditions.map(
                (condition) => INVALIDATION_LABELS[condition]?.[locale] ?? condition,
              ),
            ].map((condition) => (
              <li key={condition} className="flex gap-2">
                <AlertTriangle className="mt-0.5 shrink-0 text-bear" aria-hidden="true" />
                {condition}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function AssetOpinionDetailContent({
  opinion,
  portfolioState,
  locale,
  onEvidence,
}: {
  opinion: AssetOpinionModel;
  portfolioState: "available" | "missing";
  locale: Locale;
  onEvidence: (id: string) => void;
}) {
  const quantOnly = opinion.explanationStatus === "quant_only";
  const insufficient =
    opinion.explanationStatus === "insufficient_data" ||
    opinion.explanationStatus === "unavailable";
  const technicalLimitation = technicalQuantLimitation(opinion, locale);

  return (
    <div className="min-w-0 bg-muted/5">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 pr-14 backdrop-blur sm:px-6 sm:pr-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {opinion.symbol} · {opinion.assetName}
              </h2>
              <Badge variant="outline">{opinion.stance.replaceAll("_", " ")}</Badge>
              <Badge variant={opinion.explanationStatus === "accepted" ? "default" : "secondary"}>
                {analysisStatus(opinion, locale)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {locale === "vi"
                ? `Khung ${opinion.horizon} · Độ phủ ${formatPercent(Number(opinion.dataCoverage) * 100)} · Tin cậy ${formatPercent(opinion.confidence)}`
                : `Horizon ${opinion.horizon} · Coverage ${formatPercent(Number(opinion.dataCoverage) * 100)} · Confidence ${formatPercent(opinion.confidence)}`}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatScore(opinion.quantScore)}
            </p>
            <p className="text-xs text-muted-foreground">Quant score</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(88px,auto))] sm:items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? "Hành động đề xuất" : "Suggested action"}
            </p>
            <p className="mt-1 text-base font-semibold">
              {actionLabel(opinion.personalizedAction, locale)}
            </p>
          </div>
          {portfolioState === "available" ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">
                  {locale === "vi" ? "Tỷ trọng hiện tại" : "Current weight"}
                </p>
                <p className="mt-1 font-mono font-semibold tabular-nums">
                  {formatPercent(opinion.portfolioWeightPct)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {locale === "vi" ? "Lãi/lỗ" : "Unrealized"}
                </p>
                <p className="mt-1 font-mono font-semibold tabular-nums">
                  {formatPercent(opinion.unrealizedReturn, { multiplier: 100 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {locale === "vi" ? "Khẩu vị rủi ro" : "Risk tolerance"}
                </p>
                <p className="mt-1 font-semibold capitalize">{opinion.riskTolerance}</p>
              </div>
            </>
          ) : (
            <div className="sm:col-span-3">
              <p className="text-sm text-muted-foreground">
                {locale === "vi"
                  ? "Chưa có danh mục để tính mức phơi nhiễm; hành động này chỉ dùng làm điểm cần theo dõi."
                  : "No portfolio is available to calculate exposure; treat this action as a review point only."}
              </p>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <dt className="text-xs text-muted-foreground">
                    {locale === "vi" ? "Tỷ trọng hiện tại" : "Current weight"}
                  </dt>
                  <dd className="font-mono">—</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-xs text-muted-foreground">
                    {locale === "vi" ? "Khẩu vị rủi ro" : "Risk tolerance"}
                  </dt>
                  <dd className="font-semibold capitalize">{opinion.riskTolerance}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </header>

      <AssetOpinionSourcesDisclosure opinion={opinion} locale={locale} onEvidence={onEvidence} />

      <Tabs defaultValue="thesis" className="min-w-0 px-4 py-5 sm:px-6">
        <div className="overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            <TabsTrigger value="thesis">{locale === "vi" ? "Luận điểm" : "Thesis"}</TabsTrigger>
            <TabsTrigger value="calculation">
              {locale === "vi" ? "Cách tính" : "Calculation"}
            </TabsTrigger>
            <TabsTrigger value="scenarios">
              {locale === "vi" ? "Kịch bản & điều kiện" : "Scenarios & conditions"}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="thesis" className="mt-4 flex flex-col gap-4">
          <section
            className="rounded-xl border bg-background p-4 sm:p-5"
            aria-labelledby="general-quant-opinion"
          >
            <div className="flex items-center gap-2 text-primary">
              <Sparkles aria-hidden="true" />
              <h3 id="general-quant-opinion" className="font-semibold text-foreground">
                {locale === "vi"
                  ? "Kết luận · Quan điểm định lượng chung"
                  : "Conclusion · General quant view"}
              </h3>
            </div>
            <div className="mt-3 text-sm leading-6 text-muted-foreground">
              {quantOnly ? (
                <p>
                  {technicalLimitation
                    ? locale === "vi"
                      ? "Quan điểm Quant kỹ thuật được tính từ xu hướng giá đã kiểm định."
                      : "The technical-quant view is calculated from validated price trends."
                    : locale === "vi"
                      ? "Chỉ có quan điểm định lượng; phần diễn giải AI chưa vượt qua kiểm tra bằng chứng."
                      : "Quant view only; the AI explanation did not pass evidence verification."}
                </p>
              ) : null}
              {insufficient ? (
                <div>
                  <p>
                    {locale === "vi"
                      ? "Chưa đủ bằng chứng để đưa ra quan điểm hoặc hành động."
                      : "Insufficient evidence for a stance or action."}
                  </p>
                  {opinion.failedGates.length ? (
                    <ul className="mt-2 grid gap-1">
                      {opinion.failedGates.slice(0, 3).map((gate) => (
                        <li key={gate}>• {failedGateLabel(gate, locale)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {!quantOnly && !insufficient ? <p>{opinion.thesis}</p> : null}
            </div>
          </section>

          {technicalLimitation ? (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{locale === "vi" ? "Giới hạn dữ liệu" : "Data limitation"}</AlertTitle>
              <AlertDescription>{technicalLimitation}</AlertDescription>
            </Alert>
          ) : null}

          <AssetOpinionHighlights opinion={opinion} locale={locale} onEvidence={onEvidence} />
        </TabsContent>

        <TabsContent value="calculation" className="mt-4 flex flex-col gap-4">
          <AssetOpinionFormula opinion={opinion} locale={locale} />
          <Charts opinion={opinion} locale={locale} />
        </TabsContent>

        <TabsContent value="scenarios" className="mt-4">
          <AssetOpinionScenarios opinion={opinion} locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
