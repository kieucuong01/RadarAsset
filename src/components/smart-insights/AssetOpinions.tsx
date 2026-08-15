"use client";

import { useState } from "react";
import { BrainCircuit } from "lucide-react";

import { AssetOpinionDetail } from "./AssetOpinionDetail";
import { AssetOpinionList } from "./AssetOpinionList";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";

export function AssetOpinions({
  opinions,
  portfolioState,
  locale,
  onEvidence,
}: {
  opinions: AssetOpinionModel[];
  portfolioState: "available" | "missing";
  locale: "vi" | "en";
  onEvidence: (id: string) => void;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState(opinions[0]?.symbol ?? "");
  const selected = opinions.find((opinion) => opinion.symbol === selectedSymbol) ?? opinions[0];

  if (!selected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {locale === "vi" ? "Quan điểm AI theo tài sản" : "AI asset opinions"}
          </CardTitle>
          <CardDescription>
            {locale === "vi"
              ? "Phân tích danh mục, watchlist và BTC/XAU/VNINDEX dựa trên dữ liệu định lượng."
              : "Quant analysis for your portfolio, watchlist, and BTC/XAU/VNINDEX."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            {locale === "vi"
              ? "Chưa có quan điểm theo tài sản. Hệ thống sẽ hiển thị khi bản tin định lượng hoàn tất."
              : "No asset opinions yet. They will appear after the quantitative briefing completes."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby="asset-opinions-title">
      <Card className="min-w-0 overflow-hidden shadow-none">
        <CardHeader className="gap-3 border-b bg-muted/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <BrainCircuit aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="asset-opinions-title" className="font-semibold leading-none tracking-tight">
                  {locale === "vi" ? "Quan điểm AI theo tài sản" : "AI asset opinions"}
                </h2>
                <CardDescription className="mt-1">
                  {locale === "vi"
                    ? "Định lượng quyết định quan điểm; AI chỉ diễn giải các số liệu đã vượt qua kiểm tra bằng chứng."
                    : "Quant determines the stance; AI only explains evidence that passed verification."}
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary">
              {opinions.length} {locale === "vi" ? "tài sản" : "assets"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <AssetOpinionList
            opinions={opinions}
            selectedSymbol={selected.symbol}
            locale={locale}
            onSelect={setSelectedSymbol}
          />
        </CardContent>
      </Card>
      <AssetOpinionDetail
        opinion={selected}
        portfolioState={portfolioState}
        locale={locale}
        onEvidence={onEvidence}
      />
    </section>
  );
}
