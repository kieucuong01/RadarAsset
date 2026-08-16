import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import IntroductionPage, { metadata } from "./page";

describe("DataVest introduction page", () => {
  it("defines the entity, audience, capabilities, limits, and core routes", () => {
    const html = renderToStaticMarkup(<IntroductionPage />);

    expect(html).toContain("DataVest.vn là nền tảng hỗ trợ nhà đầu tư cá nhân Việt Nam");
    expect(html).toContain("Dữ liệu hệ thống");
    expect(html).toContain("Dữ liệu mẫu");
    expect(html).toContain("Mô phỏng");
    expect(html).toContain("Dữ liệu chưa khả dụng");
    expect(html).toContain("không phải tư vấn tài chính");
    expect(html).toContain('href="/portfolio"');
    expect(html).toContain('href="/quant-lab"');
    expect(html).toContain("Cập nhật: 16/08/2026");
  });

  it("ships a distinct Vietnamese title and canonical", () => {
    expect(metadata.title).toBe("Giới thiệu và phương pháp");
    expect(metadata.alternates).toMatchObject({ canonical: "/gioi-thieu" });
  });
});
