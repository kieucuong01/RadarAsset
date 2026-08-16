import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a private DataVest workspace.",
};

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
