import { CircleAlert, WalletCards } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingModel, PreferencesModel } from "@/lib/smart-insights-client";

export function PortfolioImpact({
  briefing,
  preferences,
}: {
  briefing: BriefingModel | null;
  preferences: PreferencesModel | null;
}) {
  if (!briefing || briefing.portfolioState === "missing") {
    return (
      <Alert>
        <CircleAlert />
        <AlertTitle>Portfolio exposure is not available</AlertTitle>
        <AlertDescription>
          Ranking currently uses your market interests
          {preferences?.preference.assets.length
            ? ` and ${preferences.preference.assets.join(", ")}`
            : ""}
          . Add positions to quantify exposure impact.
        </AlertDescription>
      </Alert>
    );
  }
  const items = [...briefing.primary, ...briefing.riskAlerts];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <WalletCards className="size-5 text-primary" />
          <CardTitle>Portfolio Impact</CardTitle>
        </div>
        <CardDescription>
          Relevance is exposure-aware and never changes the underlying signal.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border p-3">
            <div className="flex justify-between gap-2 text-sm font-medium">
              <span>{item.affectedAssets.join(", ") || item.market}</span>
              <span>{item.relevanceScore}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Exposure {item.relevanceComponents.exposure} · magnitude{" "}
              {item.relevanceComponents.magnitude}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
