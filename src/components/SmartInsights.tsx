"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AssetIntelligenceResponse,
  MarketTickerResponse,
  ResearchRunResponse,
  WatchlistItemResponse,
} from "@/lib/backend/types";
import {
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Brain,
  ShieldAlert,
  Target,
  CheckCircle2,
  Calendar,
  Star,
  Bell,
  Plus,
  Search,
  Filter,
  Clock,
  AlertCircle,
  Activity,
} from "lucide-react";
import { DataStatusBadge } from "@/components/DataStatusBadge";
import { WatchlistAddDialog } from "@/components/WatchlistAddDialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { isFeatureAvailable, type DataStatus } from "@/lib/mvp-ui";

type TrendTicker = { sym: string; price: string; chg: number };

const tickers: TrendTicker[] = [
  { sym: "BTC", price: "67,420", chg: 2.5 },
  { sym: "ETH", price: "3,512", chg: 1.8 },
  { sym: "SPY", price: "528.10", chg: -0.4 },
  { sym: "QQQ", price: "452.30", chg: -0.6 },
  { sym: "VN30", price: "1,328", chg: 1.2 },
  { sym: "GOLD", price: "2,402", chg: 0.7 },
  { sym: "DXY", price: "104.21", chg: -0.2 },
  { sym: "WTI", price: "78.45", chg: 1.1 },
];

const INTELLIGENCE_SYMBOLS = ["BTC", "ETH", "SPY", "QQQ", "NVDA", "TSLA", "GOLD", "VN30"];

type NewsSentiment = "bull" | "bear" | "neutral";
type NewsSource = string;
type NewsAsset = string;

type News = {
  id: string;
  src: NewsSource;
  asset: NewsAsset;
  sentiment: NewsSentiment;
  title: string;
  summary: string;
  ago: string;
};

const NEWS: News[] = [
  {
    id: "n1",
    src: "CryptoQuant",
    asset: "BTC",
    sentiment: "bull",
    ago: "4m",
    title: "BTC Spot ETF inflows hit 3-week high as whales reload positions",
    summary:
      "Accumulation addresses gained 18,400 BTC — historically a precursor to upward continuation.",
  },
  {
    id: "n2",
    src: "SSI Research",
    asset: "VN30",
    sentiment: "bull",
    ago: "22m",
    title: "VN30 banking sector projected to lead Q3 earnings rebound",
    summary:
      "Credit growth recovery and stable NIM support double-digit profit growth for top lenders.",
  },
  {
    id: "n3",
    src: "Bloomberg",
    asset: "OIL",
    sentiment: "bear",
    ago: "38m",
    title: "Oil slides as OPEC+ signals gradual unwind of voluntary cuts",
    summary: "WTI tests $77 support; energy equities underperform as Q4 EPS estimates get trimmed.",
  },
  {
    id: "n4",
    src: "Goldman Sachs",
    asset: "SPY",
    sentiment: "neutral",
    ago: "1h",
    title: "Equities range-bound as earnings season delivers mixed signals",
    summary: "GS keeps year-end S&P target at 5,600 with balanced sector positioning.",
  },
  {
    id: "n5",
    src: "Glassnode",
    asset: "BTC",
    sentiment: "bull",
    ago: "1h",
    title: "Long-term holders supply hits all-time high — supply squeeze ahead?",
    summary: "76% of BTC supply has not moved in over a year. Diminishing sell-side liquidity.",
  },
  {
    id: "n6",
    src: "Reuters",
    asset: "Macro",
    sentiment: "bear",
    ago: "2h",
    title: "Hawkish FOMC minutes lift 10Y yields above 4.30%",
    summary:
      "Stickier core services inflation pushes the dot plot higher, raising real-yield risk.",
  },
  {
    id: "n7",
    src: "Bloomberg",
    asset: "GOLD",
    sentiment: "bull",
    ago: "3h",
    title: "Central banks add 38 tonnes of gold in May — accelerating diversification",
    summary: "PBoC and RBI lead inflows; gold breaks out of 6-week consolidation above $2,400.",
  },
  {
    id: "n8",
    src: "Reuters",
    asset: "ETH",
    sentiment: "neutral",
    ago: "4h",
    title: "Ethereum L2 fees collapse 60% after Dencun fee market normalization",
    summary:
      "User cost down sharply but validator revenue and burn rate weaken short-term narrative.",
  },
  {
    id: "n9",
    src: "Goldman Sachs",
    asset: "Macro",
    sentiment: "bull",
    ago: "5h",
    title: "Soft-landing odds nudged back to 70% on resilient labor data",
    summary:
      "Initial jobless claims undershoot; wage growth cools without breaking consumer spend.",
  },
];

const NEWS_VI_BY_ID: Record<string, Pick<News, "title" | "summary" | "ago">> = {
  n1: {
    ago: "4 phút",
    title: "Dòng tiền BTC Spot ETF đạt đỉnh 3 tuần khi whale gom lại vị thế",
    summary:
      "Địa chỉ tích lũy tăng thêm 18.400 BTC — lịch sử thường là tín hiệu trước nhịp tăng tiếp diễn.",
  },
  n2: {
    ago: "22 phút",
    title: "Ngành ngân hàng VN30 được kỳ vọng dẫn dắt phục hồi lợi nhuận Q3",
    summary:
      "Tín dụng phục hồi và NIM ổn định hỗ trợ tăng trưởng lợi nhuận hai chữ số ở nhóm ngân hàng lớn.",
  },
  n3: {
    ago: "38 phút",
    title: "Dầu giảm khi OPEC+ phát tín hiệu nới dần mức cắt giảm tự nguyện",
    summary:
      "WTI kiểm định hỗ trợ 77 USD; cổ phiếu năng lượng yếu hơn khi ước tính EPS Q4 bị điều chỉnh giảm.",
  },
  n4: {
    ago: "1 giờ",
    title: "Cổ phiếu đi ngang khi mùa kết quả kinh doanh cho tín hiệu trái chiều",
    summary: "GS giữ mục tiêu S&P cuối năm ở 5.600 với quan điểm phân bổ ngành cân bằng.",
  },
  n5: {
    ago: "1 giờ",
    title: "Nguồn cung holder dài hạn BTC lập đỉnh — khả năng siết cung phía trước?",
    summary: "76% nguồn cung BTC không dịch chuyển hơn một năm. Thanh khoản bán đang giảm dần.",
  },
  n6: {
    ago: "2 giờ",
    title: "Biên bản FOMC cứng rắn đẩy lợi suất 10Y vượt 4,30%",
    summary: "Lạm phát dịch vụ lõi dai dẳng kéo dot plot cao hơn, làm tăng rủi ro lợi suất thực.",
  },
  n7: {
    ago: "3 giờ",
    title: "Ngân hàng trung ương mua thêm 38 tấn vàng trong tháng 5",
    summary: "PBoC và RBI dẫn đầu dòng mua; vàng phá vùng tích lũy 6 tuần trên 2.400 USD.",
  },
  n8: {
    ago: "4 giờ",
    title: "Phí Ethereum L2 giảm 60% sau khi thị trường phí Dencun ổn định",
    summary:
      "Chi phí người dùng giảm mạnh, nhưng doanh thu validator và burn rate yếu đi trong ngắn hạn.",
  },
  n9: {
    ago: "5 giờ",
    title: "Xác suất soft landing tăng lại 70% nhờ dữ liệu lao động bền bỉ",
    summary:
      "Số đơn xin trợ cấp thất nghiệp thấp hơn kỳ vọng; tăng trưởng lương hạ nhiệt mà tiêu dùng chưa gãy.",
  },
};

type CalendarEvent = {
  time: string;
  date: string;
  country: "US" | "EU" | "VN" | "CN" | "JP";
  event: string;
  impact: "high" | "mid" | "low";
  forecast?: string;
  previous?: string;
};

const CALENDAR: CalendarEvent[] = [
  {
    time: "08:30",
    date: "Today",
    country: "US",
    event: "Core CPI m/m",
    impact: "high",
    forecast: "0.3%",
    previous: "0.3%",
  },
  {
    time: "10:00",
    date: "Today",
    country: "US",
    event: "Crude Oil Inventories",
    impact: "mid",
    forecast: "-1.2M",
    previous: "0.8M",
  },
  {
    time: "14:00",
    date: "Today",
    country: "US",
    event: "FOMC Meeting Minutes",
    impact: "high",
    forecast: "—",
    previous: "—",
  },
  {
    time: "07:45",
    date: "Tomorrow",
    country: "EU",
    event: "ECB Rate Decision",
    impact: "high",
    forecast: "4.25%",
    previous: "4.25%",
  },
  {
    time: "08:30",
    date: "Tomorrow",
    country: "US",
    event: "Initial Jobless Claims",
    impact: "mid",
    forecast: "230K",
    previous: "227K",
  },
  {
    time: "09:00",
    date: "Fri",
    country: "VN",
    event: "VN CPI y/y",
    impact: "high",
    forecast: "4.2%",
    previous: "4.4%",
  },
  {
    time: "08:30",
    date: "Fri",
    country: "US",
    event: "Non-Farm Payrolls",
    impact: "high",
    forecast: "185K",
    previous: "175K",
  },
  {
    time: "21:00",
    date: "Mon",
    country: "CN",
    event: "China Trade Balance",
    impact: "mid",
    forecast: "$76B",
    previous: "$72.4B",
  },
];

const CALENDAR_DATE_VI: Record<string, string> = {
  Today: "Hôm nay",
  Tomorrow: "Ngày mai",
  Fri: "Thứ Sáu",
  Mon: "Thứ Hai",
};

const CALENDAR_EVENT_VI: Record<string, string> = {
  "Core CPI m/m": "CPI lõi m/m",
  "Crude Oil Inventories": "Tồn kho dầu thô",
  "FOMC Meeting Minutes": "Biên bản họp FOMC",
  "ECB Rate Decision": "Quyết định lãi suất ECB",
  "Initial Jobless Claims": "Đơn xin trợ cấp thất nghiệp lần đầu",
  "VN CPI y/y": "CPI Việt Nam y/y",
  "Non-Farm Payrolls": "Bảng lương phi nông nghiệp",
  "China Trade Balance": "Cán cân thương mại Trung Quốc",
};

const WATCHLIST: WatchlistItemResponse[] = [
  {
    id: "sample-btc",
    sym: "BTC",
    name: "Bitcoin",
    price: 67420,
    chg: 2.5,
    alert: 70000,
    sentiment: "bull",
    datasetState: "ready",
    ingestionRequestId: null,
    backtestableTimeframes: ["1d", "1h"],
  },
  {
    id: "sample-eth",
    sym: "ETH",
    name: "Ethereum",
    price: 3512,
    chg: 1.8,
    alert: 3800,
    sentiment: "bull",
    datasetState: "unavailable",
    ingestionRequestId: null,
    backtestableTimeframes: [],
  },
  {
    id: "sample-nvda",
    sym: "NVDA",
    name: "NVIDIA",
    price: 1142.5,
    chg: 3.4,
    alert: 1200,
    sentiment: "bull",
    datasetState: "unavailable",
    ingestionRequestId: null,
    backtestableTimeframes: [],
  },
  {
    id: "sample-tsla",
    sym: "TSLA",
    name: "Tesla",
    price: 178.4,
    chg: -1.8,
    alert: 165,
    sentiment: "bear",
    datasetState: "unavailable",
    ingestionRequestId: null,
    backtestableTimeframes: [],
  },
  {
    id: "sample-gold",
    sym: "GOLD",
    name: "Gold Spot",
    price: 2402,
    chg: 0.7,
    alert: 2450,
    sentiment: "bull",
    datasetState: "unavailable",
    ingestionRequestId: null,
    backtestableTimeframes: [],
  },
  {
    id: "sample-vn30",
    sym: "VN30",
    name: "VN30 Index",
    price: 1328,
    chg: 1.2,
    alert: 1350,
    sentiment: "neutral",
    datasetState: "unavailable",
    ingestionRequestId: null,
    backtestableTimeframes: [],
  },
];

function SentimentBadge({ s }: { s: NewsSentiment }) {
  const { t } = useI18n();
  const map = {
    bull: {
      label: t("overview.news.bullish"),
      color: "text-bull bg-bull/10 border-bull/20",
      Icon: TrendingUp,
    },
    bear: {
      label: t("overview.news.bearish"),
      color: "text-bear bg-bear/10 border-bear/20",
      Icon: TrendingDown,
    },
    neutral: {
      label: t("overview.news.neutral"),
      color: "text-muted-foreground bg-muted border-border",
      Icon: Minus,
    },
  } as const;
  const { label, color, Icon } = map[s];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function FearGreedGauge({ value }: { value: number }) {
  const { t } = useI18n();
  const angle = (value / 100) * 180;
  const r = 70;
  const cx = 90;
  const cy = 90;
  const rad = ((180 - angle) * Math.PI) / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy - r * Math.sin(rad);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 110" className="w-44 h-28">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.66 0.22 18)" />
            <stop offset="50%" stopColor="oklch(0.7 0.16 70)" />
            <stop offset="100%" stopColor="oklch(0.72 0.17 155)" />
          </linearGradient>
        </defs>
        <path
          d={`M 20 90 A ${r} ${r} 0 0 1 160 90`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <line
          x1={cx}
          y1={cy}
          x2={x}
          y2={y}
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="6" fill="currentColor" />
      </svg>
      <div className="text-center -mt-2">
        <div className="text-3xl font-bold">{value}</div>
        <div className="text-xs font-medium text-bull">{t("overview.market.greed")}</div>
      </div>
    </div>
  );
}

export function SmartInsights() {
  const { locale, t } = useI18n();
  const [today, setToday] = useState("");
  const [marketTicks, setMarketTicks] = useState<TrendTicker[]>(tickers);
  const [marketStatus, setMarketStatus] = useState<DataStatus>("SAMPLE");
  const [marketError, setMarketError] = useState<string | null>(null);
  const [selectedIntelligenceSymbol, setSelectedIntelligenceSymbol] = useState("BTC");
  const [assetIntelligence, setAssetIntelligence] = useState<AssetIntelligenceResponse | null>(
    null,
  );
  const [intelligenceStatus, setIntelligenceStatus] = useState<DataStatus>("UNAVAILABLE");
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [researchRuns, setResearchRuns] = useState<ResearchRunResponse[]>([]);
  const [researchError, setResearchError] = useState<string | null>(null);
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
  }, [locale]);

  useEffect(() => {
    let alive = true;
    fetch("/api/market/ticker")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Ticker API unavailable"))))
      .then((rows: MarketTickerResponse[]) => {
        if (!alive) return;
        setMarketTicks(
          rows.slice(0, 8).map((row) => ({
            sym: row.symbol,
            price: row.price.toLocaleString("en-US", { maximumFractionDigits: 2 }),
            chg: row.changePercent,
          })),
        );
        setMarketStatus("SYSTEM");
        setMarketError(null);
      })
      .catch(() => {
        if (!alive) return;
        setMarketStatus("SAMPLE");
        setMarketError(
          locale === "vi"
            ? "Ticker API không khả dụng; đang hiển thị dữ liệu mẫu."
            : "Ticker API unavailable; showing sample data.",
        );
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/assets/${encodeURIComponent(selectedIntelligenceSymbol)}/intelligence`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error("Asset intelligence unavailable")),
      )
      .then((intelligence: AssetIntelligenceResponse) => {
        if (!alive) return;
        setAssetIntelligence(intelligence);
        setIntelligenceStatus("SYSTEM");
        setIntelligenceError(null);
      })
      .catch(() => {
        if (!alive) return;
        setAssetIntelligence(null);
        setIntelligenceStatus("UNAVAILABLE");
        setIntelligenceError(
          locale === "vi"
            ? "Không tải được Investor Intelligence cho tài sản đã chọn."
            : "Could not load Investor Intelligence for the selected asset.",
        );
      });
    return () => {
      alive = false;
    };
  }, [locale, selectedIntelligenceSymbol]);

  useEffect(() => {
    let alive = true;
    fetch("/api/research/runs")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Research runs unavailable"))))
      .then((runs: ResearchRunResponse[]) => {
        if (!alive) return;
        setResearchRuns(runs);
        setResearchError(null);
      })
      .catch(() => {
        if (!alive) return;
        setResearchError(
          locale === "vi"
            ? "Không tải được lịch sử research run."
            : "Could not load research run history.",
        );
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  return (
    <main className="mx-auto min-w-0 max-w-7xl space-y-10 px-4 py-8 sm:px-6">
      {/* Hero / Daily Briefing */}
      <section
        className="relative overflow-hidden rounded-3xl p-8 md:p-12 text-primary-foreground shadow-elegant"
        style={{ backgroundImage: "var(--gradient-hero)" }}
      >
        <div
          className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white, transparent 40%)" }}
        />
        <div className="relative grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-widest px-3 py-1 rounded-full bg-white/15 backdrop-blur">
                <Sparkles className="w-3.5 h-3.5" /> {t("overview.hero.badge")}
              </span>
              <DataStatusBadge status="SAMPLE" className="border-white/30 bg-white/10 text-white" />
              <span className="text-sm text-white/80">{today}</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight max-w-2xl">
              {t("overview.hero.title")}
            </h1>
            <ul className="space-y-2 text-white/90 max-w-2xl">
              <li className="flex gap-3">
                <span className="text-bull">▲</span> {t("overview.hero.crypto")}
              </li>
              <li className="flex gap-3">
                <span className="text-bear">▼</span> {t("overview.hero.macro")}
              </li>
              <li className="flex gap-3">
                <span className="text-bull">▲</span> {t("overview.hero.equities")}
              </li>
            </ul>
          </div>
          <button
            type="button"
            disabled={!isFeatureAvailable("listenBriefing")}
            aria-disabled={!isFeatureAvailable("listenBriefing")}
            title={t("common.unavailableMvp")}
            className="group flex items-center gap-4 rounded-2xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur transition-all disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="w-14 h-14 rounded-full bg-white text-primary grid place-items-center shadow-glow group-hover:scale-105 transition-transform">
              <Play className="w-6 h-6 fill-current ml-0.5" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold">{t("overview.hero.listen")}</span>
              <span className="block text-xs text-white/70">{t("common.unavailableMvp")}</span>
            </span>
          </button>
        </div>
      </section>

      {/* AI Digest */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Brain className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                {t("overview.digest.title")}
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 text-primary">
                  {t("overview.digest.badge")}
                </span>
                <DataStatusBadge status="SAMPLE" />
              </h2>
              <p className="text-xs text-muted-foreground">{t("overview.digest.sampleNote")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono uppercase tracking-wider text-muted-foreground">
              Confidence
            </span>
            <div className="w-28 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-gradient-primary" style={{ width: "78%" }} />
            </div>
            <span className="font-bold tabular-nums text-primary">78%</span>
          </div>
        </div>

        <div className="grid gap-0 divide-y divide-border lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
          <div className="min-w-0 space-y-5 p-6">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                {t("overview.digest.thesisTitle")}
              </div>
              <p className="text-base leading-relaxed">{t("overview.digest.thesis")}</p>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                {t("overview.digest.keyDrivers")}
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2.5">
                  <TrendingUp className="w-4 h-4 text-bull shrink-0 mt-0.5" />
                  {t("overview.digest.driver1")}
                </li>
                <li className="flex gap-2.5">
                  <TrendingDown className="w-4 h-4 text-bear shrink-0 mt-0.5" />
                  {t("overview.digest.driver2")}
                </li>
                <li className="flex gap-2.5">
                  <TrendingUp className="w-4 h-4 text-bull shrink-0 mt-0.5" />
                  {t("overview.digest.driver3")}
                </li>
                <li className="flex gap-2.5">
                  <Minus className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  {t("overview.digest.driver4")}
                </li>
              </ul>
            </div>
          </div>

          <div className="min-w-0 space-y-5 bg-muted/20 p-6">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                {t("overview.digest.stanceTitle")}
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-bull/10 text-bull border border-bull/20">
                  <TrendingUp className="w-3.5 h-3.5" /> {t("overview.digest.stance")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("overview.digest.conviction")}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Target className="w-3 h-3" /> {t("overview.digest.actions")}
              </div>
              <ul className="space-y-2 text-sm">
                {[
                  { c: "bull" as const, t: t("overview.digest.action1") },
                  { c: "bull" as const, t: t("overview.digest.action2") },
                  { c: "bear" as const, t: t("overview.digest.action3") },
                  { c: "bull" as const, t: t("overview.digest.action4") },
                ].map((a, i) => (
                  <li key={i} className="flex gap-2.5 items-start">
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 mt-0.5 ${a.c === "bull" ? "text-bull" : "text-bear"}`}
                    />
                    <span>{a.t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-bear/20 bg-bear/5 p-3 text-xs flex gap-2.5">
              <ShieldAlert className="w-4 h-4 text-bear shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-bear mb-0.5">
                  {t("overview.digest.riskWatch")}
                </div>
                <span className="text-muted-foreground">{t("overview.digest.riskWatchBody")}</span>
              </div>
            </div>
            <button
              type="button"
              disabled={!isFeatureAvailable("applyPortfolio")}
              aria-disabled={!isFeatureAvailable("applyPortfolio")}
              title={t("common.unavailableMvp")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-elegant disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {t("overview.digest.apply")} · {t("common.unavailableMvp")}
            </button>
          </div>
        </div>
      </section>

      <InvestorIntelligencePanel
        assetOptions={INTELLIGENCE_SYMBOLS}
        error={intelligenceError ?? researchError}
        intelligence={assetIntelligence}
        runs={researchRuns}
        selectedSymbol={selectedIntelligenceSymbol}
        status={intelligenceStatus}
        onSymbolChange={setSelectedIntelligenceSymbol}
      />

      {/* Market Pulse */}
      <section className="grid min-w-0 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-w-0 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t("overview.market.fearGreed")}</h2>
            <DataStatusBadge status="SAMPLE" />
          </div>
          <FearGreedGauge value={75} />
          <p className="text-xs text-muted-foreground text-center mt-3">
            {t("overview.market.fearGreedNote")}
          </p>

          {/* On-chain mini metrics */}
          <div className="mt-6 pt-5 border-t border-border space-y-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Activity className="w-3 h-3" /> {t("overview.market.onChainPulse")}
            </div>
            {[
              { l: "BTC Dominance", v: "56.4%", chg: 0.3 },
              { l: "ETH Gas (gwei)", v: "12", chg: -8.2 },
              { l: "LTH Supply", v: "76.2%", chg: 0.1 },
              { l: "Exchange Netflow", v: "-2.4K BTC", chg: -14.1 },
            ].map((m) => {
              const up = m.chg >= 0;
              return (
                <div key={m.l} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{m.l}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{m.v}</span>
                    <span className={`tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                      {up ? "+" : ""}
                      {m.chg}%
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t("overview.market.trendingAssets")}</h2>
            <DataStatusBadge status={marketStatus} detail={marketError ?? undefined} />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {marketTicks.map((t) => {
              const up = t.chg >= 0;
              return (
                <div
                  key={t.sym}
                  className="shrink-0 min-w-[140px] rounded-xl border border-border bg-background/50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{t.sym}</span>
                    <span className={`text-xs font-semibold ${up ? "text-bull" : "text-bear"}`}>
                      {up ? "+" : ""}
                      {t.chg}%
                    </span>
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{t.price}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Watchlist + Economic Calendar */}
      <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Watchlist />
        </div>
        <div className="min-w-0">
          <EconomicCalendar />
        </div>
      </section>

      {/* News Feed with filters */}
      <NewsFeed />
    </main>
  );
}

function InvestorIntelligencePanel({
  assetOptions,
  error,
  intelligence,
  onSymbolChange,
  runs,
  selectedSymbol,
  status,
}: {
  assetOptions: string[];
  error: string | null;
  intelligence: AssetIntelligenceResponse | null;
  onSymbolChange: (symbol: string) => void;
  runs: ResearchRunResponse[];
  selectedSymbol: string;
  status: DataStatus;
}) {
  const { t } = useI18n();
  const score = intelligence?.score ?? null;
  const stance = intelligence?.stance ?? "watch";
  const stanceTone =
    stance === "accumulate" || stance === "hold"
      ? "text-bull bg-bull/10 border-bull/20"
      : stance === "trim" || stance === "avoid"
        ? "text-bear bg-bear/10 border-bear/20"
        : "text-muted-foreground bg-muted border-border";
  const forecast = intelligence?.forecasts[0];

  return (
    <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)]">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border bg-muted/30">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {t("overview.intelligence.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("overview.intelligence.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataStatusBadge status={status} detail={error ?? undefined} />
            <select
              value={selectedSymbol}
              onChange={(event) => onSymbolChange(event.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold outline-none"
            >
              {Array.from(new Set(["BTC", ...assetOptions])).map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
            {score !== null ? (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${stanceTone}`}
              >
                {stance.toUpperCase()} / {score}
              </span>
            ) : null}
          </div>
        </div>

        {error ? (
          <div
            role="status"
            className="border-b border-bear/20 bg-bear/5 px-6 py-3 text-sm text-bear"
          >
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-5">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                {t("overview.intelligence.activeThesis")}
              </div>
              <p className="text-sm leading-relaxed">
                {intelligence?.summary ?? t("overview.intelligence.emptySummary")}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <SignalList
                title={t("overview.intelligence.catalysts")}
                tone="bull"
                items={intelligence?.topCatalysts ?? [t("overview.intelligence.noCatalyst")]}
              />
              <SignalList
                title={t("overview.intelligence.risks")}
                tone="bear"
                items={intelligence?.topRisks ?? [t("overview.intelligence.noRisk")]}
              />
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                {t("overview.intelligence.evidenceTrail")}
              </div>
              <div className="space-y-3">
                {(intelligence?.evidence ?? []).slice(0, 3).map((item) => (
                  <div key={item.id} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium line-clamp-1">{item.title}</span>
                      <span className="text-[10px] font-mono uppercase text-muted-foreground">
                        {item.sourceType}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {item.excerpt}
                    </p>
                  </div>
                ))}
                {(!intelligence || intelligence.evidence.length === 0) && (
                  <p className="text-xs text-muted-foreground">
                    {t("overview.intelligence.noEvidence")}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-background/60 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {t("overview.intelligence.sentimentMix")}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {(["bull", "bear", "neutral"] as const).map((key) => (
                  <div key={key} className="rounded-lg bg-muted/50 p-2">
                    <div className="text-xl font-bold tabular-nums">
                      {intelligence?.sentimentBreakdown[key] ?? 0}
                    </div>
                    <div className="text-[10px] uppercase text-muted-foreground">{key}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/60 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {t("overview.intelligence.forecast")}
              </div>
              {forecast ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {forecast.horizon} {t("overview.intelligence.target")}
                    </span>
                    <span className="font-bold tabular-nums">
                      ${forecast.targetPrice.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("overview.intelligence.expectedReturn")}
                    </span>
                    <span
                      className={`font-bold tabular-nums ${
                        forecast.expectedReturnPct >= 0 ? "text-bull" : "text-bear"
                      }`}
                    >
                      {forecast.expectedReturnPct >= 0 ? "+" : ""}
                      {forecast.expectedReturnPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("common.confidence")}</span>
                    <span className="font-bold tabular-nums">{forecast.confidence}%</span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("overview.intelligence.noForecast")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            {t("overview.intelligence.researchRuns")}
          </h2>
        </div>
        <div className="divide-y divide-border max-h-[430px] overflow-y-auto">
          {runs.slice(0, 6).map((run) => (
            <div key={run.id} className="p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{run.source}</div>
                <span className="text-[10px] font-mono uppercase text-muted-foreground">
                  {run.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {run.kind}
                {run.symbol ? ` / ${run.symbol}` : ""}
              </div>
              {run.summary && <p className="mt-2 text-xs line-clamp-2">{run.summary}</p>}
            </div>
          ))}
          {runs.length === 0 && (
            <div className="p-5 text-xs text-muted-foreground">
              {t("overview.intelligence.noRuns")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SignalList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "bull" | "bear";
  items: string[];
}) {
  const Icon = tone === "bull" ? TrendingUp : ShieldAlert;
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <Icon
              className={`w-4 h-4 shrink-0 mt-0.5 ${tone === "bull" ? "text-bull" : "text-bear"}`}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Watchlist ---------------- */

function Watchlist() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<WatchlistItemResponse[]>(WATCHLIST);
  const [status, setStatus] = useState<DataStatus>("SAMPLE");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/watchlist")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Watchlist API unavailable"))))
      .then((rows: WatchlistItemResponse[]) => {
        if (!alive) return;
        setItems(rows);
        setStatus("SYSTEM");
        setLoadError(null);
      })
      .catch(() => {
        if (!alive) return;
        setStatus("SAMPLE");
        setLoadError(
          locale === "vi"
            ? "Watchlist API không khả dụng; đang hiển thị dữ liệu mẫu."
            : "Watchlist API unavailable; showing sample data.",
        );
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  return (
    <>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-2">
            <Star className="w-4 h-4 text-chart-4 fill-chart-4" />
            <h2 className="font-semibold">{t("overview.market.watchlist")}</h2>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {items.length}
            </span>
            <DataStatusBadge status={status} detail={loadError ?? undefined} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isFeatureAvailable("watchlistAdd")}
            onClick={() => setAddOpen(true)}
            className="h-11 sm:h-8"
          >
            <Plus data-icon="inline-start" /> {t("overview.market.addAsset")}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left font-medium px-5 py-2.5">
                  {t("overview.market.tableAsset")}
                </th>
                <th className="text-right font-medium px-3 py-2.5">
                  {t("overview.market.tablePrice")}
                </th>
                <th className="text-right font-medium px-3 py-2.5">24h</th>
                <th className="text-right font-medium px-3 py-2.5">
                  {t("overview.market.tableAlert")}
                </th>
                <th className="text-center font-medium px-3 py-2.5">AI</th>
                <th className="text-right font-medium px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const up = it.chg >= 0;
                const dist = ((it.alert - it.price) / it.price) * 100;
                return (
                  <tr
                    key={it.id}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-primary text-primary-foreground grid place-items-center text-[10px] font-bold">
                          {it.sym.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold leading-tight">{it.sym}</div>
                          <div className="text-xs text-muted-foreground">{it.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-right tabular-nums font-medium px-3 py-3">
                      {it.price.toLocaleString()}
                    </td>
                    <td
                      className={`text-right tabular-nums px-3 py-3 font-semibold ${up ? "text-bull" : "text-bear"}`}
                    >
                      {up ? "+" : ""}
                      {it.chg}%
                    </td>
                    <td className="text-right tabular-nums px-3 py-3">
                      <div className="font-medium">{it.alert.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {dist >= 0 ? "+" : ""}
                        {dist.toFixed(1)}%
                      </div>
                    </td>
                    <td className="text-center px-3 py-3">
                      <SentimentBadge s={it.sentiment} />
                    </td>
                    <td className="text-right px-5 py-3">
                      <button
                        type="button"
                        disabled={!isFeatureAvailable("alertEdit")}
                        aria-disabled={!isFeatureAvailable("alertEdit")}
                        title={t("common.unavailableMvp")}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`${t("overview.market.tableAlert")} ${it.sym}`}
                      >
                        <Bell className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground flex justify-between">
          <span>{t("overview.market.synced")}</span>
          <button
            onClick={() => setItems([...items].sort((a, b) => b.chg - a.chg))}
            className="font-medium text-primary hover:underline"
          >
            {t("overview.market.sort24h")}
          </button>
        </div>
      </div>
      <WatchlistAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(nextItems) => {
          setItems(nextItems);
          setStatus("SYSTEM");
          setLoadError(null);
        }}
      />
    </>
  );
}

/* ---------------- Economic Calendar ---------------- */

const FLAGS: Record<CalendarEvent["country"], string> = {
  US: "🇺🇸",
  EU: "🇪🇺",
  VN: "🇻🇳",
  CN: "🇨🇳",
  JP: "🇯🇵",
};

function ImpactDots({ impact }: { impact: CalendarEvent["impact"] }) {
  const n = impact === "high" ? 3 : impact === "mid" ? 2 : 1;
  const color =
    impact === "high" ? "bg-bear" : impact === "mid" ? "bg-chart-4" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= n ? color : "bg-border"}`} />
      ))}
    </div>
  );
}

function EconomicCalendar() {
  const { locale, t } = useI18n();
  const [impact, setImpact] = useState<"all" | "high" | "mid">("all");
  const [events, setEvents] = useState<CalendarEvent[]>(CALENDAR);
  const [status, setStatus] = useState<DataStatus>("SAMPLE");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/events")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Events API unavailable"))))
      .then((rows: CalendarEvent[]) => {
        if (!alive) return;
        setEvents(rows);
        setStatus("SYSTEM");
        setLoadError(null);
      })
      .catch(() => {
        if (!alive) return;
        setStatus("SAMPLE");
        setLoadError(
          locale === "vi"
            ? "Events API không khả dụng; đang hiển thị dữ liệu mẫu."
            : "Events API unavailable; showing sample data.",
        );
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  const filtered = events.filter((e) =>
    impact === "all" ? true : impact === "high" ? e.impact === "high" : e.impact !== "low",
  );
  const eventLabel = (event: CalendarEvent) =>
    locale === "vi" ? (CALENDAR_EVENT_VI[event.event] ?? event.event) : event.event;
  const dateLabel = (date: string) => (locale === "vi" ? (CALENDAR_DATE_VI[date] ?? date) : date);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">{t("overview.market.calendar")}</h2>
          <DataStatusBadge status={status} detail={loadError ?? undefined} />
        </div>
        <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
          {(["all", "mid", "high"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setImpact(k)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                impact === k
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "all"
                ? t("overview.market.filterAll")
                : k === "mid"
                  ? t("overview.market.filterMid")
                  : t("overview.market.filterHigh")}
            </button>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-border max-h-[420px] overflow-y-auto">
        {filtered.map((e, i) => (
          <li key={i} className="px-5 py-3 flex items-center gap-3 hover:bg-muted/40">
            <div className="text-center shrink-0 w-14">
              <div className="text-[10px] font-mono uppercase text-muted-foreground">
                {dateLabel(e.date)}
              </div>
              <div className="text-sm font-bold tabular-nums">{e.time}</div>
            </div>
            <div className="shrink-0 text-xl" aria-hidden>
              {FLAGS[e.country]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-tight truncate">{eventLabel(e)}</div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                <ImpactDots impact={e.impact} />
                {e.forecast && (
                  <span>
                    {t("overview.market.forecast")}:{" "}
                    <span className="text-foreground font-medium tabular-nums">{e.forecast}</span>
                  </span>
                )}
                {e.previous && (
                  <span>
                    {t("overview.market.previous")}:{" "}
                    <span className="tabular-nums">{e.previous}</span>
                  </span>
                )}
              </div>
            </div>
            {e.impact === "high" && (
              <AlertCircle
                className="w-4 h-4 text-bear shrink-0"
                aria-label={t("overview.market.highImpact")}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- News Feed with filters ---------------- */

function NewsFeed() {
  const { locale, t } = useI18n();
  const [q, setQ] = useState("");
  const [asset, setAsset] = useState<NewsAsset | "all">("all");
  const [src, setSrc] = useState<NewsSource | "all">("all");
  const [sent, setSent] = useState<NewsSentiment | "all">("all");
  const [news, setNews] = useState<News[]>(NEWS);
  const [status, setStatus] = useState<DataStatus>("SAMPLE");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/insights")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Insights API unavailable"))))
      .then((rows: Array<Omit<News, "src"> & { source?: string; src?: string }>) => {
        if (!alive) return;
        setNews(
          rows.map((row) => ({
            id: row.id,
            src: row.src ?? row.source ?? "Research",
            asset: row.asset,
            sentiment: row.sentiment,
            title: row.title,
            summary: row.summary,
            ago: row.ago,
          })),
        );
        setStatus("SYSTEM");
        setLoadError(null);
      })
      .catch(() => {
        if (!alive) return;
        setStatus("SAMPLE");
        setLoadError(
          locale === "vi"
            ? "Insights API không khả dụng; đang hiển thị dữ liệu mẫu."
            : "Insights API unavailable; showing sample data.",
        );
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  const sentiments: { k: NewsSentiment | "all"; label: string }[] = [
    { k: "all", label: t("overview.news.all") },
    { k: "bull", label: t("overview.news.bullish") },
    { k: "bear", label: t("overview.news.bearish") },
    { k: "neutral", label: t("overview.news.neutral") },
  ];

  const localizedNews = useMemo(
    () =>
      news.map((item) =>
        locale === "vi" && NEWS_VI_BY_ID[item.id] ? { ...item, ...NEWS_VI_BY_ID[item.id] } : item,
      ),
    [locale, news],
  );
  const sources = useMemo(
    () => Array.from(new Set(localizedNews.map((item) => item.src))).sort(),
    [localizedNews],
  );
  const assets = useMemo(
    () => Array.from(new Set(localizedNews.map((item) => item.asset))).sort(),
    [localizedNews],
  );

  const filtered = useMemo(() => {
    return localizedNews.filter((n) => {
      if (asset !== "all" && n.asset !== asset) return false;
      if (src !== "all" && n.src !== src) return false;
      if (sent !== "all" && n.sentiment !== sent) return false;
      if (q.trim() && !(n.title + " " + n.summary).toLowerCase().includes(q.toLowerCase()))
        return false;
      return true;
    });
  }, [q, asset, src, sent, localizedNews]);

  return (
    <section>
      <div className="flex items-end justify-between mb-5 gap-3 flex-wrap">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">{t("overview.news.title")}</h2>
            <DataStatusBadge status={status} detail={loadError ?? undefined} />
          </div>
          <p className="text-sm text-muted-foreground">{t("overview.news.description")}</p>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {t("overview.news.stories", { visible: filtered.length, total: localizedNews.length })}
        </span>
      </div>

      {/* Filter bar */}
      <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("overview.news.search")}
            className="bg-transparent outline-none text-sm w-full py-2 placeholder:text-muted-foreground"
          />
        </div>

        <Select
          icon={<Filter className="w-3.5 h-3.5" />}
          label={t("overview.news.asset")}
          value={asset}
          onChange={(v) => setAsset(v as NewsAsset | "all")}
          options={[
            { v: "all", l: t("overview.news.allAssets") },
            ...assets.map((a) => ({ v: a, l: a })),
          ]}
        />
        <Select
          label={t("overview.news.source")}
          value={src}
          onChange={(v) => setSrc(v as NewsSource | "all")}
          options={[
            { v: "all", l: t("overview.news.allSources") },
            ...sources.map((s) => ({ v: s, l: s })),
          ]}
        />
        <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
          {sentiments.map((s) => (
            <button
              key={s.k}
              onClick={() => setSent(s.k)}
              className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                sent === s.k
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
          {t("overview.news.empty")}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((a) => (
            <article
              key={a.id}
              className="group rounded-2xl border border-border bg-card p-5 hover:shadow-elegant hover:-translate-y-0.5 transition-all flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                    {a.src}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {a.asset}
                  </span>
                </div>
                <SentimentBadge s={a.sentiment} />
              </div>
              <h3 className="font-semibold text-lg leading-snug line-clamp-2 mb-2">{a.title}</h3>
              <p className="text-sm text-muted-foreground line-clamp-3 flex-1">{a.summary}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {a.ago} {t("overview.news.ago")}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {t("overview.news.mvpSummary")}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
  icon?: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2 text-xs">
      {icon}
      <span className="text-muted-foreground hidden sm:inline">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none font-semibold pr-1 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}
