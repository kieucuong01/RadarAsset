import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InlineFeedback } from "./inline-feedback";

describe("InlineFeedback", () => {
  it("renders success feedback as an accessible status", () => {
    const html = renderToStaticMarkup(
      <InlineFeedback tone="success" message="Đã lưu chiến lược." />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Đã lưu chiến lược.");
    expect(html).toContain("text-bull");
  });

  it("renders errors as an alert and stays empty without feedback", () => {
    const errorHtml = renderToStaticMarkup(
      <InlineFeedback tone="error" message="Không thể lưu." />,
    );
    const emptyHtml = renderToStaticMarkup(<InlineFeedback tone="success" message="" />);

    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("Không thể lưu.");
    expect(emptyHtml).toBe("");
  });
});
