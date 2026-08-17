"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n/context";

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
  const { t } = useI18n();
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
          setError(result.error.message ?? t("auth.activationError"));
          setPending(false);
          return;
        }

        router.replace("/portfolio");
        router.refresh();
      });
  }, [createNew, organizations, router, t]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("organizationName") ?? "").trim();
    const slug = organizationSlug(name);
    if (!slug) {
      setError(t("auth.workspaceNameError"));
      setPending(false);
      return;
    }

    const created = await authClient.organization.create({ name, slug });
    if (created.error || !created.data) {
      setError(created.error?.message ?? t("auth.workspaceCreateError"));
      setPending(false);
      return;
    }

    const activated = await authClient.organization.setActive({
      organizationId: created.data.id,
    });
    if (activated.error) {
      setError(activated.error.message ?? t("auth.workspaceReloadError"));
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
          <CardTitle className="text-2xl">{t("auth.onboardingHeading")}</CardTitle>
          <CardDescription>
            {organizations.length > 0 && !createNew
              ? t("auth.activatingWorkspace")
              : t("auth.onboardingDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {organizations.length > 0 && !createNew ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" />
              {t("auth.openingWorkspace", { name: organizations[0]?.name ?? "" })}
            </div>
          ) : (
            <form className="flex flex-col gap-5" onSubmit={createWorkspace}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="organizationName">{t("auth.workspaceName")}</Label>
                <Input
                  id="organizationName"
                  name="organizationName"
                  placeholder={t("auth.workspacePlaceholder")}
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
                {t("auth.createWorkspace")}
              </Button>
            </form>
          )}
          {organizations.length > 0 && !createNew && error ? (
            <div className="mt-5 flex flex-col gap-3">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                {t("auth.tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
