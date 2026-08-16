import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssetIcon, assetIconIdentity } from "./AssetIcon";

describe("AssetIcon", () => {
  it("uses recognizable local identities for supported market symbols", () => {
    expect(assetIconIdentity("btc")).toMatchObject({ mark: "₿", known: true });
    expect(assetIconIdentity("ETH")).toMatchObject({ mark: "Ξ", known: true });
    expect(assetIconIdentity("SOL")).toMatchObject({ mark: "SOL", known: true });
    expect(assetIconIdentity("XAU")).toMatchObject({ mark: "Au", known: true });
    expect(assetIconIdentity("VNINDEX")).toMatchObject({ mark: "VN", known: true });
    expect(assetIconIdentity("FPT").known).toBe(true);
    expect(assetIconIdentity("VCB").known).toBe(true);
  });

  it("builds the same deterministic fallback regardless of symbol casing", () => {
    expect(assetIconIdentity("abc")).toEqual(assetIconIdentity("ABC"));
    expect(assetIconIdentity("ABC")).toMatchObject({ mark: "ABC", known: false });
  });

  it("labels a standalone icon and hides a decorative icon", () => {
    const labelled = renderToStaticMarkup(
      <AssetIcon symbol="ABC" name="ABC Corp" decorative={false} />,
    );
    const decorative = renderToStaticMarkup(<AssetIcon symbol="BTC" name="Bitcoin" />);

    expect(labelled).toContain('aria-label="ABC Corp (ABC)"');
    expect(labelled).toContain('data-asset-icon="ABC"');
    expect(decorative).toContain('aria-hidden="true"');
  });
});
