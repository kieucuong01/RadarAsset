import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>;

  return {
    Legend: Container,
    ResponsiveContainer: Container,
    Tooltip: Container,
  };
});

import { ChartContainer, ChartTooltipContent } from "./chart";

function renderTooltip(
  value: number | string = 12_345.67891,
  formatter?: (value: number) => ReactNode,
): string {
  return renderToStaticMarkup(
    <ChartContainer config={{ revenue: { label: "Revenue" } }}>
      <ChartTooltipContent
        active
        formatter={formatter as never}
        payload={
          [
            {
              dataKey: "revenue",
              name: "Revenue",
              value,
              type: "line",
              payload: {},
            },
          ] as never
        }
      />
    </ChartContainer>,
  );
}

describe("ChartTooltipContent", () => {
  it("renders grouped numeric fallback values with shared precision", () => {
    expect(renderTooltip()).toContain("12,345.6789");
  });

  it("preserves zero in the numeric fallback", () => {
    expect(renderTooltip(0)).toContain(">0<");
  });

  it("preserves string and date-like fallback values", () => {
    expect(renderTooltip("2026-08-16")).toContain("2026-08-16");
  });

  it("keeps a consumer formatter authoritative", () => {
    expect(renderTooltip(12_345.67891, () => "Consumer value")).toContain("Consumer value");
  });
});
