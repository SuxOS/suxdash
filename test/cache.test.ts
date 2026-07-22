import { describe, it, expect, vi } from "vitest";
import { cached } from "../src/cache";

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  } as unknown as KVNamespace;
}

describe("cached", () => {
  it("calls produce on a miss and stores the value", async () => {
    const kv = fakeKV();
    const produce = vi.fn(async () => ({ n: 1 }));
    const { value } = await cached(kv, "k", 60, produce);
    expect(value).toEqual({ n: 1 });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it("returns the cached value on a hit without calling produce", async () => {
    const kv = fakeKV();
    await cached(kv, "k", 60, async () => ({ n: 1 }));
    const produce2 = vi.fn(async () => ({ n: 2 }));
    const { value } = await cached(kv, "k", 60, produce2);
    expect(value).toEqual({ n: 1 });
    expect(produce2).not.toHaveBeenCalled();
  });
});
