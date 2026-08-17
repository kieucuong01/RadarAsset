"use client";

import { Beaker, ShieldCheck } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent, formatPrice, formatRatio } from "@/lib/financial-format";
import type { KronosShadowModel } from "@/lib/smart-insights-client";

type LoadState = "idle" | "loading" | "loaded" | "failed";

function currency(value: number, locale: "vi" | "en") {
  return formatPrice(value, { locale, currency: "USD" });
}

function date(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(value));
}

function FanChart({ data, locale }: { data: KronosShadowModel; locale: "vi" | "en" }) {
  const rows = data.forecasts.map((point) => ({
    label: `${point.days}D`,
    median: point.median,
    range: [point.lower, point.upper],
  }));
  return (
    <div
      className="h-72 min-w-0"
      role="img"
      aria-label={
        locale === "vi"
          ? "Biểu đồ trung vị và khoảng phân vị 10 đến 90 phần trăm của dự báo BTC"
          : "BTC forecast median and 10th-to-90th percentile interval"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 16, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            width={72}
            tickFormatter={(value) => currency(Number(value), locale)}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === "range" && Array.isArray(value)) {
                return [
                  `${currency(Number(value[0]), locale)} – ${currency(Number(value[1]), locale)}`,
                  "P10–P90",
                ];
              }
              return [currency(Number(value), locale), locale === "vi" ? "Trung vị" : "Median"];
            }}
          />
          <Area
            type="monotone"
            dataKey="range"
            name="range"
            stroke="var(--chart-2)"
            fill="var(--chart-2)"
            fillOpacity={0.16}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="median"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--chart-1)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ErrorChart({ data, locale }: { data: KronosShadowModel; locale: "vi" | "en" }) {
  const rows = data.rollingErrors
    .filter((point) => point.model === "kronos-small" && point.horizon === 7)
    .slice(-60)
    .map((point) => ({ ts: point.ts, error: point.absoluteError }));
  if (rows.length < 2) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {locale === "vi"
          ? "Chưa đủ chuỗi sai số 7D để vẽ xu hướng."
          : "Not enough 7D errors for a trend yet."}
      </p>
    );
  }
  return (
    <div
      className="h-56 min-w-0"
      role="img"
      aria-label={
        locale === "vi"
          ? "Sai số tuyệt đối rolling của Kronos 7 ngày"
          : "Kronos rolling 7-day absolute error"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
          <XAxis
            dataKey="ts"
            tickFormatter={(value) => date(String(value), locale)}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            fontSize={11}
          />
          <YAxis
            width={72}
            tickFormatter={(value) => currency(Number(value), locale)}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <Tooltip
            labelFormatter={(value) => date(String(value), locale)}
            formatter={(value) => [currency(Number(value), locale), "MAE 7D"]}
          />
          <Line
            type="monotone"
            dataKey="error"
            stroke="var(--chart-4)"
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KronosShadowPanel({
  data,
  state,
  locale,
}: {
  data: KronosShadowModel | null;
  state: LoadState;
  locale: "vi" | "en";
}) {
  const disclaimer =
    locale === "vi" ? "SHADOW / KHÔNG DÙNG CHO QUYẾT ĐỊNH" : "SHADOW / NOT USED IN DECISIONS";
  if (state === "loading" || state === "idle") {
    return (
      <section className="rounded-2xl border border-border bg-card p-5" aria-busy="true">
        <div className="h-5 w-56 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-72 animate-pulse rounded-xl bg-muted/70" />
      </section>
    );
  }
  if (state === "failed") {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <DataStatusBadge status="UNAVAILABLE" />
        <p className="mt-3 text-sm text-muted-foreground">
          {locale === "vi"
            ? "Không thể tải đánh giá shadow. Hãy thử lại sau."
            : "Unable to load the shadow evaluation. Try again later."}
        </p>
      </section>
    );
  }
  if (!data || data.state === "UNAVAILABLE") {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge
            variant="outline"
            className="border-chart-4/40 bg-chart-4/10 font-mono text-[10px] text-chart-4"
          >
            {disclaimer}
          </Badge>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {locale === "vi"
            ? "Chưa có đánh giá shadow đã xác minh; hệ thống không tạo dữ liệu thay thế."
            : "No verified shadow evaluation is available; no substitute data is generated."}
        </p>
      </section>
    );
  }
  if (data.state === "FAILED") {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <Badge
          variant="outline"
          className="border-destructive/40 bg-destructive/10 font-mono text-[10px] text-destructive"
        >
          {disclaimer}
        </Badge>
        <p className="mt-4 text-sm text-muted-foreground">
          {locale === "vi"
            ? "Lần chạy Kronos gần nhất thất bại; không có dự báo được công bố."
            : "The latest Kronos run failed; no forecast was published."}
        </p>
      </section>
    );
  }

  const kronos = data.metrics.find((metric) => metric.model === "kronos-small");
  return (
    <section className="min-w-0 space-y-6">
      <div className="rounded-2xl border border-chart-4/30 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Beaker className="size-4 text-chart-4" aria-hidden="true" />
              <h3 className="font-semibold">
                {locale === "vi" ? "Dự báo BTC bằng Kronos" : "Kronos BTC Forecast"}
              </h3>
              <Badge
                variant="outline"
                className="border-chart-4/40 bg-chart-4/10 font-mono text-[10px] text-chart-4"
              >
                {disclaimer}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
              {locale === "vi"
                ? "Mô hình đang được chấm điểm ngoài mẫu so với các baseline. Kết quả này chỉ đo chất lượng dự báo, không tác động Market Pulse, cảnh báo hay danh mục."
                : "The model is evaluated out of sample against simple baselines. It measures forecast quality only and cannot affect Market Pulse, alerts, or portfolios."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden="true" />
            <span>{data.methodology}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              locale === "vi" ? "Trạng thái" : "State",
              locale === "vi"
                ? ((
                    {
                      READY: "Sẵn sàng",
                      READY_SHADOW: "Sẵn sàng (shadow)",
                      ACCUMULATING: "Đang tích lũy",
                      FAILED: "Thất bại",
                      UNAVAILABLE: "Chưa có",
                    } as Record<string, string>
                  )[data.state] ?? data.state)
                : data.state,
            ],
            [
              locale === "vi" ? "Tiến độ OOS" : "OOS progress",
              `${data.completedOos} / ${data.minimumOos}`,
            ],
            [
              locale === "vi" ? "MASE của Kronos" : "Kronos MASE",
              kronos ? formatRatio(kronos.mase) : "—",
            ],
            [
              locale === "vi" ? "Đúng hướng" : "Direction accuracy",
              kronos ? formatPercent(kronos.directionalAccuracy, { multiplier: 100 }) : "—",
            ],
          ].map(([label, value]) => (
            <article key={label} className="rounded-xl border bg-background/50 p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 font-mono text-lg font-semibold tabular-nums">{value}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold">
            {locale === "vi" ? "Khoảng dự báo BTC" : "BTC forecast interval"}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {locale === "vi"
              ? "Đường: trung vị · Vùng: phân vị P10–P90 · Horizon: 1/3/7 ngày"
              : "Line: median · Band: P10–P90 · Horizons: 1/3/7 days"}
          </p>
          <FanChart data={data} locale={locale} />
        </section>
        <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold">{locale === "vi" ? "Sai số rolling" : "Rolling error"}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {locale === "vi"
              ? "Sai số tuyệt đối của dự báo 7D theo thời gian."
              : "Absolute 7D forecast error over time."}
          </p>
          <ErrorChart data={data} locale={locale} />
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h4 className="font-semibold">
          {locale === "vi" ? "So sánh benchmark" : "Benchmark comparison"}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {locale === "vi"
            ? "MASE dưới 1 nghĩa là tốt hơn random walk; cần đủ 180 cutoff trước khi đọc kết quả."
            : "MASE below 1 beats random walk; wait for 180 cutoffs before interpreting results."}
        </p>
        <Table className="mt-4 min-w-[620px]">
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "vi" ? "Mô hình" : "Model"}</TableHead>
              <TableHead>MAE</TableHead>
              <TableHead>MASE</TableHead>
              <TableHead>{locale === "vi" ? "Đúng hướng" : "Direction"}</TableHead>
              <TableHead>Spearman IC</TableHead>
              <TableHead>{locale === "vi" ? "Độ phủ 80%" : "Coverage 80%"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...data.metrics]
              .sort((left, right) => left.mase - right.mase)
              .map((metric) => (
                <TableRow key={metric.model}>
                  <TableCell className="font-medium">{metric.model}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {currency(metric.mae, locale)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {formatRatio(metric.mase)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {formatPercent(metric.directionalAccuracy, { multiplier: 100 })}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {formatRatio(metric.spearmanIc)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {metric.intervalCoverage == null
                      ? "—"
                      : formatPercent(metric.intervalCoverage, { multiplier: 100 })}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h4 className="font-semibold">{locale === "vi" ? "Lịch sử dự báo" : "Forecast history"}</h4>
        <div className="mt-4 space-y-2 sm:hidden">
          {data.history
            .slice(-12)
            .reverse()
            .map((row) => (
              <article
                key={`${row.generatedAt}-${row.days}`}
                className="rounded-xl border bg-background/50 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <strong>
                    {row.days}D · {date(row.forecastFor, locale)}
                  </strong>
                  <span className="font-mono tabular-nums">
                    {currency(Math.abs(row.predicted - row.realized), locale)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {currency(row.predicted, locale)} → {currency(row.realized, locale)}
                </p>
              </article>
            ))}
        </div>
        <div className="hidden sm:block">
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>{locale === "vi" ? "Ngày đích" : "Target date"}</TableHead>
                <TableHead>{locale === "vi" ? "Khoảng dự báo" : "Horizon"}</TableHead>
                <TableHead>{locale === "vi" ? "Dự báo" : "Forecast"}</TableHead>
                <TableHead>{locale === "vi" ? "Thực tế" : "Realized"}</TableHead>
                <TableHead>{locale === "vi" ? "Sai số" : "Error"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history
                .slice(-12)
                .reverse()
                .map((row) => (
                  <TableRow key={`${row.generatedAt}-${row.days}`}>
                    <TableCell>{date(row.forecastFor, locale)}</TableCell>
                    <TableCell>{row.days}D</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {currency(row.predicted, locale)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {currency(row.realized, locale)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {currency(Math.abs(row.predicted - row.realized), locale)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </section>
  );
}
