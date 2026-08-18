import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TopLoadingBar } from "./TopLoadingBar";

describe("TopLoadingBar", () => {
  it("shows an accessible indeterminate bar while a tab is loading", () => {
    const html = renderToStaticMarkup(
      <TopLoadingBar active label="Đang tải tab Phân tích chiến lược" />,
    );

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Đang tải tab Phân tích chiến lược"');
    expect(html).toContain("animate-[datavest-top-progress_1.2s_ease-in-out_infinite]");
  });

  it("does not render a progress bar while the tab is idle", () => {
    const html = renderToStaticMarkup(
      <TopLoadingBar active={false} label="Đang tải tab Phân tích chiến lược" />,
    );

    expect(html).toBe("");
  });
});
