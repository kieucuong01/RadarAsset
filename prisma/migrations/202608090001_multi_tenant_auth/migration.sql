-- Add Better Auth user fields.
ALTER TABLE "app_users"
ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "image" TEXT;

-- Create Better Auth core tables.
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,
    "active_organization_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_accounts" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

-- Create organization plugin tables.
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "inviter_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organization_memberships_user_id_organization_id_key"
    ON "organization_memberships"("user_id", "organization_id");

-- Add tenant ownership as nullable so existing rows can be preserved.
ALTER TABLE "portfolios" ADD COLUMN "organization_id" UUID;
ALTER TABLE "quant_runs" ADD COLUMN "organization_id" UUID;
ALTER TABLE "research_runs" ADD COLUMN "organization_id" UUID;
ALTER TABLE "watchlist_items" ADD COLUMN "organization_id" UUID;

-- Provision the legacy demo user's workspace when that user exists.
INSERT INTO "organizations" ("id", "name", "slug", "created_at")
SELECT gen_random_uuid(), 'RadarAsset Demo', 'demo-workspace', CURRENT_TIMESTAMP
WHERE EXISTS (
    SELECT 1 FROM "app_users" WHERE "email" = 'demo@radarasset.local'
)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "organization_memberships" (
    "id",
    "organization_id",
    "user_id",
    "role",
    "created_at"
)
SELECT
    gen_random_uuid(),
    organization."id",
    app_user."id",
    'owner',
    CURRENT_TIMESTAMP
FROM "organizations" AS organization
JOIN "app_users" AS app_user
    ON app_user."email" = 'demo@radarasset.local'
WHERE organization."slug" = 'demo-workspace'
ON CONFLICT ("user_id", "organization_id") DO NOTHING;

UPDATE "portfolios" AS portfolio
SET "organization_id" = organization."id"
FROM "organizations" AS organization
JOIN "app_users" AS app_user
    ON app_user."email" = 'demo@radarasset.local'
WHERE organization."slug" = 'demo-workspace'
  AND portfolio."user_id" = app_user."id"
  AND portfolio."organization_id" IS NULL;

UPDATE "watchlist_items" AS watchlist_item
SET "organization_id" = organization."id"
FROM "organizations" AS organization
JOIN "app_users" AS app_user
    ON app_user."email" = 'demo@radarasset.local'
WHERE organization."slug" = 'demo-workspace'
  AND watchlist_item."user_id" = app_user."id"
  AND watchlist_item."organization_id" IS NULL;

UPDATE "research_runs" AS research_run
SET "organization_id" = organization."id"
FROM "organizations" AS organization
JOIN "app_users" AS app_user
    ON app_user."email" = 'demo@radarasset.local'
WHERE organization."slug" = 'demo-workspace'
  AND research_run."user_id" = app_user."id"
  AND research_run."organization_id" IS NULL;

UPDATE "quant_runs" AS quant_run
SET "organization_id" = organization."id"
FROM "organizations" AS organization
JOIN "app_users" AS app_user
    ON app_user."email" = 'demo@radarasset.local'
WHERE organization."slug" = 'demo-workspace'
  AND quant_run."user_id" = app_user."id"
  AND quant_run."organization_id" IS NULL;

-- Fail closed if any legacy row could not be assigned to a known workspace.
ALTER TABLE "portfolios" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "quant_runs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "research_runs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "watchlist_items" ALTER COLUMN "organization_id" SET NOT NULL;

-- Better Auth indexes and constraints.
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions"("token");
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_active_organization_id_idx" ON "auth_sessions"("active_organization_id");
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts"("user_id");
CREATE UNIQUE INDEX "auth_accounts_provider_id_account_id_key"
    ON "auth_accounts"("provider_id", "account_id");
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications"("identifier");
CREATE INDEX "organization_memberships_organization_id_role_idx"
    ON "organization_memberships"("organization_id", "role");
CREATE INDEX "organization_invitations_organization_id_status_idx"
    ON "organization_invitations"("organization_id", "status");
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations"("email");
CREATE INDEX "organization_invitations_inviter_id_idx"
    ON "organization_invitations"("inviter_id");

-- Tenant indexes and unique ownership constraints.
DROP INDEX "watchlist_items_user_id_asset_id_key";
CREATE INDEX "portfolios_organization_id_idx" ON "portfolios"("organization_id");
CREATE UNIQUE INDEX "portfolios_organization_id_name_key"
    ON "portfolios"("organization_id", "name");
CREATE INDEX "quant_runs_organization_id_created_at_idx"
    ON "quant_runs"("organization_id", "created_at" DESC);
CREATE INDEX "research_runs_organization_id_created_at_idx"
    ON "research_runs"("organization_id", "created_at" DESC);
CREATE INDEX "watchlist_items_organization_id_idx"
    ON "watchlist_items"("organization_id");
CREATE UNIQUE INDEX "watchlist_items_organization_id_user_id_asset_id_key"
    ON "watchlist_items"("organization_id", "user_id", "asset_id");

-- Foreign keys.
ALTER TABLE "auth_sessions"
ADD CONSTRAINT "auth_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_accounts"
ADD CONSTRAINT "auth_accounts_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
ADD CONSTRAINT "organization_memberships_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
ADD CONSTRAINT "organization_memberships_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "organization_invitations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "organization_invitations_inviter_id_fkey"
FOREIGN KEY ("inviter_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portfolios"
ADD CONSTRAINT "portfolios_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watchlist_items"
ADD CONSTRAINT "watchlist_items_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "research_runs"
ADD CONSTRAINT "research_runs_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quant_runs"
ADD CONSTRAINT "quant_runs_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
