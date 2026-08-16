import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ itemsInjected: false }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const resolved = typeof initial === "function" ? (initial as () => T)() : initial;
      if (Array.isArray(resolved) && !state.itemsInjected) {
        state.itemsInjected = true;
        return actual.useState([
          {
            id: "instrument-fpt",
            providerCode: "ssi",
            providerSymbol: "FPT",
            assetId: "asset-fpt",
            symbol: "FPT",
            name: "FPT Corporation",
            market: "vn_equity",
            venue: "HOSE",
            currency: "VND",
            supportedTimeframes: ["1d"],
          },
        ] as T);
      }
      return actual.useState(initial);
    },
  };
});

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  };
});

import { FavoriteAssetDialog } from "./FavoriteAssetDialog";

describe("FavoriteAssetDialog asset identity", () => {
  beforeEach(() => {
    state.itemsInjected = false;
  });

  it("shows a local asset icon beside each catalog result", () => {
    const html = renderToStaticMarkup(
      <FavoriteAssetDialog open onOpenChange={() => undefined} onSaved={() => undefined} />,
    );

    expect(html).toContain("FPT Corporation");
    expect(html).toContain('data-asset-icon="FPT"');
  });
});
