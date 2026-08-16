"use client";

import {
  AlertTriangle,
  ArrowUpRight,
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

import { AssetOpinionCalculation } from "./AssetOpinionCalculation";
import {
  failedGateLabel,
  isTechnicalQuantOpinion,
  metricLabel,
  pillarLabel,
  technicalQuantLimitation,
} from "./asset-opinion-labels";
import { FreshnessBadge } from "./FreshnessBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";
import { formatMetricValue, formatPercent, formatScore } from "@/lib/financial-format";

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

function dateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
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
    <article className="flex min-h-36 flex-col gap-3 rounded-xl border bg-background/60 p-4">
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
      <section className="min-w-0 rounded-xl border bg-background/60 p-4">
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
      <section className="min-w-0 rounded-xl border bg-background/60 p-4">
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
  const inputByEvidenceId = new Map(
    opinion.decisionInputs
      .filter((input) => input.evidenceId)
      .map((input) => [input.evidenceId, input]),
  );
  const evidenceValue = (evidence: AssetOpinionModel["evidence"][number]) => {
    const input = inputByEvidenceId.get(evidence.id);
    return input
      ? formatMetricValue(input.rawValue, { locale, unit: input.unit })
      : evidence.displayValue;
  };
  return (
    <Card className="min-w-0 border-primary/20 shadow-none">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">
                {opinion.symbol} · {opinion.assetName}
              </CardTitle>
              <Badge variant="outline">{opinion.stance.replaceAll("_", " ")}</Badge>
              <Badge variant={opinion.explanationStatus === "accepted" ? "default" : "secondary"}>
                {analysisStatus(opinion, locale)}
              </Badge>
              <FreshnessBadge state={opinion.freshness} />
            </div>
            <CardDescription className="mt-2">
              {locale === "vi"
                ? `Horizon ${opinion.horizon} · Độ phủ ${formatPercent(Number(opinion.dataCoverage) * 100)}`
                : `Horizon ${opinion.horizon} · Coverage ${formatPercent(Number(opinion.dataCoverage) * 100)}`}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatScore(opinion.quantScore)}
            </p>
            <p className="text-xs text-muted-foreground">Quant score</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section
            className="rounded-xl border bg-background/60 p-4"
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
          <section
            className="rounded-xl border border-primary/20 bg-primary/5 p-4"
            aria-labelledby="portfolio-opinion"
          >
            <div className="flex items-center gap-2 text-primary">
              <ShieldAlert aria-hidden="true" />
              <h3 id="portfolio-opinion" className="font-semibold text-foreground">
                {locale === "vi" ? "Quan điểm theo danh mục" : "Portfolio-aware guidance"}
              </h3>
            </div>
            <p className="mt-3 font-semibold">{actionLabel(opinion.personalizedAction, locale)}</p>
            {portfolioState === "missing" ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {locale === "vi"
                  ? "Chưa có danh mục để tính mức phơi nhiễm; hành động này chỉ dùng làm điểm cần theo dõi."
                  : "No portfolio is available to calculate exposure; treat this action as a review point only."}
              </p>
            ) : null}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "vi" ? "Tỷ trọng hiện tại" : "Current weight"}
                </dt>
                <dd className="mt-1 font-mono tabular-nums">
                  {portfolioState === "available" ? formatPercent(opinion.portfolioWeightPct) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "vi" ? "Lãi/lỗ chưa thực hiện" : "Unrealized return"}
                </dt>
                <dd className="mt-1 font-mono tabular-nums">
                  {portfolioState === "available"
                    ? formatPercent(opinion.unrealizedReturn, { multiplier: 100 })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Horizon</dt>
                <dd className="mt-1">{opinion.horizon}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "vi" ? "Khẩu vị rủi ro" : "Risk tolerance"}
                </dt>
                <dd className="mt-1 capitalize">{opinion.riskTolerance}</dd>
              </div>
            </dl>
          </section>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        {technicalLimitation ? (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <p>{technicalLimitation}</p>
            </div>
          </section>
        ) : null}
        <AssetOpinionCalculation opinion={opinion} locale={locale} onEvidence={onEvidence} />
        <Charts opinion={opinion} locale={locale} />
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
              <ShieldAlert aria-hidden="true" />{" "}
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
        <Separator />
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h4 className="font-semibold">
                {locale === "vi" ? "Nguồn & độ mới" : "Sources & freshness"}
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "vi"
                  ? "Số liệu dùng trực tiếp để củng cố hoặc phản biện luận điểm."
                  : "Facts directly supporting or contradicting the thesis."}
              </p>
            </div>
            <Badge variant="secondary">{opinion.evidence.length} evidence</Badge>
          </div>
          {opinion.evidence.length ? (
            <>
              <div className="mt-4 hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>{locale === "vi" ? "Giá trị" : "Value"}</TableHead>
                      <TableHead>Impact</TableHead>
                      <TableHead>{locale === "vi" ? "Nguồn" : "Source"}</TableHead>
                      <TableHead>{locale === "vi" ? "Cập nhật" : "As of"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opinion.evidence.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.metricCode}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {evidenceValue(item)}
                          {item.delta ? ` · Δ ${item.delta}` : ""}
                          {item.percentile ? ` · Pctl ${item.percentile}` : ""}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.impact}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => onEvidence(item.id)}>
                            {item.sourceCode}
                            <ArrowUpRight data-icon="inline-end" />
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <time dateTime={item.effectiveAt}>
                              {dateLabel(item.effectiveAt, locale)}
                            </time>
                            <FreshnessBadge state={item.freshness} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 grid gap-3 md:hidden">
                {opinion.evidence.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border bg-background/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm">{item.metricCode}</strong>
                      <FreshnessBadge state={item.freshness} />
                    </div>
                    <p className="font-mono text-lg tabular-nums">{evidenceValue(item)}</p>
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{item.impact}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => onEvidence(item.id)}>
                        {item.sourceCode}
                        <ArrowUpRight data-icon="inline-end" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {locale === "vi"
                ? "Chưa có bằng chứng số đạt chuẩn hiển thị."
                : "No qualified numerical evidence is available."}
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

export function AssetOpinionDetail({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AssetOpinionDetailContent> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]"
        data-testid="asset-opinion-detail"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {props.opinion.symbol} · {props.opinion.assetName}
          </DialogTitle>
          <DialogDescription>
            {props.locale === "vi"
              ? "Phân tích định lượng theo tài sản"
              : "Quantitative asset analysis"}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[calc(100dvh-2rem)]">
          <AssetOpinionDetailContent {...props} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
