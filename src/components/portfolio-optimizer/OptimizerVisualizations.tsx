import {
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  OptimizerAllocationSlice,
  OptimizerCorrelationRow,
  OptimizerRiskReturnPoint,
} from "@/lib/backtest/optimizer-dashboard";
import { formatCount, formatPercent, formatRatio } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

const chartTooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function pct(value: number) {
  return formatPercent(value);
}

export function AllocationPie({ slices }: { slices: OptimizerAllocationSlice[] }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("optimizer.allocationTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("optimizer.allocationDescription")}
          </p>
        </div>
        <Badge variant="secondary">
          {formatCount(slices.length)} {t("common.assets")}
        </Badge>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
        <div className="h-64 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="weightPct"
                nameKey="symbol"
                innerRadius={58}
                outerRadius={96}
                paddingAngle={3}
                stroke="var(--card)"
                strokeWidth={3}
              >
                {slices.map((slice) => (
                  <Cell key={slice.symbol} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value: number) => [pct(Number(value)), t("common.allocation")]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-3">
          {slices.map((slice) => (
            <li key={slice.symbol} className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: slice.color }}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{slice.symbol}</span>
              </span>
              <span className="font-semibold tabular-nums">{pct(slice.weightPct)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RiskReturnTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: OptimizerRiskReturnPoint }>;
}) {
  const { t } = useI18n();
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border bg-card p-3 text-xs shadow-lg">
      <p className="font-semibold">{point.symbol}</p>
      <p className="mt-1 text-muted-foreground">
        {t("optimizer.expectedReturn")}: {pct(point.expectedReturnPct)}
      </p>
      <p className="text-muted-foreground">
        {t("optimizer.volatility")}: {pct(point.volatilityPct)}
      </p>
      <p className="text-muted-foreground">
        {t("common.allocation")}: {pct(point.weightPct)}
      </p>
      <p className="mt-1 max-w-56 truncate text-muted-foreground">
        {t("optimizer.dataset")} {point.datasetVersionId}
      </p>
    </div>
  );
}

export function RiskReturnChart({ points }: { points: OptimizerRiskReturnPoint[] }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">{t("optimizer.riskReturnTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("optimizer.riskReturnDescription")}</p>
      </div>
      <div className="mt-4 h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 24, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="volatilityPct"
              name={t("optimizer.volatility")}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(value) => formatPercent(Number(value))}
            />
            <YAxis
              type="number"
              dataKey="expectedReturnPct"
              name={t("optimizer.expectedReturn")}
              tickLine={false}
              axisLine={false}
              width={48}
              fontSize={11}
              tickFormatter={(value) => formatPercent(Number(value))}
            />
            <ZAxis dataKey="weightPct" range={[80, 280]} />
            <Tooltip
              content={<RiskReturnTooltip />}
              cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
            />
            <Scatter name={t("common.assets")} data={points} fill="var(--primary)">
              <LabelList
                dataKey="symbol"
                position="top"
                className="fill-muted-foreground text-xs"
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function correlationBackground(value: number) {
  const opacity = Math.min(0.55, 0.1 + Math.abs(value) * 0.38);
  return value < 0 ? `hsl(0 72% 51% / ${opacity})` : `hsl(142 65% 42% / ${opacity})`;
}

export function CorrelationMatrix({
  symbols,
  rows,
}: {
  symbols: string[];
  rows: OptimizerCorrelationRow[];
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">{t("optimizer.correlationTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("optimizer.correlationDescription")}
        </p>
      </div>
      <div className="mt-4">
        <Table className="min-w-[560px]" aria-label={t("optimizer.correlationTitle")}>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card">{t("optimizer.symbol")}</TableHead>
              {symbols.map((symbol) => (
                <TableHead key={symbol} className="text-center">
                  {symbol}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.symbol}>
                <TableCell className="sticky left-0 bg-card font-semibold">{row.symbol}</TableCell>
                {row.values.map((cell) => (
                  <TableCell key={cell.symbol} className="text-center">
                    <span
                      className="inline-flex min-w-14 justify-center rounded-md px-2 py-1 font-mono text-xs tabular-nums"
                      style={{ backgroundColor: correlationBackground(cell.value) }}
                    >
                      {formatRatio(cell.value)}
                    </span>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function AllocationBreakdown({ slices }: { slices: OptimizerAllocationSlice[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">{t("optimizer.allocationDetails")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("optimizer.allocationDetailsDescription")}
        </p>
      </div>
      {slices.map((slice) => (
        <div key={slice.symbol} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
              <span
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              {slice.symbol}
            </span>
            <Badge variant="secondary">{pct(slice.weightPct)}</Badge>
          </div>
          <Progress value={slice.weightPct} />
          <p className="truncate text-xs text-muted-foreground">
            {t("optimizer.dataset")} {slice.datasetVersionId}
          </p>
        </div>
      ))}
    </div>
  );
}
