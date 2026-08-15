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
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { FreshnessBadge } from "./FreshnessBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type Locale = "vi" | "en";
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)"];
const ACTIONS: Record<string, { vi: string; en: string }> = {
  HOLD: { vi: "Giữ và theo dõi", en: "Hold and monitor" },
  REVIEW_INCREASE: { vi: "Xem xét tăng tỷ trọng", en: "Review increasing exposure" },
  REVIEW_REDUCE_RISK: { vi: "Xem xét giảm rủi ro", en: "Review reducing risk" },
  WAIT_CONFIRMATION: { vi: "Chờ dữ liệu xác nhận", en: "Wait for confirmation" },
  NO_ACTION_INSUFFICIENT_DATA: { vi: "Chưa hành động", en: "No action yet" },
};

function actionLabel(action: string, locale: Locale) {
  return ACTIONS[action]?.[locale] ?? action.replaceAll("_", " ");
}

function dateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function chartRows(opinion: AssetOpinionModel) {
  const rows = new Map<string, Record<string, string | number>>();
  for (const pillar of opinion.pillars) {
    for (const point of pillar.series) {
      const row = rows.get(point.ts) ?? { ts: point.ts };
      row[pillar.code] = point.value;
      rows.set(point.ts, row);
    }
  }
  return [...rows.values()].sort((left, right) => String(left.ts).localeCompare(String(right.ts)));
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
  const trendPillars = opinion.pillars.filter((pillar) => pillar.series.length >= 2);
  const rows = chartRows(opinion);
  const pillarBars = opinion.pillars.map((pillar) => ({
    code: pillar.code,
    score: Number(pillar.score ?? 0),
  }));
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <section className="min-w-0 rounded-xl border bg-background/60 p-4">
        <h4 className="font-semibold">{locale === "vi" ? "Xu hướng trụ cột" : "Pillar trends"}</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {locale === "vi"
            ? "Điểm chuẩn hóa theo thời gian; cao hơn là tích cực hơn."
            : "Normalized scores over time; higher is more constructive."}
        </p>
        {trendPillars.length ? (
          <div
            className="mt-4 h-64 min-w-0"
            role="img"
            aria-label={`${opinion.symbol} pillar trend chart`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(value) => dateLabel(String(value), locale)}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  fontSize={11}
                />
                <YAxis domain={[-100, 100]} width={44} fontSize={11} />
                <Tooltip labelFormatter={(value) => dateLabel(String(value), locale)} />
                {trendPillars.map((pillar, index) => (
                  <Line
                    key={pillar.code}
                    type="monotone"
                    dataKey={pillar.code}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {locale === "vi"
              ? "Chưa đủ ít nhất hai điểm để vẽ xu hướng."
              : "At least two points are required for a trend chart."}
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

export function AssetOpinionDetail({
  opinion,
  locale,
  onEvidence,
}: {
  opinion: AssetOpinionModel;
  locale: Locale;
  onEvidence: (id: string) => void;
}) {
  const quantOnly = opinion.explanationStatus === "quant_only";
  const insufficient =
    opinion.explanationStatus === "insufficient_data" ||
    opinion.explanationStatus === "unavailable";
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
              <FreshnessBadge state={opinion.freshness} />
            </div>
            <CardDescription className="mt-2">
              {locale === "vi"
                ? `Horizon ${opinion.horizon} · Độ phủ ${Math.round(Number(opinion.dataCoverage) * 100)}%`
                : `Horizon ${opinion.horizon} · Coverage ${Math.round(Number(opinion.dataCoverage) * 100)}%`}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {opinion.quantScore ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">Quant score</p>
          </div>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-semibold">{actionLabel(opinion.personalizedAction, locale)}</p>
              {quantOnly ? (
                <p className="text-sm text-muted-foreground">
                  {locale === "vi"
                    ? "Chỉ có quan điểm định lượng; phần diễn giải AI chưa vượt qua kiểm tra bằng chứng."
                    : "Quant view only; the AI explanation did not pass evidence verification."}
                </p>
              ) : null}
              {insufficient ? (
                <p className="text-sm text-muted-foreground">
                  {locale === "vi"
                    ? "Chưa đủ bằng chứng để đưa ra quan điểm hoặc hành động."
                    : "Insufficient evidence for a stance or action."}
                </p>
              ) : null}
              {!quantOnly && !insufficient ? (
                <p className="text-sm leading-6 text-muted-foreground">{opinion.thesis}</p>
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        <Charts opinion={opinion} locale={locale} />
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
        {opinion.invalidationConditions.length ? (
          <section className="rounded-xl border border-bear/20 bg-bear/5 p-4">
            <div className="flex items-center gap-2 font-semibold text-bear">
              <ShieldAlert aria-hidden="true" />{" "}
              {locale === "vi" ? "Điều kiện làm luận điểm mất hiệu lực" : "Invalidation conditions"}
            </div>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
              {opinion.invalidationConditions.map((condition) => (
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
                          {item.displayValue}
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
                    <p className="font-mono text-lg tabular-nums">{item.displayValue}</p>
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
