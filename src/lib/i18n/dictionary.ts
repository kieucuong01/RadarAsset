export const LOCALES = [
  { code: "vi", label: "Tiếng Việt", shortLabel: "VI" },
  { code: "en", label: "English", shortLabel: "EN" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "vi";

export const dictionaries = {
  vi: {
    header: {
      mainNav: "Điều hướng chính",
      mobileNav: "Điều hướng mobile",
      theme: "Đổi giao diện sáng tối",
      menu: "Mở menu chính",
      mobileDescription: "Chọn khu vực bạn muốn mở.",
      language: "Ngôn ngữ",
    },
    routes: {
      insights: "Tổng quan",
      insightsMobile: "Tổng quan",
      portfolio: "Danh mục mô phỏng",
      portfolioMobile: "Danh mục",
      quantLab: "Phòng Quant",
      quantLabMobile: "Phòng Quant",
    },
    quant: {
      eyebrow: "Phòng mô phỏng định lượng",
      title: "Phòng Quant",
      hero: {
        description:
          "Tối ưu và backtest danh mục từ immutable market datasets. Kết quả là mô phỏng nghiên cứu, không phải khuyến nghị hoặc lệnh tại broker.",
      },
      status: {
        system: "Dữ liệu và tác vụ được xử lý qua API/worker của hệ thống.",
        predictionUnavailable: "AI Prediction chưa được nối vào provider production.",
      },
      tabs: {
        optimizer: "Tối ưu danh mục",
        strategies: "Thư viện chiến lược",
        backtest: "Backtest & Rủi ro",
        factors: "Yếu tố VN",
        predict: "Dự báo AI",
      },
      prediction: {
        title: "AI Prediction chưa sẵn sàng",
        description:
          "Tab này chưa có model/provider production được kiểm chứng nên hệ thống không hiển thị dự báo mô phỏng.",
        body: "Ưu tiên hiện tại là hoàn thiện portfolio backtest, strategy alerts và ingestion dữ liệu miễn phí.",
      },
      loading: "Đang tải Quant Lab",
    },
    backtest: {
      configAria: "Cấu hình backtest",
      outputAria: "Kết quả backtest",
      updateStatusError: "Không thể cập nhật trạng thái portfolio backtest.",
      activeRunDescription: "{legs} legs · {timeframe} · normalized portfolio simulation",
      failedTitle: "Backtest failed",
      failedDescription: "Worker could not finish this run. Check the selected data and try again.",
      builder: {
        strategy: "Strategy",
        title: "Portfolio Backtest Builder",
        description:
          "Chọn 1-10 mã trong hệ thống, gán chiến lược riêng cho từng mã và kiểm soát cash flow.",
        totalCapital: "Tổng vốn",
        currency: "Đồng tiền báo cáo",
        timeframe: "Khung thời gian",
        day: "Ngày (1d)",
        hour: "Giờ (1h)",
        from: "Từ ngày",
        to: "Đến ngày",
        legs: "Portfolio Legs",
        allocation: "Phân bổ tài sản",
        allocationDescription:
          "Equal chia đều phần vốn sau cash; Custom cho phép sửa từng mã; Optimized dùng engine dữ liệu thật.",
        mode: "Chế độ phân bổ",
        optimizerMethod: "Optimization method",
        targetReturn: "Target return/năm",
        targetVolatility: "Target vol/năm",
        riskTolerance: "Risk tolerance: {value}",
        maxWeight: "Max/mã: {value}%",
        optimize: "Tối ưu",
        emptyTitle: "Portfolio đang trống",
        emptyDescription: "Dùng “Thêm mã” để chọn bất kỳ tài sản nào hệ thống hỗ trợ.",
        cash: "Cash",
        cashDescription: "Giữ tiền mặt trong đồng tiền báo cáo, lãi suất 0% ở MVP.",
        cashWeight: "Trọng số cash (%)",
        cashValue: "Giá trị cash",
        totalWeight: "Tổng trọng số",
        assumptions: "Assumptions",
        assumptionsDescription:
          "Các giả định này được chuẩn hóa, lưu trong run hash và hiển thị lại ở kết quả.",
        rebalance: "Chu kỳ tái cân bằng",
        none: "Không",
        monthly: "Hàng tháng",
        quarterly: "Hàng quý",
        yearly: "Hàng năm",
        monthlyContribution: "Góp vốn hàng tháng",
        dividend: "Cổ tức",
        excludeDividend: "Không tính riêng",
        adjustedPrices: "Giá total-return",
        fxPolicy: "FX policy",
        fxDescription: "Không mô phỏng settlement FX lịch sử ở MVP.",
        noFakeTitle: "Không tạo dữ liệu giả",
        noFakeDescription:
          "“Giá total-return” chỉ chạy khi có dataset immutable phù hợp; nếu không, server trả lỗi trước khi tạo run.",
        costModel: "Cost model theo thị trường",
        invalidTitle: "Chưa thể chạy backtest",
        footer: "Kết quả là normalized simulation capital, không phải số dư hoặc lệnh tại broker.",
        run: "Run Portfolio Backtest",
        catalogError: "Không thể tải catalog chiến lược.",
        loadSymbolsError: "Không thể nạp toàn bộ mã được chuyển từ Mock Portfolio.",
        refreshDatasetError: "Không thể làm mới trạng thái dataset của các mã đã chọn.",
        unsupportedStrategy: "Chưa có chiến lược hỗ trợ {symbol} trên {timeframe}.",
        optimizerApplied: "Đã áp dụng phân bổ tối ưu từ dữ liệu lịch sử.",
        optimizerError: "Không thể tối ưu phân bổ.",
        queued: "Portfolio backtest đã được đưa vào hàng đợi.",
        createError: "Không thể tạo portfolio backtest.",
        markets: {
          vn_equity: "Chứng khoán Việt Nam",
          crypto_spot: "Crypto spot",
          metal_spot: "XAU/USD spot",
        },
        costs: {
          commissionBps: "Phí giao dịch (bps)",
          sellTaxBps: "Thuế bán (bps)",
          slippageBps: "Trượt giá (bps)",
          financingBpsAnnual: "Chi phí vốn/năm (bps)",
        },
        assetPicker: {
          loadError: "Không thể tải danh mục tài sản lúc này.",
          trigger: "Thêm mã",
          title: "Chọn tài sản để backtest",
          description:
            "Tìm trong toàn bộ mã hệ thống có dataset {timeframe} phủ đủ khoảng đã chọn.",
          searchLabel: "Mã hoặc tên tài sản",
          placeholder: "Ví dụ: FPT, BTC, XAU",
          maxDescription: "Tối đa 10 mã trong một portfolio backtest.",
          loadingTitle: "Đang kiểm tra dataset",
          loadingDescription: "Danh sách sẽ cập nhật sau khi tìm kiếm hoàn tất.",
          emptyTitle: "Không tìm thấy mã phù hợp",
          emptyDescription: "Thử từ khóa khác hoặc điều chỉnh khoảng thời gian.",
          selected: "Đã thêm",
        },
        leg: {
          remove: "Xóa {symbol}",
          weight: "Trọng số (%)",
          notional: "Vốn phân bổ",
          strategy: "Chiến lược",
          leverage: "Đòn bẩy",
          maxLeverage: "Tối đa {value}×",
        },
        advanced: {
          applyError: "Không thể áp dụng chiến lược vào Mock Portfolio.",
          applySuccess: "Đã áp dụng {strategy} cho {symbol}. Tín hiệu vẫn cần xác nhận.",
          emptyCashFlow: "Không có dòng tiền hoặc tái cân bằng trong kỳ.",
          applying: "Đang áp dụng…",
          apply: "Apply vào Mock Portfolio",
          emptyTrades: "Không có giao dịch hoàn tất trong kỳ.",
        },
      },
    },
  },
  en: {
    header: {
      mainNav: "Main navigation",
      mobileNav: "Mobile navigation",
      theme: "Toggle light or dark mode",
      menu: "Open main menu",
      mobileDescription: "Choose the workspace you want to open.",
      language: "Language",
    },
    routes: {
      insights: "Smart Insights",
      insightsMobile: "Overview",
      portfolio: "Mock Portfolio",
      portfolioMobile: "Portfolio",
      quantLab: "Quant Lab",
      quantLabMobile: "Quant Lab",
    },
    quant: {
      eyebrow: "Quantitative Simulation Workbench",
      title: "Quant Lab",
      hero: {
        description:
          "Optimize and backtest portfolios from immutable market datasets. Results are research simulations, not investment advice or broker orders.",
      },
      status: {
        system: "Data and jobs are processed through the platform API and workers.",
        predictionUnavailable: "AI Prediction is not connected to a production provider yet.",
      },
      tabs: {
        optimizer: "Portfolio Optimizer",
        strategies: "Strategy Lab",
        backtest: "Backtest & Risk Engine",
        factors: "VN Factor Lab",
        predict: "AI Prediction",
      },
      prediction: {
        title: "AI Prediction is not ready",
        description:
          "This tab has no verified production model or provider, so simulated predictions are not shown.",
        body: "The current priority is productionizing portfolio backtests, strategy alerts, and free-data ingestion.",
      },
      loading: "Loading Quant Lab",
    },
    backtest: {
      configAria: "Backtest configuration",
      outputAria: "Backtest output",
      updateStatusError: "Could not update portfolio backtest status.",
      activeRunDescription: "{legs} legs · {timeframe} · normalized portfolio simulation",
      failedTitle: "Backtest failed",
      failedDescription: "Worker could not finish this run. Check the selected data and try again.",
      builder: {
        strategy: "Strategy",
        title: "Portfolio Backtest Builder",
        description:
          "Choose 1-10 supported assets, assign each asset its own strategy, and control cash-flow assumptions.",
        totalCapital: "Total capital",
        currency: "Reporting currency",
        timeframe: "Timeframe",
        day: "Daily (1d)",
        hour: "Hourly (1h)",
        from: "From",
        to: "To",
        legs: "Portfolio Legs",
        allocation: "Asset allocation",
        allocationDescription:
          "Equal splits capital after cash; Custom lets you edit each asset; Optimized uses the historical-data engine.",
        mode: "Allocation mode",
        optimizerMethod: "Optimization method",
        targetReturn: "Target return/year",
        targetVolatility: "Target vol/year",
        riskTolerance: "Risk tolerance: {value}",
        maxWeight: "Max/asset: {value}%",
        optimize: "Optimize",
        emptyTitle: "Portfolio is empty",
        emptyDescription: "Use “Add asset” to choose any supported system asset.",
        cash: "Cash",
        cashDescription: "Held in the reporting currency with 0% interest in the MVP.",
        cashWeight: "Cash weight (%)",
        cashValue: "Cash value",
        totalWeight: "Total weight",
        assumptions: "Assumptions",
        assumptionsDescription:
          "These assumptions are normalized, included in the run hash, and shown again in results.",
        rebalance: "Rebalance frequency",
        none: "None",
        monthly: "Monthly",
        quarterly: "Quarterly",
        yearly: "Yearly",
        monthlyContribution: "Monthly contribution",
        dividend: "Dividends",
        excludeDividend: "Do not model separately",
        adjustedPrices: "Total-return prices",
        fxPolicy: "FX policy",
        fxDescription: "Historical settlement FX is not modeled in the MVP.",
        noFakeTitle: "No synthetic price data",
        noFakeDescription:
          "“Total-return prices” only run when a compatible immutable dataset exists; otherwise the server rejects the run before creation.",
        costModel: "Market cost model",
        invalidTitle: "Backtest cannot run yet",
        footer: "Results are normalized simulation capital, not broker balances or orders.",
        run: "Run Portfolio Backtest",
        catalogError: "Could not load the strategy catalog.",
        loadSymbolsError: "Could not load every symbol handed off from Mock Portfolio.",
        refreshDatasetError: "Could not refresh dataset status for selected assets.",
        unsupportedStrategy: "No strategy supports {symbol} on {timeframe} yet.",
        optimizerApplied: "Applied optimized allocation from historical data.",
        optimizerError: "Could not optimize allocation.",
        queued: "Portfolio backtest was queued.",
        createError: "Could not create portfolio backtest.",
        markets: {
          vn_equity: "Vietnam equities",
          crypto_spot: "Crypto spot",
          metal_spot: "XAU/USD spot",
        },
        costs: {
          commissionBps: "Commission (bps)",
          sellTaxBps: "Sell tax (bps)",
          slippageBps: "Slippage (bps)",
          financingBpsAnnual: "Financing cost/year (bps)",
        },
        assetPicker: {
          loadError: "Could not load the asset catalog right now.",
          trigger: "Add asset",
          title: "Choose an asset to backtest",
          description:
            "Search all system assets with a {timeframe} dataset covering the selected range.",
          searchLabel: "Symbol or asset name",
          placeholder: "Example: FPT, BTC, XAU",
          maxDescription: "Up to 10 assets in one portfolio backtest.",
          loadingTitle: "Checking dataset",
          loadingDescription: "The list will update after the search completes.",
          emptyTitle: "No matching assets found",
          emptyDescription: "Try another keyword or adjust the date range.",
          selected: "Added",
        },
        leg: {
          remove: "Remove {symbol}",
          weight: "Weight (%)",
          notional: "Allocated capital",
          strategy: "Strategy",
          leverage: "Leverage",
          maxLeverage: "Max {value}×",
        },
        advanced: {
          applyError: "Could not apply the strategy to Mock Portfolio.",
          applySuccess: "Applied {strategy} to {symbol}. Signals still require confirmation.",
          emptyCashFlow: "No cash-flow or rebalance events in this period.",
          applying: "Applying…",
          apply: "Apply to Mock Portfolio",
          emptyTrades: "No completed trades in this period.",
        },
      },
    },
  },
} as const;

export type TranslationKey = DottedKeys<(typeof dictionaries)[Locale]>;

type DottedKeys<T> = {
  [K in Extract<keyof T, string>]: T[K] extends string ? K : `${K}.${DottedKeys<T[K]>}`;
}[Extract<keyof T, string>];

export function normalizeLocale(value: unknown): Locale {
  return value === "en" || value === "vi" ? value : DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: Record<string, string | number> = {},
) {
  const text = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, dictionaries[locale]);
  if (typeof text !== "string") return key;
  return Object.entries(values).reduce(
    (output, [name, value]) => output.replaceAll(`{${name}}`, String(value)),
    text,
  );
}
