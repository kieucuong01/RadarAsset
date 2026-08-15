type CacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const DEFAULT_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry<unknown>>();

export function cachedRequest<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.promise;

  const promise = loader().catch((error: unknown) => {
    clearCachedRequest(key);
    throw error;
  });
  cache.set(key, { expiresAt: now + ttlMs, promise });
  return promise;
}

export function clearCachedRequest(key: string) {
  cache.delete(key);
}

export function clearCachedRequests(prefix?: string) {
  if (!prefix) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
