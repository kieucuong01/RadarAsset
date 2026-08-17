import { CircleAlert, WalletCards } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingModel, PreferencesModel } from "@/lib/smart-insights-client";
import { useI18n } from "@/lib/i18n/context";

export function PortfolioImpact({
  briefing,
  preferences,
}: {
  briefing: BriefingModel | null;
  preferences: PreferencesModel | null;
}) {
  const { locale } = useI18n();
  if (!briefing || briefing.portfolioState === "missing") {
    return (
      <Alert>
        <CircleAlert />
        <AlertTitle>
          {locale === "vi"
            ? "Chưa có dữ liệu phân bổ danh mục"
            : "Portfolio exposure is not available"}
        </AlertTitle>
        <AlertDescription>
          {locale === "vi"
            ? "Xếp hạng hiện dùng các thị trường bạn quan tâm"
            : "Ranking currently uses your market interests"}
          {preferences?.preference.assets.length
            ? locale === "vi"
              ? ` và ${preferences.preference.assets.join(", ")}`
              : ` and ${preferences.preference.assets.join(", ")}`
            : ""}
          {locale === "vi"
            ? ". Thêm vị thế để định lượng tác động phân bổ."
            : ". Add positions to quantify exposure impact."}
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
          <CardTitle>{locale === "vi" ? "Tác động lên danh mục" : "Portfolio Impact"}</CardTitle>
        </div>
        <CardDescription>
          {locale === "vi"
            ? "Mức độ liên quan có xét phân bổ và không thay đổi tín hiệu gốc."
            : "Relevance is exposure-aware and never changes the underlying signal."}
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
              {locale === "vi" ? "Phơi nhiễm" : "Exposure"} {item.relevanceComponents.exposure} ·{" "}
              {locale === "vi" ? "mức ảnh hưởng" : "magnitude"} {item.relevanceComponents.magnitude}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
