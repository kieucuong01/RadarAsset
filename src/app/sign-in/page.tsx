import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { safeReturnTo } from "@/lib/auth/navigation";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your DataVest workspace.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return <AuthForm mode="sign-in" returnTo={safeReturnTo(returnTo)} />;
}
