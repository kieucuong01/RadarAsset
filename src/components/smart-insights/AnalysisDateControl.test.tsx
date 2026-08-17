import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalysisDateControl, analysisDateOptions } from "./AnalysisDateControl";

describe("AnalysisDateControl", () => {
  it("puts Today first and deduplicates published dates", () => {
    expect(analysisDateOptions("2026-08-17", ["2026-08-17", "2026-08-16"])).toEqual([
      "2026-08-17",
      "2026-08-16",
    ]);
  });

  it("labels a historical selection without implying current analysis", () => {
    const html = renderToStaticMarkup(
      <AnalysisDateControl
        locale="vi"
        today="2026-08-17"
        dates={["2026-08-16"]}
        value="2026-08-16"
        loading={false}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Ngày phân tích"');
    expect(html).toContain("16/08/2026");
    expect(html).toContain("Lịch sử");
    expect(html).toContain("Hôm nay");
  });

  it("keeps date navigation available while a briefing is loading", () => {
    const html = renderToStaticMarkup(
      <AnalysisDateControl
        locale="vi"
        today="2026-08-17"
        dates={["2026-08-16"]}
        value="2026-08-16"
        loading
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Đang tải phân tích"');
    expect(html).not.toContain('aria-label="Ngày phân tích" disabled=""');
  });
});
