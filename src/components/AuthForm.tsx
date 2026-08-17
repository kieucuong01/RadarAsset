"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { safeReturnTo } from "@/lib/auth/navigation";
import { useI18n } from "@/lib/i18n/context";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  returnTo?: string;
};

export function AuthForm({ mode, returnTo }: AuthFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";
  const { t } = useI18n();
  const copy = isSignUp
    ? { heading: t("auth.signUpHeading"), description: t("auth.signUpDescription") }
    : { heading: t("auth.signInHeading"), description: t("auth.signInDescription") };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const result = isSignUp
      ? await authClient.signUp.email({
          name: String(formData.get("name") ?? "").trim(),
          email,
          password,
        })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? t("auth.authenticationError"));
      setPending(false);
      return;
    }

    router.push(isSignUp ? "/onboarding" : safeReturnTo(returnTo, "/portfolio"));
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{copy.heading}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            {isSignUp ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">{t("auth.name")}</Label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={120}
                  disabled={pending}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                disabled={pending}
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                minLength={12}
                maxLength={128}
                disabled={pending}
                aria-invalid={error ? true : undefined}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {isSignUp ? t("auth.createAccount") : t("auth.signIn")}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          {isSignUp ? t("auth.alreadyHaveAccount") : t("auth.newToDataVest")}
          <Button asChild variant="link" className="px-2">
            <Link href={isSignUp ? "/sign-in" : "/sign-up"}>
              {isSignUp ? t("auth.signIn") : t("auth.createAccount")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
