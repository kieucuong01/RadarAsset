import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Tạo tài khoản",
  description: "Tạo tài khoản và workspace DataVest riêng tư.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
