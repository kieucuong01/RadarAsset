import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const EMPTY_MESSAGE = "Run a portfolio backtest to populate real performance and completed trades.";

const sections = ["Active Portfolio", "Equity Curve & Drawdown", "Trade List"];

export function BacktestResultsEmpty() {
  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label="Backtest results">
      {sections.map((title) => (
        <Card key={title} className="min-w-0 max-w-full">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{EMPTY_MESSAGE}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Run a portfolio backtest to continue.</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
