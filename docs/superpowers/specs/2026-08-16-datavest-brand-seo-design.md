# DataVest Brand, SEO, and AI Discovery Design

## Objective

Rebrand the public product from RadarAsset/Quant Insight Radar to **DataVest.vn**, position it as the Vietnamese quantitative-data platform for individual investors, and make the same accurate entity description available to people, search engines, and AI agents.

The rebrand must not imply investment advice, guaranteed returns, live-provider coverage that has not been verified, or AI prediction capabilities that are unavailable in the current product.

## Approved Brand Foundation

- Public brand: **DataVest**
- Canonical entity name: **DataVest.vn**
- Canonical domain: `https://datavest.vn`
- Primary audience: Vietnamese individual investors
- Category descriptor: **Dữ liệu định lượng cho nhà đầu tư cá nhân**
- Primary tagline: **Dữ liệu trước. Quyết định sau.**
- Positioning sentence: **DataVest.vn là nền tảng hỗ trợ nhà đầu tư cá nhân Việt Nam phân tích thị trường, quản lý danh mục và kiểm định chiến lược bằng dữ liệu định lượng.**
- Brand promise: help users make evidence-led investment decisions instead of decisions based on emotion, hype, or unsupported opinions
- Brand voice: calm, precise, transparent, evidence-first, educational, and never promotional about expected returns
- Words to prefer: dữ liệu, định lượng, kiểm định, danh mục, rủi ro, bằng chứng, nguồn, phương pháp
- Words to avoid unless factually and visibly supported: dự báo chắc chắn, cơ hội chắc thắng, phím hàng, lợi nhuận đảm bảo, cố vấn tài chính, AI price prediction

## Approved Visual Identity

The selected logo is **A1 — Evidence Path, Cobalt × Amber**.

### Mark construction

- A rounded-square cobalt field contains a white vertical stem and an amber data path that together form a letter `D`.
- Four nodes sit on the path with deliberately varied sizes.
- One amber node has a restrained halo and represents the material data point that deserves attention.
- The mark communicates data collection, analysis, and decision support. It must not resemble a radar, candlestick chart, rocket, or guaranteed upward price arrow.

### Core palette

- DataVest Cobalt: `#1746A2`
- Evidence Amber: `#F2B84B`
- Midnight Ink: `#0E1B32`
- Paper: `#F5F7FB`
- White: `#FFFFFF`

Amber is an accent for evidence and key actions. Existing semantic bull/bear colors remain reserved for market states and must not become brand colors.

### Required assets

- Reusable React SVG mark and lockup components for header/footer/UI
- Standalone SVG mark under `public/brand/`
- Standalone horizontal wordmark under `public/brand/`
- Next.js application icon/favicon based on the mark
- Branded Open Graph image generated from the same mark, positioning, and palette

All assets must remain legible on light and dark backgrounds and at favicon size. The logo needs accessible text alternatives wherever it is not decorative.

## Implementation Approach

Use a **complete public rebrand with internal compatibility**.

### Public surfaces to migrate

- Header, mobile navigation, footer, authentication and onboarding copy
- Root and route metadata, title templates, descriptions, canonical URLs, Open Graph, and Twitter cards
- Application icon, favicon, logo assets, and social preview image
- `robots.txt`, sitemap, and `llms.txt`
- Current README/project identity where it describes the active product
- Public source names or URLs that would expose the retired RadarAsset identity

### Compatibility surfaces to retain

Do not rename identifiers when doing so can invalidate existing browser data, database history, scheduled tasks, deployed automation, or immutable migrations. The initial rebrand therefore retains:

- Existing localStorage keys used for migration or saved state
- Historical Prisma migrations and seeded historical identifiers
- Existing demo email identity unless a separate data migration is designed
- Existing Windows scheduled-task names and runtime temporary-directory names
- Historical verification documents
- Stable persisted source codes where changing them would split historical data

These values are implementation details and must not appear in new public copy. A focused compatibility migration can be designed separately after the public rebrand is stable.

## Brand Source of Truth

Create a small typed brand module containing the canonical name, short name, domain, descriptor, tagline, descriptions, and color tokens used by metadata and schema. Public components must consume these values rather than duplicating brand strings.

Create `.agents/product-marketing.md` as the durable marketing context. It will record:

- B2C audience and jobs to be done
- the evidence-first problem statement
- actual product capabilities and current limitations
- customer language gathered in this naming discussion
- brand voice and prohibited claims
- the primary conversion action without inventing pricing or customer proof

Unknown pricing, testimonials, customer logos, and performance claims must be marked as unavailable rather than fabricated.

## SEO Design

### Default metadata

- Default language: Vietnamese (`vi`)
- Title: `DataVest.vn | Dữ liệu định lượng cho nhà đầu tư cá nhân`
- Title template: `%s | DataVest.vn`
- Description: a concise Vietnamese explanation of market analysis, portfolio management, strategy testing, and the non-advisory boundary
- Metadata base and canonical URLs: `https://datavest.vn`
- Open Graph locale: `vi_VN`

Each public route must retain a distinct, accurate title and description. Metadata must describe only functionality visible on that route.

### Entity and trust page

Add a public `/gioi-thieu` page with:

- a direct definition of DataVest.vn in the opening paragraph
- who the product is for
- what users can do: understand market context, monitor a portfolio, and test quantitative strategies
- how DataVest treats source provenance, sample/simulated/unavailable states, and methodological limitations
- a clear statement that the service supplies information and analytical tools, not individualized financial advice
- links to the three core product surfaces
- visible last-updated date

This page is included in the sitemap and linked from the footer.

### Crawl controls

Generate `robots.txt` from the canonical brand configuration. Public routes and assets remain crawlable. Authentication, onboarding, and private API areas must be disallowed where appropriate. The sitemap URL must use `https://datavest.vn`.

The initial sitemap contains the homepage, portfolio, Quant Lab, and introduction page. It must not list sign-in, sign-up, onboarding, or API routes.

## Structured Data

Render server-side JSON-LD on the root layout using an `@graph` containing:

- `Organization` for DataVest.vn with canonical URL, logo URL, and factual description
- `WebSite` connected to the organization as publisher

Do not add fake social profiles, reviews, ratings, prices, awards, address, or contact details. Do not add FAQ, Product, or SoftwareApplication schema unless matching visible content and the required factual properties exist.

JSON-LD must be serialized safely and tested as valid JSON. Visible copy and structured data must use the same positioning language.

## AI Search and Agent Readiness

Rewrite `public/llms.txt` in Vietnamese-first, machine-readable Markdown. It must include:

- the canonical DataVest.vn entity definition
- intended audience
- factual descriptions and links for Smart Insights, Portfolio, Quant Lab, and the introduction page
- data-status semantics: system data, sample, simulated, and unavailable
- methodology and investment-risk caveats
- an explicit prohibition against interpreting DataVest output as personalized financial advice

The file must not claim that every data source is live, that AI prediction is available, or that generated results are real trades.

No special AI-only doorway pages, keyword stuffing, or invented statistics will be added. AI discovery is supported through accurate public content, semantic HTML, crawlability, consistent entity naming, and structured machine-readable context.

## Copy and Navigation Behavior

- Header lockup uses `DataVest`; machine-facing metadata uses `DataVest.vn`.
- Footer shows the descriptor and the existing risk disclaimer rewritten for the new brand.
- The Vietnamese experience remains the default. English UI remains available but is secondary to the Vietnamese market positioning.
- The logo links to `/` and keeps an accessible brand label.
- The footer adds a link to `/gioi-thieu`; core product navigation remains unchanged.
- The tagline may appear on the introduction page and brand metadata but should not consume dashboard space or interfere with the existing investment workflows.

## Testing Strategy

Follow a red-green sequence for behavior-changing source files.

1. Add focused brand tests that fail while public metadata, assets, and copy still reference RadarAsset.
2. Add tests for canonical brand constants and safe JSON-LD output.
3. Add route-level tests for sitemap and robots behavior.
4. Add content tests for the introduction page and `llms.txt`, including the factual capability and disclaimer requirements.
5. Implement the smallest changes required to pass those tests.
6. Run focused tests, full Vitest, TypeScript, lint/format checks, and the production build.
7. Inspect the rendered desktop and mobile header/footer, favicon, introduction page, metadata, JSON-LD, sitemap, robots, and `llms.txt` in a local browser.

Tests must allow explicitly documented compatibility identifiers while rejecting the retired brand from current public surfaces.

## Existing Work Protection

The working tree contains user-owned changes. Rebrand work must not overwrite or stage unrelated modifications. In particular, generated changes to `next-env.d.ts` and any concurrent API test changes remain outside the rebrand commit unless they are independently required and explicitly reviewed.

## Deliverables

- DataVest logo mark, lockup, favicon, and Open Graph assets
- Public DataVest branding in the application shell and authentication surfaces
- Canonical metadata and URL migration to `datavest.vn`
- Organization/WebSite JSON-LD
- Accurate robots, sitemap, and `llms.txt`
- Public `/gioi-thieu` entity/trust page
- Durable product-marketing context
- Focused automated tests plus full local verification evidence

Deployment, domain registration, DNS configuration, Search Console verification, redirects from a production RadarAsset domain, and legal trademark registration are outside this local implementation. They require separate authorization or credentials. Because RadarAsset has not been launched in production, no redirect migration is assumed.
