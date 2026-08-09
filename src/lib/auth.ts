import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth/minimal";
import { organization } from "better-auth/plugins";

import { requireBetterAuthSecret, requireServerEnv } from "@/lib/auth/env";
import { organizationAccessControl, organizationRoles } from "@/lib/auth/permissions";
import { provisionOrganizationDefaults } from "@/lib/backend/organization-provisioning";
import { getPrisma } from "@/lib/db/prisma";

export const auth = betterAuth({
  baseURL: requireServerEnv("BETTER_AUTH_URL"),
  secret: requireBetterAuthSecret(),
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  user: { modelName: "AppUser" },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  plugins: [
    organization({
      ac: organizationAccessControl,
      roles: organizationRoles,
      creatorRole: "owner",
      organizationLimit: 10,
      membershipLimit: 100,
      schema: {
        member: {
          modelName: "Membership",
        },
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization: createdOrganization, user }) => {
          await provisionOrganizationDefaults({
            organizationId: createdOrganization.id,
            userId: user.id,
          });
        },
      },
    }),
  ],
});
