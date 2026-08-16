"use client";

import { useRef, useState } from "react";
import { BrainCircuit, LoaderCircle, RefreshCw } from "lucide-react";

import { AssetOpinionDetail } from "./AssetOpinionDetail";
import { AssetOpinionList } from "./AssetOpinionList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AssetOpinionModel, BriefingGenerationState } from "@/lib/smart-insights-client";

export function AssetOpinions({
  opinions,
  portfolioState,
  locale,
  onEvidence,
  generationState = opinions.length ? "ready" : "idle",
  onRefresh,
  refreshPending = false,
}: {
  opinions: AssetOpinionModel[];
  portfolioState: "available" | "missing";
  locale: "vi" | "en";
  onEvidence: (id: string) => void;
  generationState?: BriefingGenerationState;
  onRefresh?: () => void;
  refreshPending?: boolean;
}) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeOpinion = opinions.find((opinion) => opinion.symbol === activeSymbol) ?? null;

  if (!opinions.length) {
    const content =
      generationState === "generating"
        ? {
            title:
              locale === "vi" ? "Đang tổng hợp dữ liệu định lượng" : "Generating quant opinions",
            detail:
              locale === "vi"
                ? "Hệ thống đang kiểm tra dữ liệu danh mục, danh sách yêu thích và BTC/XAU/VNINDEX. Trang sẽ tự cập nhật khi hoàn tất."
                : "The system is checking portfolio, favorites, and BTC/XAU/VNINDEX data. This page will update automatically.",
          }
        : generationState === "failed"
          ? {
              title: locale === "vi" ? "Không thể tạo quan điểm" : "Opinion generation failed",
              detail:
                locale === "vi"
                  ? "Dữ liệu hiện có vẫn được giữ nguyên. Bạn có thể thử tạo lại bản phân tích."
                  : "Existing data remains unchanged. You can retry the analysis.",
            }
          : generationState === "ready"
            ? {
                title: locale === "vi" ? "Chưa đủ dữ liệu định lượng" : "Insufficient quant data",
                detail:
                  locale === "vi"
                    ? "Không có tài sản nào vượt qua ngưỡng bằng chứng để hệ thống đưa ra quan điểm."
                    : "No asset passed the evidence threshold for an opinion.",
              }
            : {
                title:
                  locale === "vi"
                    ? "Chưa tạo quan điểm theo tài sản"
                    : "No asset opinions generated",
                detail:
                  locale === "vi"
                    ? "Tạo phân tích cho danh mục, danh sách yêu thích và các tài sản đại diện BTC/XAU/VNINDEX."
                    : "Analyze the portfolio, favorites, and representative BTC/XAU/VNINDEX assets.",
              };
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {locale === "vi" ? "Quan điểm AI theo tài sản" : "AI asset opinions"}
          </CardTitle>
          <CardDescription>
            {locale === "vi"
              ? "Phân tích danh mục, danh sách yêu thích và BTC/XAU/VNINDEX dựa trên dữ liệu định lượng."
              : "Quant analysis for your portfolio, watchlist, and BTC/XAU/VNINDEX."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed p-5">
            <div className="flex items-start gap-3">
              {generationState === "generating" ? (
                <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
              ) : (
                <BrainCircuit className="mt-0.5 size-5 shrink-0 text-primary" />
              )}
              <div>
                <p className="text-sm font-medium">{content.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{content.detail}</p>
              </div>
            </div>
            {generationState !== "generating" && onRefresh ? (
              <Button
                size="sm"
                variant={generationState === "failed" ? "outline" : "default"}
                onClick={onRefresh}
                disabled={refreshPending}
              >
                <RefreshCw className={refreshPending ? "animate-spin" : undefined} />
                {generationState === "failed"
                  ? locale === "vi"
                    ? "Thử lại"
                    : "Retry"
                  : locale === "vi"
                    ? "Tạo quan điểm AI"
                    : "Generate AI opinions"}
              </Button>
            ) : null}
          </div>
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
            locale={locale}
            onSelect={(symbol, trigger) => {
              returnFocusRef.current = trigger;
              setActiveSymbol(symbol);
            }}
          />
        </CardContent>
      </Card>
      {activeOpinion ? (
        <AssetOpinionDetail
          opinion={activeOpinion}
          open
          onOpenChange={(open) => {
            if (!open) {
              const returnFocusTo = returnFocusRef.current;
              setActiveSymbol(null);
              requestAnimationFrame(() => returnFocusTo?.focus());
            }
          }}
          portfolioState={portfolioState}
          locale={locale}
          onEvidence={onEvidence}
        />
      ) : null}
    </section>
  );
}
