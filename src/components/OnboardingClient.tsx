"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { AUTH_PAGE_COPY } from "@/lib/mvp-ui";

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
};

function organizationSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function OnboardingClient({
  organizations,
  createNew,
}: {
  organizations: OrganizationSummary[];
  createNew: boolean;
}) {
  const router = useRouter();
  const activationStarted = useRef(false);
  const [pending, setPending] = useState(organizations.length > 0 && !createNew);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (createNew) return;
    const existingOrganization = organizations[0];
    if (!existingOrganization || activationStarted.current) return;
    activationStarted.current = true;

    void authClient.organization
      .setActive({ organizationId: existingOrganization.id })
      .then((result) => {
        if (result.error) {
          setError(
            result.error.message ?? "We could not activate your workspace. Please try again.",
          );
          setPending(false);
          return;
        }

        router.replace("/portfolio");
        router.refresh();
      });
  }, [createNew, organizations, router]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("organizationName") ?? "").trim();
    const slug = organizationSlug(name);
    if (!slug) {
      setError("Enter a workspace name with at least one letter or number.");
      setPending(false);
      return;
    }

    const created = await authClient.organization.create({ name, slug });
    if (created.error || !created.data) {
      setError(created.error?.message ?? "We could not create your workspace. Please try again.");
      setPending(false);
      return;
    }

    const activated = await authClient.organization.setActive({
      organizationId: created.data.id,
    });
    if (activated.error) {
      setError(
        activated.error.message ?? "Workspace created. Reload this page to finish activation.",
      );
      setPending(false);
      return;
    }

    router.replace("/portfolio");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{AUTH_PAGE_COPY.onboarding.heading}</CardTitle>
          <CardDescription>
            {organizations.length > 0 && !createNew
              ? "Activating your existing workspace."
              : AUTH_PAGE_COPY.onboarding.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {organizations.length > 0 && !createNew ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" />
              Opening {organizations[0]?.name}
            </div>
          ) : (
            <form className="flex flex-col gap-5" onSubmit={createWorkspace}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="organizationName">Workspace name</Label>
                <Input
                  id="organizationName"
                  name="organizationName"
                  placeholder="My investment workspace"
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={pending}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : null}
                Create workspace
              </Button>
            </form>
          )}
          {organizations.length > 0 && !createNew && error ? (
            <div className="mt-5 flex flex-col gap-3">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
