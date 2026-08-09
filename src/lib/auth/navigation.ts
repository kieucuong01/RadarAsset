export function safeReturnTo(value: string | null | undefined, fallback = "/portfolio"): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function shouldCreateWorkspace(organizationCount: number, createNew: boolean): boolean {
  return organizationCount === 0 || createNew;
}
