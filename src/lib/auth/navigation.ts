const AUTH_RETURN_PATHS = new Set(["/portfolio", "/quant-lab", "/onboarding"]);
const LOCAL_ORIGIN = "http://radarasset.local";

function hasUnsafeUrlCharacters(value: string): boolean {
  return (
    value.includes("\\") ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

export function safeReturnTo(value: string | null | undefined, fallback = "/portfolio"): string {
  const fallbackPath = AUTH_RETURN_PATHS.has(fallback.split(/[?#]/, 1)[0] ?? "")
    ? fallback
    : "/portfolio";
  if (!value || hasUnsafeUrlCharacters(value)) return fallbackPath;

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || hasUnsafeUrlCharacters(decoded)) {
      return fallbackPath;
    }

    const target = new URL(value, LOCAL_ORIGIN);
    if (target.origin !== LOCAL_ORIGIN || !AUTH_RETURN_PATHS.has(target.pathname)) {
      return fallbackPath;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallbackPath;
  }
}

export function shouldCreateWorkspace(organizationCount: number, createNew: boolean): boolean {
  return organizationCount === 0 || createNew;
}
