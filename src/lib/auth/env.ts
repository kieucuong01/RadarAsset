export function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function requireBetterAuthSecret(): string {
  const secret = requireServerEnv("BETTER_AUTH_SECRET");

  if (process.env.NODE_ENV !== "test" && secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }

  return secret;
}
