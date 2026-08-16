# DataVest Brand and Search Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public RadarAsset identity with DataVest.vn, ship the approved A1 Cobalt × Amber identity, and expose one accurate entity definition to users, search engines, and AI agents.

**Architecture:** A typed `brand.ts` module is the single source of truth for public names, URLs, claims, and palette. Reusable SVG React components render the approved logo in the application, while standalone SVG files serve crawlers and external consumers. Next.js metadata, JSON-LD, robots, sitemap, the introduction page, and `llms.txt` all consume or mirror the same approved positioning without changing persisted legacy identifiers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Tailwind CSS 4, Vitest 4, server-rendered JSON-LD, SVG assets, Python 3 quant worker tests.

## Global Constraints

- Public brand is `DataVest`; canonical entity is `DataVest.vn`; canonical origin is `https://datavest.vn`.
- Descriptor is `Dữ liệu định lượng cho nhà đầu tư cá nhân`.
- Tagline is `Dữ liệu trước. Quyết định sau.`.
- Logo is approved A1 Evidence Path using Cobalt `#1746A2`, Amber `#F2B84B`, Midnight `#0E1B32`, Paper `#F5F7FB`, and White `#FFFFFF`.
- Amber marks evidence; existing bull/bear colors remain market-state semantics.
- Do not claim investment advice, guaranteed returns, verified live coverage where none exists, or available AI price prediction.
- Preserve localStorage migration keys, historical Prisma migrations, demo identity, Windows scheduled-task names, runtime temp paths, persisted source codes, and historical verification documents.
- Preserve unrelated user work and stage only files named by the current task.
- Do not push, deploy, configure DNS, or register the domain in this plan.

---

### Task 1: Establish the brand source of truth and marketing context

**Files:**
- Create: `src/lib/brand.test.ts`
- Create: `src/lib/brand.ts`
- Create: `.agents/product-marketing.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `BRAND`, `BRAND_COLORS`, and `resolveSiteUrl()` for all later tasks.
- Produces: `.agents/product-marketing.md` for SEO and schema work to reference.

- [ ] **Step 1: Write the failing brand contract test**

```ts
import { describe, expect, it } from "vitest";

import { BRAND, BRAND_COLORS, resolveSiteUrl } from "./brand";

describe("DataVest brand contract", () => {
  it("defines one canonical Vietnamese-first entity", () => {
    expect(BRAND).toMatchObject({
      name: "DataVest.vn",
      shortName: "DataVest",
      origin: "https://datavest.vn",
      descriptor: "Dữ liệu định lượng cho nhà đầu tư cá nhân",
      tagline: "Dữ liệu trước. Quyết định sau.",
    });
    expect(BRAND.description).toContain("nhà đầu tư cá nhân Việt Nam");
    expect(BRAND.description).not.toMatch(/guaranteed|chắc thắng|AI price prediction/i);
  });

  it("uses the approved A1 palette", () => {
    expect(BRAND_COLORS).toEqual({
      cobalt: "#1746A2",
      amber: "#F2B84B",
      midnight: "#0E1B32",
      paper: "#F5F7FB",
      white: "#FFFFFF",
    });
  });

  it("accepts only an absolute configured public origin", () => {
    expect(resolveSiteUrl(undefined)).toBe("https://datavest.vn");
    expect(resolveSiteUrl("https://preview.example.com/")).toBe("https://preview.example.com");
    expect(() => resolveSiteUrl("javascript:alert(1)")).toThrow("http or https");
  });

});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run src/lib/brand.test.ts`

Expected: FAIL because `src/lib/brand.ts` does not exist.

- [ ] **Step 3: Implement the typed brand module**

Create `src/lib/brand.ts` with immutable constants:

```ts
export const BRAND = {
  name: "DataVest.vn",
  shortName: "DataVest",
  origin: "https://datavest.vn",
  locale: "vi_VN",
  language: "vi",
  descriptor: "Dữ liệu định lượng cho nhà đầu tư cá nhân",
  tagline: "Dữ liệu trước. Quyết định sau.",
  positioning:
    "DataVest.vn là nền tảng hỗ trợ nhà đầu tư cá nhân Việt Nam phân tích thị trường, quản lý danh mục và kiểm định chiến lược bằng dữ liệu định lượng.",
  description:
    "DataVest.vn giúp nhà đầu tư cá nhân Việt Nam phân tích bối cảnh thị trường, quản lý danh mục và kiểm định chiến lược bằng dữ liệu định lượng. Nội dung chỉ nhằm mục đích thông tin và giáo dục, không phải tư vấn tài chính.",
  logoPath: "/brand/datavest-mark.svg",
  wordmarkPath: "/brand/datavest-wordmark.svg",
} as const;

export const BRAND_COLORS = {
  cobalt: "#1746A2",
  amber: "#F2B84B",
  midnight: "#0E1B32",
  paper: "#F5F7FB",
  white: "#FFFFFF",
} as const;

export function resolveSiteUrl(configured = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!configured) return BRAND.origin;
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use http or https");
  }
  return url.origin;
}
```

- [ ] **Step 4: Create the approved product-marketing context**

Create `.agents/product-marketing.md` from the approved spec. Include product overview, B2C audience, jobs to be done, pain points, alternatives, differentiation, objections, switching dynamics, exact customer language (`đầu tư dựa vào số liệu, không phải cảm tính chém gió`), voice, current proof boundaries, conversion action, and a section named `Unknown or unavailable proof`. Do not invent pricing, testimonials, customers, or performance metrics.

- [ ] **Step 5: Ignore visual-companion artifacts**

Append exactly `.superpowers/` to `.gitignore`. Do not delete the active companion session.

- [ ] **Step 6: Run the brand contract test**

Run: `npx vitest run src/lib/brand.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 1 only**

```powershell
git add -- src/lib/brand.test.ts src/lib/brand.ts .agents/product-marketing.md .gitignore
git commit -m "feat: establish DataVest brand foundation"
```

---

### Task 2: Build the approved vector identity and reusable logo component

**Files:**
- Create: `src/components/DataVestLogo.test.tsx`
- Create: `src/components/DataVestLogo.tsx`
- Create: `public/brand/datavest-mark.svg`
- Create: `public/brand/datavest-wordmark.svg`
- Create: `src/app/icon.svg`
- Create: `src/app/opengraph-image.tsx`

**Interfaces:**
- Consumes: `BRAND` and `BRAND_COLORS` from `src/lib/brand.ts`.
- Produces: `DataVestLogo({ lockup, decorative, className })` for Header and Footer.
- Produces: stable public logo URLs used by metadata and JSON-LD.

- [ ] **Step 1: Write the failing logo behavior test**

```tsx
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
```

- [ ] **Step 2: Run the logo test and confirm it fails**

Run: `npx vitest run src/components/DataVestLogo.test.tsx`

Expected: FAIL because the component and SVG assets do not exist.

- [ ] **Step 3: Implement the reusable SVG logo**

Create `DataVestLogo.tsx` using one inline SVG mark with:

- cobalt rounded square `viewBox="0 0 64 64"`
- white vertical stem at `x=19`
- amber path `M25 17C39 17 46 23 46 32S39 47 25 47`
- four varied nodes
- focus node at `(42,39)` with a low-opacity `r=6.5` halo and a solid `r=3.8` center carrying `data-evidence-node="focus"`
- `lockup=true` renders the `DataVest` wordmark beside the mark
- `decorative=true` is the default and sets `aria-hidden`; `decorative=false` labels the wrapper `DataVest.vn`

- [ ] **Step 4: Create matching standalone SVG assets**

Create `datavest-mark.svg`, `datavest-wordmark.svg`, and `src/app/icon.svg` with the same fixed geometry and colors. The wordmark SVG uses text converted to simple accessible SVG text with `font-family="Inter, Segoe UI, Arial, sans-serif"`; include `<title>DataVest.vn</title>`.

- [ ] **Step 5: Create the Open Graph image route**

Create `src/app/opengraph-image.tsx` using `ImageResponse`, size `1200 × 630`, and the brand constants. Render the mark, `DataVest.vn`, descriptor, and tagline on Paper/Midnight with no return promises or market-direction imagery.

- [ ] **Step 6: Run focused logo verification**

Run: `npx vitest run src/components/DataVestLogo.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Task 2 only**

```powershell
git add -- src/components/DataVestLogo.test.tsx src/components/DataVestLogo.tsx public/brand/datavest-mark.svg public/brand/datavest-wordmark.svg src/app/icon.svg src/app/opengraph-image.tsx
git commit -m "feat: add DataVest visual identity"
```

---

### Task 3: Rebrand the visible application shell and authentication copy

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/Footer.tsx`
- Modify: `src/components/AuthForm.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/sign-in/page.tsx`
- Modify: `src/app/sign-up/page.tsx`
- Modify: `src/app/onboarding/page.tsx`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `DataVestLogo` and `BRAND`.
- Preserves: current navigation routes, auth behavior, tenant behavior, localStorage keys, and scheduled-task identifiers.

- [ ] **Step 1: Replace shell icons and copy**

- Header and mobile sheet: replace the Lucide `Radar` icon and hard-coded wordmark with `DataVestLogo lockup`.
- Footer: use the lockup, descriptor, a `/gioi-thieu` link, and the DataVest risk disclaimer.
- Replace the old purple primary/gradient tokens with Cobalt-led UI tokens and Amber evidence accents; keep bull/bear colors unchanged and use accessible lighter Cobalt values for dark-mode interactive text where needed.
- Keep navigation and accessible labels unchanged except where the retired brand appears.

- [ ] **Step 2: Replace authentication metadata and prompts**

Update sign-in, sign-up, onboarding, and the `New to RadarAsset?` prompt to DataVest. Do not change auth routes, organization provisioning, form behavior, or stored user identity.

- [ ] **Step 3: Update active project identity**

Change the current README heading/description and architecture heading/active-product references to DataVest. Change package names from `quant-insight-radar` to `datavest` in both package files without renaming the repository directory or Python package structure.

- [ ] **Step 4: Run existing UI and localization behavior tests**

Run: `npx vitest run src/lib/mvp-ui.test.ts src/lib/i18n/dictionary.test.ts`

Expected: PASS.

- [ ] **Step 5: Inspect the rendered shell during Task 8**

Copy-only and static-asset changes do not get source-grep unit tests. Their acceptance gate is the production build plus real desktop/mobile rendering in Task 8.

- [ ] **Step 6: Commit Task 3 only**

```powershell
git add -- src/components/Header.tsx src/components/Footer.tsx src/components/AuthForm.tsx src/app/globals.css src/app/sign-in/page.tsx src/app/sign-up/page.tsx src/app/onboarding/page.tsx README.md docs/architecture.md package.json package-lock.json
git commit -m "feat: rebrand public application as DataVest"
```

---

### Task 4: Centralize metadata, canonical URLs, robots, sitemap, and JSON-LD

**Files:**
- Create: `src/lib/seo.test.ts`
- Create: `src/lib/seo.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/sitemap.ts`
- Create: `src/app/robots.ts`
- Delete: `public/robots.txt`
- Modify: `src/app/portfolio/page.tsx`
- Modify: `src/app/quant-lab/page.tsx`
- Modify: `src/app/sign-in/page.tsx`
- Modify: `src/app/sign-up/page.tsx`
- Modify: `src/app/onboarding/page.tsx`

**Interfaces:**
- Produces: `buildBrandJsonLd(siteUrl)` returning an `@graph` with `Organization` and `WebSite`.
- Produces: `safeJsonLd(value)` for script rendering.
- Consumes: `BRAND` and `resolveSiteUrl()`.

- [ ] **Step 1: Write failing SEO contracts**

```ts
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { buildBrandJsonLd, safeJsonLd } from "./seo";

describe("DataVest SEO surfaces", () => {
  it("publishes one connected Organization and WebSite graph", () => {
    const graph = buildBrandJsonLd("https://datavest.vn");
    expect(graph["@graph"].map((item) => item["@type"])).toEqual(["Organization", "WebSite"]);
    expect(graph["@graph"][0]).toMatchObject({
      name: "DataVest.vn",
      url: "https://datavest.vn",
      logo: "https://datavest.vn/brand/datavest-mark.svg",
    });
    expect(safeJsonLd({ value: "</script>" })).not.toContain("</script>");
  });

  it("lists public routes and excludes private routes", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://datavest.vn",
      "https://datavest.vn/portfolio",
      "https://datavest.vn/quant-lab",
      "https://datavest.vn/gioi-thieu",
    ]);
    expect(urls.join(" ")).not.toMatch(/sign-in|sign-up|onboarding|api/);
  });

  it("keeps public pages crawlable and private surfaces disallowed", () => {
    const policy = robots();
    expect(policy.sitemap).toBe("https://datavest.vn/sitemap.xml");
    expect(policy.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userAgent: "*", allow: "/" }),
        expect.objectContaining({ disallow: expect.arrayContaining(["/api/", "/sign-in", "/sign-up", "/onboarding"]) }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the SEO contract and confirm it fails**

Run: `npx vitest run src/lib/seo.test.ts`

Expected: FAIL because `seo.ts` and `app/robots.ts` do not exist and the sitemap still uses the retired origin.

- [ ] **Step 3: Implement safe, factual JSON-LD**

Create `src/lib/seo.ts` with `buildBrandJsonLd()` and `safeJsonLd()`. Connect `WebSite.publisher` to `Organization` with stable `#organization` and `#website` IDs. Include only name, URL, logo, description, and `inLanguage`; omit social accounts, ratings, prices, awards, and contact data.

- [ ] **Step 4: Replace root metadata and inject JSON-LD**

Update `layout.tsx` to:

- use `resolveSiteUrl()` and `BRAND`
- set `<html lang="vi">`
- set the approved Vietnamese title, template, description, canonical, authors, Open Graph locale/type/url/image, Twitter card, and icons
- render one server-side `<script type="application/ld+json">` using `safeJsonLd(buildBrandJsonLd(siteUrl))`

- [ ] **Step 5: Move robots into the App Router and update the sitemap**

Create `src/app/robots.ts`, delete static `public/robots.txt`, and use the route list from the test. Keep public assets crawlable and disallow private application surfaces.

- [ ] **Step 6: Make route metadata accurate**

- Portfolio: describe a simulated portfolio, allocation, transactions, and risk; do not imply brokerage execution.
- Quant Lab: describe optimization and historical backtesting; do not claim available AI prediction.
- Auth/onboarding: use DataVest copy and `robots: { index: false, follow: false }`.

- [ ] **Step 7: Run focused SEO verification**

Run: `npx vitest run src/lib/seo.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 4 only**

```powershell
git add -- src/lib/seo.test.ts src/lib/seo.ts src/app/layout.tsx src/app/sitemap.ts src/app/robots.ts public/robots.txt src/app/portfolio/page.tsx src/app/quant-lab/page.tsx src/app/sign-in/page.tsx src/app/sign-up/page.tsx src/app/onboarding/page.tsx
git commit -m "feat: add DataVest search entity metadata"
```

---

### Task 5: Add the Vietnamese entity and trust page

**Files:**
- Create: `src/app/gioi-thieu/page.test.tsx`
- Create: `src/app/gioi-thieu/page.tsx`
- Modify: `src/components/Footer.tsx`

**Interfaces:**
- Consumes: `BRAND`, `DataVestLogo`, and `APP_ROUTES` where appropriate.
- Produces: public `/gioi-thieu` content linked by sitemap, footer, metadata, and `llms.txt`.

- [ ] **Step 1: Write the failing introduction-page test**

```tsx
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
```

- [ ] **Step 2: Run the page test and confirm it fails**

Run: `npx vitest run src/app/gioi-thieu/page.test.tsx`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the static trust page**

Build a semantic server component with one H1, the approved definition in the opening paragraph, audience, three jobs-to-be-done, a four-state data-status explanation, source/method limits, risk disclaimer, last-updated `<time dateTime="2026-08-16">`, and links to overview, portfolio, and Quant Lab. Reuse current card/token styles; do not redesign the dashboard.

- [ ] **Step 4: Add the footer link**

Add a visible `Giới thiệu & phương pháp` link to `/gioi-thieu` without changing core product navigation.

- [ ] **Step 5: Run the page and shell tests**

Run: `npx vitest run src/app/gioi-thieu/page.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Task 5 only**

```powershell
git add -- src/app/gioi-thieu/page.test.tsx src/app/gioi-thieu/page.tsx src/components/Footer.tsx
git commit -m "feat: add DataVest introduction and methodology page"
```

---

### Task 6: Rewrite AI-agent discovery content without unsupported claims

**Files:**
- Modify: `public/llms.txt`

**Interfaces:**
- Consumes: approved positioning and the `/gioi-thieu` route.
- Produces: a Vietnamese-first, plain-Markdown entity summary for AI agents.

- [ ] **Step 1: Rewrite `public/llms.txt`**

Use absolute canonical links. Include the entity definition, audience, page directory, data-state meanings, source/method caveats, risk statement, and an `Updated: 2026-08-16` line. Describe Smart Insights as evidence-backed market context, Portfolio as a simulated/private tracking workspace, and Quant Lab as optimization plus historical backtesting. Do not describe unavailable prediction as a feature.

- [ ] **Step 2: Review the machine-readable content against the approved claims**

Confirm that every linked route is canonical, every capability is visible in the current product, all four data states are defined, and the advice boundary is explicit. Static Markdown is verified through its built HTTP response in Task 8 rather than a source-text change-detector test.

- [ ] **Step 3: Commit Task 6 only**

```powershell
git add -- public/llms.txt
git commit -m "feat: publish accurate DataVest AI discovery context"
```

---

### Task 7: Migrate outward worker identity while preserving persisted compatibility

**Files:**
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/tests/test_providers.py`
- Modify: `quant-worker/tests/test_asset_opinion_quant.py`
- Modify: `quant-worker/smart_insights/http.py`
- Modify: `quant-worker/backtest/providers.py`
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`

**Interfaces:**
- Changes only outward HTTP identity and the public methodology URL.
- Preserves persisted `source_code="radarasset-market-data"` as an explicit compatibility identifier.

- [ ] **Step 1: Change tests to require the new outward identity**

Update `test_http_transport_identifies_bounded_public_source_requests` to expect `DataVest/1.0`. Add a focused test around the market-bars fact builder that asserts:

```py
assert fact.source_code == "radarasset-market-data"
assert fact.source_url == "https://datavest.vn/gioi-thieu#phuong-phap"
```

Add this transport test to `test_providers.py` so the second HTTP client changes under test too:

```py
def test_urllib_json_transport_identifies_datavest_requests() -> None:
    class Response:
        status = 200
        headers: dict[str, str] = {}

        def read(self, _limit: int) -> bytes:
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    class Opener:
        request = None

        def open(self, request, *, timeout: float):
            self.request = request
            return Response()

    opener = Opener()
    transport = UrllibJsonTransport()
    transport._opener = opener
    transport.get_json("https://example.test/data", timeout_seconds=1)

    assert opener.request.get_header("User-agent") == "DataVest/1.0"
```

Import `UrllibJsonTransport` in that test module. For the market-bars assertion, call the existing public `build_btc_context_facts(bars(90, symbol="BTC"), as_of=NOW)` and inspect one returned fact rather than importing private `_derived_fact`. The source-code assertion documents the persisted compatibility exception; the source-URL assertion rejects the retired public domain.

- [ ] **Step 2: Run the focused Python tests and confirm the expected failures**

Run: `.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_providers.py quant-worker\tests\test_asset_opinion_quant.py -q`

Expected: FAIL on `RadarAsset/1.0` and `radarasset.app`.

- [ ] **Step 3: Update outward worker identity**

Change both HTTP user agents to `DataVest/1.0`. Change only `source_url` to `https://datavest.vn/gioi-thieu#phuong-phap`; leave the persisted source code unchanged.

- [ ] **Step 4: Run focused Python tests**

Run: `.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_providers.py quant-worker\tests\test_asset_opinion_quant.py -q`

Expected: PASS.

- [ ] **Step 5: Commit Task 7 only**

```powershell
git add -- quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_providers.py quant-worker/tests/test_asset_opinion_quant.py quant-worker/smart_insights/http.py quant-worker/backtest/providers.py quant-worker/smart_insights/asset_opinion_quant.py
git commit -m "feat: migrate DataVest outward worker identity"
```

---

### Task 8: Verify the complete local rebrand and inspect rendered output

**Files:**
- Modify only if verification exposes a requirement failure.

**Interfaces:**
- Consumes all prior deliverables.
- Produces local evidence; no deployment or remote-state claim.

- [ ] **Step 1: Run every focused brand gate together**

Run:

```powershell
npx vitest run src/lib/brand.test.ts src/components/DataVestLogo.test.tsx src/lib/seo.test.ts src/app/gioi-thieu/page.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the complete frontend verification**

Run sequentially:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: every command exits `0`. Existing warnings must be reported separately and must not be described as errors.

- [ ] **Step 3: Run the complete Python worker suite**

Run: `npm run test:python`

Expected: exit `0`; report pass/skip counts exactly from fresh output.

- [ ] **Step 4: Start the verified local production build**

Run `npm run start -- -p 3100` using a hidden persistent process. Verify the listener and request these URLs:

- `http://localhost:3100/`
- `http://localhost:3100/gioi-thieu`
- `http://localhost:3100/robots.txt`
- `http://localhost:3100/sitemap.xml`
- `http://localhost:3100/llms.txt`
- `http://localhost:3100/brand/datavest-mark.svg`

Expected: HTTP `200` for each public URL.

- [ ] **Step 5: Perform browser QA**

Inspect desktop and mobile widths in a real browser. Confirm:

- A1 logo and emphasized evidence point remain legible
- header/mobile sheet/footer all say DataVest
- no public RadarAsset copy appears
- `/gioi-thieu` heading hierarchy and links are usable
- favicon and Open Graph route render
- page source contains one valid Organization/WebSite JSON-LD graph
- no console errors are caused by the rebrand

- [ ] **Step 6: Audit retired-brand occurrences against the compatibility allowlist**

Run:

```powershell
rg -n -i --glob '!node_modules/**' --glob '!.next/**' --glob '!docs/verification/**' --glob '!prisma/migrations/**' "RadarAsset|radarasset\.app|Quant Insight Radar" .
```

Expected remaining hits: only documented compatibility identifiers such as localStorage migration keys, demo identity, scheduled tasks, runtime temp paths, persisted source code, and historical material. Any current public hit must be fixed with a failing test first.

- [ ] **Step 7: Check scope and diff integrity**

Run:

```powershell
git diff --check
git status --short
git diff --stat main...HEAD
```

Confirm `.superpowers/` is ignored, unrelated files are not staged, and commits contain only intended rebrand work.

- [ ] **Step 8: Create a final verification commit only if QA required fixes**

If browser/build verification required source fixes, stage only those reviewed files and commit:

```powershell
git commit -m "fix: complete DataVest brand verification"
```

If no source fixes were required, do not create an empty commit.

## Final Handoff

Report:

- final local commit sequence and current branch divergence
- exact focused/full frontend and Python test results
- build result
- verified local URLs and browser widths
- remaining retired-brand compatibility identifiers
- explicit statement that DNS, production deployment, Search Console, and remote indexing were not performed
