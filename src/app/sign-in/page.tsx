import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { safeReturnTo } from "@/lib/auth/navigation";

export const metadata: Metadata = {
  title: "Đăng nhập",
  description: "Đăng nhập workspace DataVest của bạn.",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return <AuthForm mode="sign-in" returnTo={safeReturnTo(returnTo)} />;
}
