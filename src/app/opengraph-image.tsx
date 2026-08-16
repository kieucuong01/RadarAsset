import { ImageResponse } from "next/og";

import { BRAND, BRAND_COLORS } from "@/lib/brand";

export const alt = `${BRAND.name} — ${BRAND.descriptor}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: BRAND_COLORS.paper,
        color: BRAND_COLORS.midnight,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "72px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "42px",
          maxWidth: "1020px",
          width: "100%",
        }}
      >
        <svg width="190" height="190" viewBox="0 0 64 64">
          <rect x="2" y="2" width="60" height="60" rx="17" fill={BRAND_COLORS.cobalt} />
          <path d="M19 15v34" stroke={BRAND_COLORS.white} strokeWidth="5" strokeLinecap="round" />
          <path
            d="M25 17C39 17 46 23 46 32S39 47 25 47"
            fill="none"
            stroke={BRAND_COLORS.amber}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="29" cy="18" r="2.8" fill={BRAND_COLORS.white} />
          <circle cx="42" cy="27" r="3.3" fill={BRAND_COLORS.white} />
          <circle cx="42" cy="39" r="6.5" fill={BRAND_COLORS.amber} opacity="0.24" />
          <circle
            cx="42"
            cy="39"
            r="3.8"
            fill={BRAND_COLORS.amber}
            stroke={BRAND_COLORS.white}
            strokeWidth="1.6"
          />
          <circle cx="29" cy="47" r="2.5" fill={BRAND_COLORS.white} />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div
            style={{ display: "flex", fontSize: "76px", fontWeight: 750, letterSpacing: "-4px" }}
          >
            <span>Data</span>
            <span style={{ color: "#8A5A00" }}>Vest.vn</span>
          </div>
          <div style={{ fontSize: "34px", fontWeight: 600 }}>{BRAND.descriptor}</div>
          <div style={{ color: BRAND_COLORS.cobalt, fontSize: "26px" }}>{BRAND.tagline}</div>
        </div>
      </div>
    </div>,
    size,
  );
}
