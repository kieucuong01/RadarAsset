import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingClient } from "@/components/OnboardingClient";
import { provisionOrganizationDefaults } from "@/lib/backend/organization-provisioning";
import { shouldCreateWorkspace } from "@/lib/auth/navigation";

export const metadata: Metadata = {
  title: "Workspace setup",
  description: "Create or activate your DataVest workspace.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const [{ auth }, requestHeaders, query] = await Promise.all([
    import("@/lib/auth"),
    headers(),
    searchParams,
  ]);
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user.id) {
    redirect("/sign-in?returnTo=%2Fonboarding");
  }

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });
  await Promise.all(
    organizations.map((organization) =>
      provisionOrganizationDefaults({
        organizationId: organization.id,
        userId: session.user.id,
      }),
    ),
  );

  return (
    <OnboardingClient
      createNew={shouldCreateWorkspace(organizations.length, query.create === "1")}
      organizations={organizations.map(({ id, name, slug }) => ({
        id,
        name,
        slug,
      }))}
    />
  );
}
