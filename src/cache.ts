interface Entry<T> {
  value: T;
  staleAt: number;
}

export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<{ value: T; staleAt: number }> {
  const hit = await kv.get(key);
  if (hit) {
    const entry = JSON.parse(hit) as Entry<T>;
    return { value: entry.value, staleAt: entry.staleAt };
  }
  const value = await produce();
  const staleAt = Date.now() + ttlSeconds * 1000;
  const entry: Entry<T> = { value, staleAt };
  await kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds });
  return { value, staleAt };
}
