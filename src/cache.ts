interface Entry<T> {
  value: T;
  staleAt: number;
}

// Cloudflare KV rejects expirationTtl below 60s — clamp here so a short-TTL call fails
// loud in a test (staleAt/behavior surprise) rather than 502ing in production.
const KV_MIN_TTL_SECONDS = 60;

export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<{ value: T; staleAt: number }> {
  const clampedTtl = Math.max(KV_MIN_TTL_SECONDS, ttlSeconds);
  const hit = await kv.get(key);
  if (hit) {
    const entry = JSON.parse(hit) as Entry<T>;
    return { value: entry.value, staleAt: entry.staleAt };
  }
  const value = await produce();
  const staleAt = Date.now() + clampedTtl * 1000;
  const entry: Entry<T> = { value, staleAt };
  await kv.put(key, JSON.stringify(entry), { expirationTtl: clampedTtl });
  return { value, staleAt };
}
