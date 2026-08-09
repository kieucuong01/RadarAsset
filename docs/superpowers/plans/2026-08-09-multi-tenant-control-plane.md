# Multi-Tenant Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seeded demo-user boundary with authenticated Better Auth organizations and prove server-enforced tenant isolation for all existing user-owned Portfolio, Watchlist, Research, and Quant APIs.

**Architecture:** Map Better Auth's user model onto the existing `AppUser`, use its organization plugin for memberships and active workspace selection, and add an explicit server-side `TenantContext`. Existing database services receive that context and include `organizationId` in every user-owned query; protected API routes and pages resolve the context from a validated database session rather than client input.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Better Auth 1.5, Better Auth Prisma adapter and organization plugin, Prisma 7/PostgreSQL, Zod, Vitest, existing shadcn/Radix components, Node 24.

## Global Constraints

- Preserve the existing Next.js, Prisma, PostgreSQL, Portfolio, Watchlist, Research, and Quant behavior except where authentication or organization scoping necessarily changes it.
- Use Better Auth email/password with database-backed sessions; do not add OAuth, passkeys, SSO, billing, API keys, Redis sessions, or invitations UI in this phase.
- Roles are exactly `owner`, `admin`, `editor`, and `viewer`.
- APIs derive `userId` and `organizationId` from a validated server session; never accept an ownership boundary from request JSON, query parameters, or headers.
- `owner`, `admin`, and `editor` may mutate current tenant resources; `viewer` is read-only.
- Public market-data endpoints remain public. Portfolio, Watchlist, Research-run listing, and Quant-run endpoints become authenticated.
- The worker research-import endpoint always requires a configured token and resolves one configured service organization by slug; a missing server token fails closed.
- Use UUID database identifiers and keep the existing `AppUser` primary keys and domain relations.
- Keep the current simulated-data labels and local/demo wording until real backtests replace them.
- Do not add the backtest DSL, Redis, Celery, object storage, strategy models, or engine code in this phase.
- Generate migrations with Prisma and inspect the SQL before applying it; existing demo-domain rows must be backfilled, not deleted by migration.
- Use bundled Node 24 from `C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` for project commands.
- Stage and commit only files named by the active task.

---

### Task 1: Add Better Auth dependencies and one permission source of truth

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `src/lib/auth/env.ts`
- Create: `src/lib/auth/permissions.ts`
- Create: `src/lib/auth/permissions.test.ts`

**Interfaces:**
- Produces: `TenantRole`, `TenantResource`, `TenantAction`, `hasTenantCapability(role, resource, action)`, `organizationAccessControl`, and `organizationRoles`.
- Consumes: environment variables `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.

- [ ] **Step 1: Install pinned-compatible Better Auth packages**

Run with bundled Node 24:

```powershell
npm install better-auth@^1.5 @better-auth/prisma-adapter@^1.5
```

Expected: `package.json` and `package-lock.json` contain both dependencies and installation exits 0.

- [ ] **Step 2: Add explicit auth environment contracts**

Append to `.env.example`:

```dotenv
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=
QUANT_WORKER_ORGANIZATION_SLUG=demo-workspace
DEV_DEMO_PASSWORD=
```

Create `src/lib/auth/env.ts`:

```ts
export function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
```

`BETTER_AUTH_SECRET` must contain at least 32 high-entropy characters in every non-test environment. Tests set a fixed test-only secret in their process environment.

- [ ] **Step 3: Write failing role-capability tests**

Create `src/lib/auth/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasTenantCapability } from "./permissions";

describe("tenant permissions", () => {
  it("keeps viewers read-only", () => {
    expect(hasTenantCapability("viewer", "portfolio", "read")).toBe(true);
    expect(hasTenantCapability("viewer", "portfolio", "write")).toBe(false);
    expect(hasTenantCapability("viewer", "backtest", "create")).toBe(false);
  });

  it.each(["owner", "admin", "editor"] as const)("allows %s to mutate tenant data", (role) => {
    expect(hasTenantCapability(role, "portfolio", "write")).toBe(true);
    expect(hasTenantCapability(role, "backtest", "create")).toBe(true);
  });

  it("reserves membership management for owners and admins", () => {
    expect(hasTenantCapability("owner", "membership", "manage")).toBe(true);
    expect(hasTenantCapability("admin", "membership", "manage")).toBe(true);
    expect(hasTenantCapability("editor", "membership", "manage")).toBe(false);
  });
});
```

- [ ] **Step 4: Run the permission test and confirm RED**

Run:

```powershell
npm run test -- src/lib/auth/permissions.test.ts
```

Expected: FAIL because `src/lib/auth/permissions.ts` does not exist.

- [ ] **Step 5: Implement application and Better Auth roles from one module**

Create `src/lib/auth/permissions.ts` with these public types and behavior:

```ts
export type TenantRole = "owner" | "admin" | "editor" | "viewer";
export type TenantResource = "portfolio" | "watchlist" | "research" | "backtest" | "membership";
export type TenantAction = "read" | "write" | "create" | "cancel" | "manage";

const capabilities: Record<TenantRole, Partial<Record<TenantResource, TenantAction[]>>> = {
  owner: {
    portfolio: ["read", "write"], watchlist: ["read", "write"], research: ["read", "write"],
    backtest: ["read", "create", "cancel"], membership: ["read", "manage"],
  },
  admin: {
    portfolio: ["read", "write"], watchlist: ["read", "write"], research: ["read", "write"],
    backtest: ["read", "create", "cancel"], membership: ["read", "manage"],
  },
  editor: {
    portfolio: ["read", "write"], watchlist: ["read", "write"], research: ["read", "write"],
    backtest: ["read", "create", "cancel"], membership: ["read"],
  },
  viewer: {
    portfolio: ["read"], watchlist: ["read"], research: ["read"], backtest: ["read"],
    membership: ["read"],
  },
};

export function hasTenantCapability(role: TenantRole, resource: TenantResource, action: TenantAction) {
  return capabilities[role][resource]?.includes(action) ?? false;
}
```

In the same file, configure Better Auth's organization access controller with the same four roles. Merge Better Auth's default organization/member/invitation statements into owner/admin, and give editor/viewer no organization mutation permissions. Export `organizationAccessControl` and `organizationRoles` for server and client auth configuration.

- [ ] **Step 6: Run focused tests and TypeScript**

Run:

```powershell
npm run test -- src/lib/auth/permissions.test.ts
npx tsc --noEmit
```

Expected: permission tests and TypeScript pass.

- [ ] **Step 7: Commit Task 1**

```powershell
git add package.json package-lock.json .env.example src/lib/auth
git commit -m "feat: add tenant permission foundation"
```

---

### Task 2: Add auth, organization, and tenant ownership schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608090001_multi_tenant_auth/migration.sql`
- Modify: `prisma/seed.ts`
- Modify: `README.md`
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth-client.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/lib/backend/organization-provisioning.ts`
- Create: `src/lib/backend/organization-provisioning.test.ts`

**Interfaces:**
- Produces: Better Auth-compatible `AppUser`, `Session`, `Account`, `Verification`, `Organization`, `Membership`, and `Invitation` models; required `organizationId` ownership on existing tenant resources; `auth` and `authClient`.
- Consumes: `organizationAccessControl`, `organizationRoles`, and `getPrisma()`.

- [ ] **Step 1: Configure Better Auth and the organization plugin**

Create `src/lib/auth.ts`:

```ts
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth/minimal";
import { organization } from "better-auth/plugins";
import { getPrisma } from "@/lib/db/prisma";
import { requireServerEnv } from "@/lib/auth/env";
import { organizationAccessControl, organizationRoles } from "@/lib/auth/permissions";
import { provisionOrganizationDefaults } from "@/lib/backend/organization-provisioning";

export const auth = betterAuth({
  baseURL: requireServerEnv("BETTER_AUTH_URL"),
  secret: requireServerEnv("BETTER_AUTH_SECRET"),
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  user: { modelName: "AppUser" },
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  advanced: { database: { generateId: "uuid" } },
  plugins: [
    organization({
      ac: organizationAccessControl,
      roles: organizationRoles,
      creatorRole: "owner",
      organizationLimit: 10,
      membershipLimit: 100,
      schema: { member: { modelName: "Membership" } },
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => {
          await provisionOrganizationDefaults({ organizationId: organization.id, userId: user.id });
        },
      },
    }),
  ],
});
```

Do not enable experimental joins or dynamic roles in this phase.

Create `src/lib/auth-client.ts` with `createAuthClient` and `organizationClient`, importing the same access controller and roles so client types match server types.

Create `src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 2: Extend the Prisma schema with Better Auth core models**

Add `emailVerified Boolean @default(false) @map("email_verified")` and `image String?` to `AppUser`, plus relations to sessions, accounts, memberships, and invitations.

Add these models using UUID IDs and snake_case table mappings:

```prisma
model Session {
  id                   String    @id @default(uuid()) @db.Uuid
  token                String    @unique
  expiresAt            DateTime  @map("expires_at")
  ipAddress             String?   @map("ip_address")
  userAgent             String?   @map("user_agent")
  userId                String    @map("user_id") @db.Uuid
  activeOrganizationId String?   @map("active_organization_id") @db.Uuid
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  user                  AppUser   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([activeOrganizationId])
  @@map("auth_sessions")
}

model Account {
  id                     String    @id @default(uuid()) @db.Uuid
  accountId              String    @map("account_id")
  providerId             String    @map("provider_id")
  userId                 String    @map("user_id") @db.Uuid
  accessToken            String?   @map("access_token") @db.Text
  refreshToken           String?   @map("refresh_token") @db.Text
  idToken                String?   @map("id_token") @db.Text
  accessTokenExpiresAt   DateTime? @map("access_token_expires_at")
  refreshTokenExpiresAt  DateTime? @map("refresh_token_expires_at")
  scope                   String?
  password                String?   @db.Text
  createdAt               DateTime  @default(now()) @map("created_at")
  updatedAt               DateTime  @updatedAt @map("updated_at")
  user                    AppUser   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
  @@index([userId])
  @@map("auth_accounts")
}
```

Add `Verification` with `identifier`, `value`, `expiresAt`, `createdAt`, and `updatedAt` fields matching Better Auth's documented core schema.

- [ ] **Step 3: Add organization plugin models**

Add `Organization`, `Membership`, and `Invitation` with UUID primary keys and Better Auth-required fields. Enforce:

```prisma
@@unique([userId, organizationId])
@@index([organizationId, role])
```

on `Membership`, and a unique organization slug. `Session.activeOrganizationId` remains an indexed scalar without a Prisma relation because Better Auth owns active-workspace lifecycle.

- [ ] **Step 4: Write a failing organization-provisioning test**

Mock Prisma and assert two calls for the same organization produce one `Main Portfolio` with USD base currency:

```ts
await provisionOrganizationDefaults({ organizationId: "org-1", userId: "user-1" });
await provisionOrganizationDefaults({ organizationId: "org-1", userId: "user-1" });

expect(prisma.portfolio.upsert).toHaveBeenCalledTimes(2);
expect(prisma.portfolio.upsert).toHaveBeenLastCalledWith({
  where: { organizationId_name: { organizationId: "org-1", name: "Main Portfolio" } },
  create: {
    organizationId: "org-1",
    userId: "user-1",
    name: "Main Portfolio",
    baseCurrency: "USD",
  },
  update: {},
});
```

- [ ] **Step 5: Run the provisioning test and confirm RED**

Run `npm run test -- src/lib/backend/organization-provisioning.test.ts`.

Expected: FAIL because the provisioning module and compound portfolio key do not exist.

- [ ] **Step 6: Implement idempotent default provisioning**

Create `provisionOrganizationDefaults(input: { organizationId: string; userId: string })` using the exact upsert contract from Step 4. Do not seed positions, transactions, watchlist rows, or simulated QuantRuns for newly registered users.

- [ ] **Step 7: Add organization ownership to existing user data**

Add required `organizationId` plus relation/index to:

- `Portfolio`
- `WatchlistItem`
- `ResearchRun`
- `QuantRun`

Replace `WatchlistItem`'s unique key with:

```prisma
@@unique([organizationId, userId, assetId])
```

Keep existing `userId` fields so creation authors and personal presentation remain available. Organization is the authorization boundary.

Add `@@unique([organizationId, name])` to Portfolio so organization provisioning is safe to retry.

- [ ] **Step 8: Generate and inspect the migration**

Run:

```powershell
npx prisma migrate dev --name multi_tenant_auth --create-only
```

Rename the generated directory to `prisma/migrations/202608090001_multi_tenant_auth` before editing it so this plan has one stable migration path.

Before applying, edit the generated SQL so it:

1. Creates Better Auth tables and nullable ownership columns.
2. Inserts a `demo-workspace` organization for the existing `demo@radarasset.local` user when that user exists.
3. Inserts its owner membership.
4. Backfills Portfolio, Watchlist, ResearchRun, and QuantRun rows with that organization ID.
5. Makes ownership columns `NOT NULL` only after the backfill.
6. Adds foreign keys, indexes, and the new watchlist unique constraint.

Use `gen_random_uuid()` for the migration-created organization and membership. Guard backfill inserts with `WHERE EXISTS`/`ON CONFLICT` so a clean database and the existing local database both migrate safely.

- [ ] **Step 9: Apply and validate the migration**

Run:

```powershell
npx prisma migrate dev
npx prisma generate
npx prisma validate
npx prisma migrate status
```

Expected: all commands exit 0 and migration status reports the schema is up to date.

- [ ] **Step 10: Make the development seed create a real login and workspace**

Update `prisma/seed.ts` to:

1. Refuse to run when `NODE_ENV === "production"`.
2. Require `DEV_DEMO_PASSWORD`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET`.
3. Delete dependent demo auth/domain rows in foreign-key-safe order.
4. Create `demo@radarasset.local` with `auth.api.signUpEmail()`.
5. Create `RadarAsset Demo` / `demo-workspace` with `auth.api.createOrganization({ body: { name, slug, userId } })` and no request headers.
6. Reuse the hook-provisioned `Main Portfolio` for seeded transactions and positions.
7. Write that organization ID into every seeded Portfolio, WatchlistItem, ResearchRun, and QuantRun.

Keep market assets and bars global. Never print the demo password.

- [ ] **Step 11: Document local auth setup**

Update README local setup to require a generated `BETTER_AUTH_SECRET`, a local-only `DEV_DEMO_PASSWORD`, `npm run db:migrate`, and `npm run db:seed`. Remove the statement that the application has no real authentication.

- [ ] **Step 12: Run seed and baseline tests**

Against the local development database, run:

```powershell
npm run db:seed
npm run test -- --run
npx tsc --noEmit
```

Expected: seed exits 0, all tests pass, and TypeScript exits 0.

- [ ] **Step 13: Commit Task 2**

```powershell
git add prisma/schema.prisma prisma/migrations/202608090001_multi_tenant_auth/migration.sql prisma/seed.ts README.md src/lib/auth.ts src/lib/auth-client.ts "src/app/api/auth/[...all]/route.ts" src/lib/backend/organization-provisioning.ts src/lib/backend/organization-provisioning.test.ts
git commit -m "feat: add tenant ownership schema"
```

---

### Task 3: Resolve tenant context and authorization server-side

**Files:**
- Create: `src/lib/auth/errors.ts`
- Create: `src/lib/auth/tenant-context.ts`
- Create: `src/lib/auth/tenant-context.test.ts`
- Modify: `src/app/api/_lib.ts`

**Interfaces:**
- Produces: `TenantContext`, `resolveTenantContext(input)`, `requireTenantContext()`, `requireTenantCapability(context, resource, action)`, `AuthenticationRequiredError`, `OrganizationRequiredError`, and `TenantForbiddenError`.
- Consumes: Better Auth `auth.api.getSession`, active organization session field, Prisma Membership fallback, and permission helpers from Task 1.

- [ ] **Step 1: Write failing tenant-resolution tests**

Create tests covering:

```ts
it("uses the active organization only when membership exists", async () => {
  const result = await resolveTenantContext({
    session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-2" } },
    memberships: [
      { organizationId: "org-1", role: "viewer" },
      { organizationId: "org-2", role: "editor" },
    ],
  });
  expect(result).toEqual({ userId: "user-1", organizationId: "org-2", role: "editor" });
});
```

Also assert unauthenticated sessions throw `AuthenticationRequiredError`, a stale active organization falls back to the first membership ordered by creation time, no membership throws `OrganizationRequiredError`, and invalid stored roles fail closed as viewer rather than gaining write access. Better Auth can store comma-separated roles; normalize them using precedence `owner`, `admin`, `editor`, `viewer` and select the highest valid role.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `npm run test -- src/lib/auth/tenant-context.test.ts`.

Expected: FAIL because tenant context modules do not exist.

- [ ] **Step 3: Implement typed auth errors**

Create `src/lib/auth/errors.ts` with three distinct classes. Do not encode HTTP concerns inside them.

```ts
export class AuthenticationRequiredError extends Error {}
export class OrganizationRequiredError extends Error {}
export class TenantForbiddenError extends Error {}
```

- [ ] **Step 4: Implement pure resolution and the server adapter**

`resolveTenantContext` accepts a session or null plus ordered membership rows and returns:

```ts
export type TenantContext = {
  userId: string;
  organizationId: string;
  role: TenantRole;
};
```

`requireTenantContext()` calls `auth.api.getSession({ headers: await headers() })`, loads memberships only for the returned user ID, and passes them to the pure resolver. It never reads organization ownership from the request body.

`requireTenantCapability` calls `hasTenantCapability` and throws `TenantForbiddenError` when denied.

- [ ] **Step 5: Map authorization errors deliberately in API responses**

Update `apiError` so these classes map to:

- Authentication required: 401.
- Organization required: 409 with an onboarding-safe message.
- Forbidden: 403.

Preserve explicit status arguments for Zod/domain errors and 503 as the default for unexpected backend failures.

- [ ] **Step 6: Run focused and full TypeScript verification**

Run:

```powershell
npm run test -- src/lib/auth/tenant-context.test.ts src/lib/auth/permissions.test.ts
npx tsc --noEmit
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/lib/auth src/app/api/_lib.ts
git commit -m "feat: resolve server tenant context"
```

---

### Task 4: Scope database services to the active organization

**Files:**
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/types.ts`
- Create: `src/lib/backend/worker-context.ts`
- Create: `src/lib/backend/tenant-scoping.test.ts`

**Interfaces:**
- Consumes: `TenantContext` from Task 3.
- Produces: `PortfolioTransactionCreateInput`, `WatchlistMutationInput`, `QuantRunCreateInput`, `ResearchRunImportInput`, `WorkerImportContext`, and organization-scoped database services.

- [ ] **Step 1: Write failing query-scoping tests with a mocked Prisma client**

Mock `getPrisma()` and assert service queries contain the server context:

```ts
await getQuantRun({ userId: "user-a", organizationId: "org-a", role: "viewer" }, "run-1");

expect(prisma.quantRun.findFirst).toHaveBeenCalledWith(
  expect.objectContaining({ where: { id: "run-1", organizationId: "org-a" } }),
);
```

Add equivalent assertions for Portfolio load, Watchlist load/upsert, ResearchRun listing/import, QuantRun create/list, and transaction creation. Add a test proving the worker import context uses its configured organization and optional null user.

Add public-research assertions proving `loadInsights()` and `loadAssetIntelligence()` exclude every row linked to a tenant-owned ResearchRun.

- [ ] **Step 2: Run scoping tests and confirm RED**

Run `npm run test -- src/lib/backend/tenant-scoping.test.ts`.

Expected: FAIL because current services do not accept `TenantContext` and still use `DEMO_USER_EMAIL`.

- [ ] **Step 3: Remove the demo-user authorization helper**

Delete `DEMO_USER_EMAIL` and `getDemoUser()` from `db.ts`. Keep the email only in the seed script.

In `types.ts`, extract the existing inline database-service inputs into exported types without changing their fields:

```ts
export type PortfolioTransactionCreateInput = {
  symbol: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee?: number;
  executedAt?: string;
  note?: string | null;
  timeframe?: PortfolioTimeframe;
};

export type WatchlistMutationInput = { symbol: string; alert?: number | null };
export type QuantRunCreateInput = { strategyName: string; parameters?: Record<string, unknown> };

export type ResearchRunImportInput = {
  source: string;
  kind: string;
  symbol?: string | null;
  status?: QuantRunStatus;
  summary?: string | null;
  parameters?: Record<string, unknown>;
  startedAt?: string | null;
  finishedAt?: string | null;
  insights?: Array<{
    source?: string;
    title: string;
    summary: string;
    sentiment: InvestorInsightInput["sentiment"];
    confidence?: number;
    catalyst?: string | null;
    risk?: string | null;
    publishedAt?: string;
  }>;
  evidence?: Array<{
    sourceType: string;
    sourceName: string;
    url?: string | null;
    title: string;
    excerpt: string;
    engagement?: number;
    observedAt?: string;
  }>;
  thesis?: {
    stance: InvestmentThesisInput["stance"];
    conviction: number;
    thesis: string;
    bullCase: string;
    bearCase: string;
    actionItems: string[];
  } | null;
  forecasts?: Array<{
    horizon: string;
    targetPrice: number;
    lowerBound: number;
    upperBound: number;
    confidence: number;
    model: string;
    generatedAt?: string;
  }>;
  providerRuns?: Array<{
    provider: string;
    status: QuantRunStatus;
    recordsFetched?: number;
    errorMessage?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }>;
};
```

Change these signatures:

```ts
loadPortfolioResponse(context: TenantContext, timeframe?: PortfolioTimeframe)
createPortfolioTransaction(context: TenantContext, input: PortfolioTransactionCreateInput)
loadPortfolioPerformance(context: TenantContext, timeframe: PortfolioTimeframe)
loadWatchlist(context: TenantContext)
upsertWatchlistItem(context: TenantContext, input: WatchlistMutationInput)
loadResearchRuns(context: TenantContext)
importResearchRun(context: WorkerImportContext, input: ResearchRunImportInput)
createQuantRun(context: TenantContext, input: QuantRunCreateInput)
listQuantRuns(context: TenantContext)
getQuantRun(context: TenantContext, id: string)
```

- [ ] **Step 4: Scope every query and write**

Portfolio selection must use `organizationId`, not user email. Transaction writes inherit the selected portfolio's organization.

Watchlist queries include both `organizationId` and `userId`; upsert uses the generated compound key `organizationId_userId_assetId`.

Research and Quant list/detail queries include `organizationId`. Creates write both `organizationId` and the context user ID. `getQuantRun` uses `findFirst({ where: { id, organizationId } })` so an ID from another tenant is indistinguishable from a missing ID.

Do not add a fallback to the demo workspace.

Keep the Insights homepage and asset-intelligence API public in this phase, but make their database queries return only global research rows whose `researchRunId` is null. Tenant-owned ResearchRun children must never appear through a public loader. Tenant-private research remains available through the authenticated ResearchRun route until a dedicated private intelligence view is designed.

- [ ] **Step 5: Add a worker-service organization resolver**

Create `src/lib/backend/worker-context.ts` exporting `getWorkerImportContext()`. It reads `QUANT_WORKER_ORGANIZATION_SLUG`, resolves exactly one Organization, and returns `{ organizationId, userId: null }`. Missing or unknown slugs throw a service-configuration error; the worker request cannot choose another organization.

Export:

```ts
export type WorkerImportContext = { organizationId: string; userId: null };
export async function getWorkerImportContext(): Promise<WorkerImportContext>;
```

- [ ] **Step 6: Run backend-focused and portfolio regression tests**

Run:

```powershell
npm run test -- src/lib/backend/tenant-scoping.test.ts src/lib/backend/portfolio.test.ts src/app/api/portfolio/transactions/route.test.ts
npx tsc --noEmit
```

Expected: all tests and TypeScript pass.

- [ ] **Step 7: Commit Task 4**

```powershell
git add src/lib/backend/db.ts src/lib/backend/types.ts src/lib/backend/worker-context.ts src/lib/backend/tenant-scoping.test.ts
git commit -m "feat: scope financial data by organization"
```

---

### Task 5: Enforce authentication and roles in API routes

**Files:**
- Modify: `src/app/api/portfolio/route.ts`
- Modify: `src/app/api/portfolio/performance/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.test.ts`
- Modify: `src/app/api/watchlist/route.ts`
- Modify: `src/app/api/quant/runs/route.ts`
- Modify: `src/app/api/quant/runs/[id]/route.ts`
- Modify: `src/app/api/research/runs/route.ts`
- Modify: `src/app/api/research/runs/import/route.ts`
- Create: `src/app/api/tenant-routes.test.ts`

**Interfaces:**
- Consumes: `requireTenantContext`, `requireTenantCapability`, scoped database functions, and `getWorkerImportContext`.
- Produces: authenticated, role-checked current tenant APIs.

- [ ] **Step 1: Write failing route authorization tests**

Mock tenant context and database services. Assert:

- Missing session returns 401.
- Viewer GET succeeds and passes the exact context to the service.
- Viewer POST returns 403 and never calls the service.
- Editor transaction/watchlist/quant POST succeeds.
- Quant detail from a different organization is returned as 404 by the scoped service.
- Worker import still requires `x-worker-token` and uses `getWorkerImportContext()` rather than a request organization field.

- [ ] **Step 2: Run route tests and confirm RED**

Run:

```powershell
npm run test -- src/app/api/tenant-routes.test.ts src/app/api/portfolio/transactions/route.test.ts
```

Expected: FAIL because routes do not resolve tenant context.

- [ ] **Step 3: Protect read routes**

At the start of each Portfolio, Watchlist, Quant, and Research GET handler:

```ts
const context = await requireTenantContext();
requireTenantCapability(context, "portfolio", "read");
```

Use the matching resource for each route, then pass `context` to the database service. Let `apiError` map auth failures.

- [ ] **Step 4: Protect mutation routes**

Require:

- `portfolio/write` for portfolio transactions.
- `watchlist/write` for watchlist upsert.
- `backtest/create` for QuantRun creation.

Validate role before parsing or performing a write so forbidden callers cannot use the endpoint as a validation oracle.

- [ ] **Step 5: Preserve the separate worker boundary**

Require `QUANT_WORKER_API_TOKEN` in every environment that enables the import route. A missing server token returns a 503 configuration error; a missing or mismatched request token returns 401. Replace direct string equality with `timingSafeEqual` after equal-length validation. After token validation, call `getWorkerImportContext()` and pass it to `importResearchRun`.

Reject any `organizationId` property in the import body by making the Zod object strict.

- [ ] **Step 6: Run all API tests and TypeScript**

Run:

```powershell
npm run test -- src/app/api
npx tsc --noEmit
```

Expected: all API tests and TypeScript pass.

- [ ] **Step 7: Commit Task 5**

```powershell
git add src/app/api
git commit -m "feat: enforce tenant API authorization"
```

---

### Task 6: Add sign-in, onboarding, workspace switching, and protected pages

**Files:**
- Create: `src/components/AuthForm.tsx`
- Create: `src/components/AccountMenu.tsx`
- Create: `src/components/OnboardingClient.tsx`
- Create: `src/app/sign-in/page.tsx`
- Create: `src/app/sign-up/page.tsx`
- Create: `src/app/onboarding/page.tsx`
- Create: `src/lib/auth/page-guard.ts`
- Create: `src/lib/auth/page-guard.test.ts`
- Modify: `src/components/Header.tsx`
- Modify: `src/app/portfolio/page.tsx`
- Modify: `src/app/quant-lab/page.tsx`
- Modify: `src/lib/mvp-ui.test.ts`

**Interfaces:**
- Consumes: `authClient`, organization client plugin, server `auth`, and tenant resolver.
- Produces: functional email/password entry, personal workspace onboarding, active-workspace selection, sign-out, and protected Portfolio/Quant pages.

- [ ] **Step 1: Write failing page-guard tests**

Create a pure destination helper and test:

```ts
const sessionUser = { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } };
const membership = { organizationId: "org-1", role: "owner", createdAt: new Date(0) };

expect(authDestination({ session: null, memberships: [] }, "/portfolio")).toBe(
  "/sign-in?returnTo=%2Fportfolio",
);
expect(authDestination({ session: sessionUser, memberships: [] }, "/portfolio")).toBe("/onboarding");
expect(authDestination({ session: sessionUser, memberships: [membership] }, "/portfolio")).toBeNull();
```

Reject external `returnTo` values; only paths beginning with one `/` and not `//` are allowed.

- [ ] **Step 2: Run the page-guard test and confirm RED**

Run `npm run test -- src/lib/auth/page-guard.test.ts`.

Expected: FAIL because the page guard does not exist.

- [ ] **Step 3: Implement the server page guard**

Create `requireTenantPage(returnTo)` that validates the database session, loads memberships, redirects unauthenticated users to sign-in, redirects users without a membership to onboarding, and returns `TenantContext` otherwise. Do not rely on cookie existence alone.

- [ ] **Step 4: Build one reusable auth form**

`AuthForm` supports `sign-in` and `sign-up` modes with name only in sign-up, email, password, pending state, inline Better Auth errors, and safe `returnTo` navigation.

For sign-up:

1. Call `authClient.signUp.email`.
2. Navigate to `/onboarding`.

For sign-in:

1. Call `authClient.signIn.email`.
2. Navigate to safe `returnTo` or `/portfolio`.

Use existing Input, Label, Button, Card, and Sonner components. Do not add a form library.

- [ ] **Step 5: Build idempotent workspace onboarding**

The server onboarding page requires a database session and lists organizations through the server auth API. For each organization returned to the signed-in user, it calls idempotent `provisionOrganizationDefaults` before passing the session and organization list to `OnboardingClient`. This repairs an organization whose post-create hook was interrupted.

`OnboardingClient` owns cookie-mutating client calls. If at least one organization exists, it calls `authClient.organization.setActive` for the first organization and redirects to Portfolio. Otherwise it renders a form that creates one organization with a normalized slug, sets it active, and redirects.

If organization creation succeeds but active-session update fails, reloading onboarding receives the existing organization from the server and completes activation instead of creating a duplicate.

- [ ] **Step 6: Replace the static avatar with an account/workspace menu**

`AccountMenu` displays:

- Signed-in user's name/email.
- Active organization.
- Organization switcher using `authClient.organization.setActive`.
- Link to onboarding/create workspace.
- Sign-out action.

When signed out, Header shows a Sign in button. Preserve the current mobile menu, theme toggle, touch targets, and overflow fixes.

- [ ] **Step 7: Protect user-owned pages**

Make Portfolio and Quant Lab page functions async and call:

```ts
await requireTenantPage("/portfolio");
```

or the corresponding Quant route before rendering client components. Keep the Insights homepage public.

- [ ] **Step 8: Update rendered UI contract tests**

Extend `mvp-ui.test.ts` to assert sign-in/sign-up/onboarding pages have unique headings and the Header no longer renders the hard-coded `RA` avatar as the only account control.

- [ ] **Step 9: Run focused UI tests and build**

Run:

```powershell
npm run test -- src/lib/auth/page-guard.test.ts src/lib/mvp-ui.test.ts
npx tsc --noEmit
npm run build
```

Expected: tests, TypeScript, and production build exit 0.

- [ ] **Step 10: Commit Task 6**

```powershell
git add src/components/AuthForm.tsx src/components/AccountMenu.tsx src/components/OnboardingClient.tsx src/components/Header.tsx src/app/sign-in src/app/sign-up src/app/onboarding src/app/portfolio/page.tsx src/app/quant-lab/page.tsx src/lib/auth/page-guard.ts src/lib/auth/page-guard.test.ts src/lib/mvp-ui.test.ts
git commit -m "feat: add authenticated workspace experience"
```

---

### Task 7: Prove tenant isolation and complete phase verification

**Files:**
- Create: `src/lib/backend/tenant-isolation.integration.test.ts`
- Create: `vitest.integration.config.ts`
- Modify: `package.json`
- Modify only files required by proven verification failures.

**Interfaces:**
- Consumes: migrated PostgreSQL schema, Better Auth APIs, tenant context, scoped database services, and rendered auth flow.
- Produces: repeatable database and browser evidence that two organizations cannot cross-read or cross-write current tenant data.

- [ ] **Step 1: Add a dedicated integration-test command**

Add:

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

The integration config includes only `*.integration.test.ts`, runs serially, and requires `TEST_DATABASE_URL`. It must refuse to run when `TEST_DATABASE_URL === DATABASE_URL` to protect development data.

- [ ] **Step 2: Write a two-organization database isolation test**

In a clean test database:

1. Create user A/org A and user B/org B.
2. Create one Portfolio and one QuantRun per organization.
3. Call scoped services using context A and assert only A resources are returned.
4. Request B's QuantRun ID using context A and assert the service returns the same not-found behavior as a random ID.
5. Attempt a transaction using context A against B's portfolio and assert no row changes.
6. Repeat the read assertions for context B.

Delete fixtures in `afterAll`; the command operates only against the dedicated test database.

- [ ] **Step 3: Run migration and integration verification**

Run against the dedicated test database:

```powershell
$previousDatabaseUrl = $env:DATABASE_URL
try {
  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "Prisma migration failed." }
  npm run test:integration
  if ($LASTEXITCODE -ne 0) { throw "Integration tests failed." }
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
}
```

Expected: migrations apply and all isolation assertions pass. Restore the development `DATABASE_URL` after the command.

- [ ] **Step 4: Run deterministic repository gates**

With bundled Node 24 and the development environment restored, run:

```powershell
npm run test -- --run
npx tsc --noEmit
npm run lint
npm run build
git diff --check
npx prisma validate
npx prisma migrate status
```

Expected: tests and TypeScript exit 0; lint has zero errors; build, diff check, Prisma validation, and migration status exit 0.

- [ ] **Step 5: Run browser authentication and isolation QA**

Start a fresh local production server after the successful build. Through the in-app Browser verify:

1. A signed-out visit to `/portfolio` redirects to sign-in.
2. Sign-up creates a user and onboarding creates a workspace.
3. Sign-in persists across refresh.
4. Workspace switch changes the active tenant and refreshes Portfolio/Quant data.
5. A copied API resource ID from another organization returns 404/403 and never renders its data.
6. A viewer can open Portfolio and Quant Lab but cannot submit mutations.
7. Sign-out invalidates protected navigation.
8. Desktop 1440px and mobile 390px have no page overflow, broken menu, console error, or framework overlay.

Use test-only users and remove them through Better Auth/Prisma after QA. Do not reset the development database unless explicitly authorized.

- [ ] **Step 6: Commit proven verification fixes and test harness**

Stage the integration test/config/package script plus only files changed to fix observed failures:

Stage `src/lib/backend/tenant-isolation.integration.test.ts`, `vitest.integration.config.ts`, `package.json`, and `package-lock.json`. If verification produced fixes, inspect `git status --short` and stage each reviewed fix by its literal path; never use `git add .` or a wildcard.

```powershell
git add src/lib/backend/tenant-isolation.integration.test.ts vitest.integration.config.ts package.json package-lock.json
git commit -m "test: verify tenant isolation"
```

Do not create an empty commit.

- [ ] **Step 7: Run final verification before phase handoff**

Invoke `superpowers:verification-before-completion`, rerun every command from Step 4 plus `npm run test:integration`, and inspect `git status --short` and `git log -8 --oneline` before claiming the phase complete.
