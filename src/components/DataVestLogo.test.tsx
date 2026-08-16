import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataVestLogo } from "./DataVestLogo";

describe("DataVestLogo", () => {
  it("labels a standalone lockup and hides a decorative mark", () => {
    const labelled = renderToStaticMarkup(<DataVestLogo lockup decorative={false} />);
    const decorative = renderToStaticMarkup(<DataVestLogo />);

    expect(labelled).toContain('aria-label="DataVest.vn"');
    expect(labelled).toContain("Data");
    expect(labelled).toContain("Vest");
    expect(decorative).toContain('aria-hidden="true"');
  });

  it("renders the A1 palette and emphasized evidence node", () => {
    const markup = renderToStaticMarkup(<DataVestLogo decorative={false} />);

    expect(markup).toContain("#1746A2");
    expect(markup).toContain("#F2B84B");
    expect(markup).toContain('data-evidence-node="focus"');
  });
});
