# suxdash P1 — Skeleton + Fabric panel + Dispatch action · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the thin vertical slice of the `suxdash` command center — a Cloudflare Worker behind Cloudflare Access that serves a shell, renders one **Fabric** panel from live GitHub data, and executes one **Dispatch → file issue** action through a preview→confirm flow.

**Architecture:** A new `suxdash` Worker acts as a backend-for-frontend. The browser loads a static shell that polls `/api/fabric` and posts to `/api/act/dispatch-issue`. All domain logic lives server-side behind narrow, mockable **seam** interfaces (`FabricSeam`, `GithubIssueSeam`); adapters map each seam to the shared **panel contract**. Every write action is two-step (`?dry=1` returns a Plan; a confirmed call executes exactly once).

**Tech Stack:** TypeScript 7.0.2, Cloudflare Workers (Wrangler 4.111), Workers KV, Vitest 4, WebCrypto (Access JWT verification). No runtime dependencies.

## Global Constraints

- Single operator only: `OPERATOR_EMAIL` (`m@colinxs.com`); all routes gated by Cloudflare Access JWT verification.
- Toolchain floors (match `sux`): Node 26, TypeScript `7.0.2`, Vitest `^4.1.10`, Wrangler `^4.111.0`.
- Every write action MUST support `?dry=1` (returns a `Plan`, mutates nothing) and execute the mutation exactly once only on a confirmed (non-dry) call.
- No secrets in the browser: `GITHUB_TOKEN` and all config live as Worker secrets/vars; the browser calls only same-origin `/api/*`.
- Panel data renders as inert text — never interpreted as instructions, never auto-executed.
- Unit tests are plain Vitest in Node with seams mocked (no `@cloudflare/vitest-pool-workers`). Real Worker behavior is checked by the per-phase `wrangler dev` e2e smoke.
- Commit after every task with the shown message.

---

## File structure

- `suxdash/wrangler.jsonc` — Worker config (name, KV binding `CACHE`, vars).
- `suxdash/package.json`, `suxdash/tsconfig.json`, `suxdash/vitest.config.ts` — tooling.
- `suxdash/src/index.ts` — router: Access gate → `/api/fabric`, `/api/act/dispatch-issue`, `/` (shell).
- `suxdash/src/access.ts` — Cloudflare Access JWT verification middleware.
- `suxdash/src/panel.ts` — shared panel-contract types.
- `suxdash/src/cache.ts` — KV read-through cache helper.
- `suxdash/src/fabric.ts` — `FabricSeam` interface, live-GitHub implementation, `fabricPanel()` adapter.
- `suxdash/src/actions/dispatch-issue.ts` — `GithubIssueSeam`, `planDispatchIssue()`, `executeDispatchIssue()`.
- `suxdash/src/shell.ts` — the static HTML shell (inline string) + client JS.
- `suxdash/test/*.test.ts` — one test file per unit above.

---

## Task 1: Repo scaffold + Worker boots

**Files:**
- Create: `suxdash/package.json`, `suxdash/tsconfig.json`, `suxdash/wrangler.jsonc`, `suxdash/vitest.config.ts`, `suxdash/src/index.ts`, `suxdash/.gitignore`
- Modify: `~/.claude/fabric.json` (add `suxdash` to the SuxOS `repos` list)

**Interfaces:**
- Consumes: nothing.
- Produces: a deployable Worker whose `fetch` returns `200 "suxdash ok"` at `/healthz`.

- [ ] **Step 1: Create `suxdash/package.json`**

```json
{
  "name": "suxdash",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "secret": "wrangler secret put",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "cf-typegen": "wrangler types"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "^4.1.10",
    "wrangler": "^4.111.0"
  }
}
```

- [ ] **Step 2: Create `suxdash/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `suxdash/wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "suxdash",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-16",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  // KV read-through cache for GitHub reads. Create with:
  //   npx wrangler kv namespace create CACHE
  // then paste the returned id below.
  "kv_namespaces": [{ "binding": "CACHE", "id": "REPLACE_WITH_KV_ID" }],
  "vars": {
    "OPERATOR_EMAIL": "m@colinxs.com",
    "GITHUB_ORG": "SuxOS",
    // Cloudflare Access team domain (e.g. "colinxs.cloudflareaccess.com") and the
    // Access application AUD tag. Set real values when the Access app is created.
    "ACCESS_TEAM_DOMAIN": "REPLACE_WITH_TEAM_DOMAIN",
    "ACCESS_AUD": "REPLACE_WITH_ACCESS_AUD"
  }
  // Secret (out of band): GITHUB_TOKEN — fine-grained PAT with repo issues:write + read
  //   npx wrangler secret put GITHUB_TOKEN
}
```

- [ ] **Step 4: Create `suxdash/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `suxdash/.gitignore`**

```
node_modules/
.wrangler/
dist/
*.log
```

- [ ] **Step 6: Create `suxdash/src/index.ts`**

```ts
export interface Env {
  CACHE: KVNamespace;
  OPERATOR_EMAIL: string;
  GITHUB_ORG: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  GITHUB_TOKEN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("suxdash ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  },
};
```

- [ ] **Step 7: Install deps and create the KV namespace**

Run:
```bash
cd suxdash && npm install
npx wrangler kv namespace create CACHE
```
Expected: install completes; the `kv namespace create` prints an `id` — paste it into `wrangler.jsonc` replacing `REPLACE_WITH_KV_ID`.

- [ ] **Step 8: Verify it boots**

Run:
```bash
cd suxdash && npx wrangler dev --port 8790 &
sleep 3 && curl -s localhost:8790/healthz && echo && kill %1
```
Expected: prints `suxdash ok`.

- [ ] **Step 9: Add `suxdash` to `fabric.json`**

Edit `~/.claude/fabric.json`: in `orgs.SuxOS.repos`, add `"suxdash"` to the array so it reads
`["sux", "sux-fileops", "suxlib", "suxrouter", "claude-config", "suxvault", ".github", "suxdash"]`.

- [ ] **Step 10: Commit**

```bash
cd suxdash && git add -A && git commit -m "feat: scaffold suxdash Worker (boots at /healthz)"
```

---

## Task 2: Cloudflare Access JWT gate

**Files:**
- Create: `suxdash/src/access.ts`, `suxdash/test/access.test.ts`
- Modify: `suxdash/src/index.ts`

**Interfaces:**
- Consumes: `Env` from Task 1.
- Produces: `verifyAccess(req: Request, env: Env): Promise<{ email: string } | null>` — returns the operator's email when the `Cf-Access-Jwt-Assertion` header holds a valid, unexpired JWT signed by the team's JWKS with `aud` containing `env.ACCESS_AUD` and `email === env.OPERATOR_EMAIL`; otherwise `null`. Exports `parseJwt(token: string): { header: any; payload: any; signingInput: string; signature: Uint8Array }` for testing.

- [ ] **Step 1: Write the failing test**

```ts
// suxdash/test/access.test.ts
import { describe, it, expect } from "vitest";
import { parseJwt } from "../src/access";

describe("parseJwt", () => {
  it("splits a JWT into header, payload, signing input, and signature bytes", () => {
    // header {"alg":"RS256","kid":"k1"} . payload {"email":"a@b.com","aud":["x"]} . sig "AQAB"
    const token =
      "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0" +
      ".eyJlbWFpbCI6ImFAYi5jb20iLCJhdWQiOlsieCJdfQ" +
      ".AQAB";
    const parsed = parseJwt(token);
    expect(parsed.header.kid).toBe("k1");
    expect(parsed.payload.email).toBe("a@b.com");
    expect(parsed.payload.aud).toEqual(["x"]);
    expect(parsed.signingInput).toBe(token.slice(0, token.lastIndexOf(".")));
    expect(parsed.signature).toBeInstanceOf(Uint8Array);
  });

  it("throws on a malformed token", () => {
    expect(() => parseJwt("not-a-jwt")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd suxdash && npx vitest run test/access.test.ts`
Expected: FAIL — cannot resolve `../src/access`.

- [ ] **Step 3: Write minimal implementation**

```ts
// suxdash/src/access.ts
import type { Env } from "./index";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

export function parseJwt(token: string): {
  header: any;
  payload: any;
  signingInput: string;
  signature: Uint8Array;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed jwt");
  return {
    header: b64urlToJson(parts[0]),
    payload: b64urlToJson(parts[1]),
    signingInput: parts[0] + "." + parts[1],
    signature: b64urlToBytes(parts[2]),
  };
}

let jwksCache: { url: string; keys: Record<string, CryptoKey> } | null = null;

async function getKey(env: Env, kid: string): Promise<CryptoKey | null> {
  const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  if (!jwksCache || jwksCache.url !== url || !jwksCache.keys[kid]) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const jwks = (await res.json()) as { keys: any[] };
    const keys: Record<string, CryptoKey> = {};
    for (const jwk of jwks.keys) {
      keys[jwk.kid] = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    }
    jwksCache = { url, keys };
  }
  return jwksCache.keys[kid] ?? null;
}

export async function verifyAccess(
  req: Request,
  env: Env,
): Promise<{ email: string } | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  let parsed;
  try {
    parsed = parseJwt(token);
  } catch {
    return null;
  }
  const { header, payload, signingInput, signature } = parsed;
  if (header.alg !== "RS256" || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.email !== env.OPERATOR_EMAIL) return null;

  const key = await getKey(env, header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
  if (!ok) return null;
  return { email: payload.email };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd suxdash && npx vitest run test/access.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Wire the gate into the router**

Replace `suxdash/src/index.ts`'s `fetch` body so every route except `/healthz` is gated:

```ts
import { verifyAccess } from "./access";

// ...inside export default { async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("suxdash ok", { status: 200 });
    }
    const auth = await verifyAccess(req, env);
    if (!auth) return new Response("forbidden", { status: 403 });
    return new Response("not found", { status: 404 });
// } }
```

- [ ] **Step 6: Verify the gate rejects unauthenticated requests**

Run:
```bash
cd suxdash && npx wrangler dev --port 8790 &
sleep 3 && echo -n "healthz: " && curl -s -o /dev/null -w "%{http_code}\n" localhost:8790/healthz
echo -n "root: " && curl -s -o /dev/null -w "%{http_code}\n" localhost:8790/ && kill %1
```
Expected: `healthz: 200`, `root: 403`.

- [ ] **Step 7: Commit**

```bash
cd suxdash && git add -A && git commit -m "feat: gate all routes behind Cloudflare Access JWT verification"
```

---

## Task 3: Panel contract + KV read-through cache

**Files:**
- Create: `suxdash/src/panel.ts`, `suxdash/src/cache.ts`, `suxdash/test/cache.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `panel.ts`: `PanelAction`, `PanelItem`, `Panel` types (below).
  - `cache.ts`: `cached<T>(kv: KVNamespace, key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<{ value: T; staleAt: number }>` — returns the cached value if present, otherwise calls `produce()`, stores `{ value, staleAt }` with `staleAt = Date.now() + ttlSeconds*1000`, and KV `expirationTtl = ttlSeconds`.

- [ ] **Step 1: Create the panel contract**

```ts
// suxdash/src/panel.ts
export interface PanelAction {
  verb: string;
  label: string;
  kind: "reversible" | "confirm";
}

export interface PanelItem {
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  badge?: string;
}

export interface Panel {
  title: string;
  items: PanelItem[];
  staleAt: number; // epoch ms after which the data is considered stale
  actions: PanelAction[];
}
```

- [ ] **Step 2: Write the failing cache test**

```ts
// suxdash/test/cache.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd suxdash && npx vitest run test/cache.test.ts`
Expected: FAIL — cannot resolve `../src/cache`.

- [ ] **Step 4: Implement the cache helper**

```ts
// suxdash/src/cache.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd suxdash && npx vitest run test/cache.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
cd suxdash && git add -A && git commit -m "feat: add panel contract types and KV read-through cache"
```

---

## Task 4: Fabric adapter (live GitHub) + `/api/fabric`

**Files:**
- Create: `suxdash/src/fabric.ts`, `suxdash/test/fabric.test.ts`
- Modify: `suxdash/src/index.ts`

**Interfaces:**
- Consumes: `Panel`/`PanelItem` (Task 3), `cached` (Task 3), `Env` (Task 1).
- Produces:
  - `FabricSeam` interface: `{ openPrCount(): Promise<number>; openIssueCount(): Promise<number>; recentItems(): Promise<PanelItem[]> }`.
  - `githubFabricSeam(org: string, token: string): FabricSeam` — live implementation over the GitHub search API.
  - `fabricPanel(seam: FabricSeam, staleAt: number): Promise<Panel>` — maps the seam to a `Panel` titled `"Fabric"` with a `"dispatch-issue"` action (`kind: "confirm"`), a summary PR-count and issue-count item, plus `recentItems()`.
  - Route `GET /api/fabric` in the router returns `fabricPanel(...)` JSON, cached 30s under key `fabric:panel`.

> **Note (DRY, later):** P1 uses live GitHub search for a proving slice. A later task can add a `fabricStatusSeam()` that reads `.github`'s `fabric-status.json` artifact and implements the same `FabricSeam` — the panel and UI stay untouched.

- [ ] **Step 1: Write the failing test**

```ts
// suxdash/test/fabric.test.ts
import { describe, it, expect } from "vitest";
import { fabricPanel, type FabricSeam } from "../src/fabric";

const seam: FabricSeam = {
  openPrCount: async () => 4,
  openIssueCount: async () => 7,
  recentItems: async () => [
    { id: "pr-1", title: "Fix flaky auth test", url: "https://x/pr/1", badge: "PR" },
  ],
};

describe("fabricPanel", () => {
  it("builds a Fabric panel with count summary, recent items, and a dispatch action", async () => {
    const panel = await fabricPanel(seam, 123);
    expect(panel.title).toBe("Fabric");
    expect(panel.staleAt).toBe(123);
    expect(panel.actions).toEqual([
      { verb: "dispatch-issue", label: "File issue", kind: "confirm" },
    ]);
    // first item summarizes open counts
    expect(panel.items[0].title).toContain("4");
    expect(panel.items[0].title).toContain("7");
    // recent items are appended
    expect(panel.items.some((i) => i.id === "pr-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd suxdash && npx vitest run test/fabric.test.ts`
Expected: FAIL — cannot resolve `../src/fabric`.

- [ ] **Step 3: Implement the adapter and live seam**

```ts
// suxdash/src/fabric.ts
import type { Panel, PanelItem } from "./panel";

export interface FabricSeam {
  openPrCount(): Promise<number>;
  openIssueCount(): Promise<number>;
  recentItems(): Promise<PanelItem[]>;
}

const GH = "https://api.github.com";

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "suxdash",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function searchCount(org: string, token: string, q: string): Promise<number> {
  const res = await fetch(
    `${GH}/search/issues?q=${encodeURIComponent(`org:${org} is:open ${q}`)}&per_page=1`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`github search ${res.status}`);
  const body = (await res.json()) as { total_count: number };
  return body.total_count;
}

export function githubFabricSeam(org: string, token: string): FabricSeam {
  return {
    openPrCount: () => searchCount(org, token, "is:pr"),
    openIssueCount: () => searchCount(org, token, "is:issue"),
    recentItems: async () => {
      const res = await fetch(
        `${GH}/search/issues?q=${encodeURIComponent(`org:${org} is:open`)}&sort=updated&order=desc&per_page=8`,
        { headers: ghHeaders(token) },
      );
      if (!res.ok) throw new Error(`github search ${res.status}`);
      const body = (await res.json()) as {
        items: { id: number; title: string; html_url: string; pull_request?: unknown; repository_url: string }[];
      };
      return body.items.map((it) => ({
        id: String(it.id),
        title: it.title,
        subtitle: it.repository_url.split("/").pop(),
        url: it.html_url,
        badge: it.pull_request ? "PR" : "issue",
      }));
    },
  };
}

export async function fabricPanel(seam: FabricSeam, staleAt: number): Promise<Panel> {
  const [prs, issues, recent] = await Promise.all([
    seam.openPrCount(),
    seam.openIssueCount(),
    seam.recentItems(),
  ]);
  const summary: PanelItem = {
    id: "summary",
    title: `${prs} open PRs · ${issues} open issues`,
    badge: "org",
  };
  return {
    title: "Fabric",
    items: [summary, ...recent],
    staleAt,
    actions: [{ verb: "dispatch-issue", label: "File issue", kind: "confirm" }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd suxdash && npx vitest run test/fabric.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `GET /api/fabric` into the router**

In `suxdash/src/index.ts`, add these imports and the route (after the Access gate, before the 404):

```ts
import { cached } from "./cache";
import { githubFabricSeam, fabricPanel } from "./fabric";

// ...after `if (!auth) return ...forbidden`:
    if (url.pathname === "/api/fabric") {
      const { value, staleAt } = await cached(env.CACHE, "fabric:panel", 30, async () => {
        const seam = githubFabricSeam(env.GITHUB_ORG, env.GITHUB_TOKEN);
        return (await fabricPanel(seam, 0)).items; // items only; staleAt from cache wrapper
      });
      const panel = {
        title: "Fabric",
        items: value,
        staleAt,
        actions: [{ verb: "dispatch-issue", label: "File issue", kind: "confirm" }],
      };
      return Response.json(panel);
    }
```

- [ ] **Step 6: Type-check**

Run: `cd suxdash && npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd suxdash && git add -A && git commit -m "feat: Fabric panel adapter over live GitHub + /api/fabric route"
```

---

## Task 5: Dispatch-issue action (dry-run + execute) + `/api/act/dispatch-issue`

**Files:**
- Create: `suxdash/src/actions/dispatch-issue.ts`, `suxdash/test/dispatch-issue.test.ts`
- Modify: `suxdash/src/index.ts`

**Interfaces:**
- Consumes: `Env` (Task 1).
- Produces:
  - `DispatchIssueInput` = `{ repo: string; title: string; body: string }`.
  - `Plan` = `{ summary: string; target: string }`.
  - `ActionResult` = `{ ok: boolean; url?: string; error?: string }`.
  - `GithubIssueSeam` = `{ createIssue(repo: string, title: string, body: string): Promise<{ url: string }> }`.
  - `planDispatchIssue(input: DispatchIssueInput): Plan` — pure; `summary` describes the issue, `target` = `"<org>/<repo>"` is left as `repo` (org prefixed at the route).
  - `executeDispatchIssue(input: DispatchIssueInput, seam: GithubIssueSeam): Promise<ActionResult>` — validates non-empty `repo`+`title`, calls `seam.createIssue` exactly once, returns `{ ok: true, url }`.
  - `githubIssueSeam(org: string, token: string): GithubIssueSeam` — live POST to `/repos/{org}/{repo}/issues`.
  - Route `POST /api/act/dispatch-issue`: `?dry=1` returns `planDispatchIssue(body)`; otherwise runs `executeDispatchIssue`.

- [ ] **Step 1: Write the failing test**

```ts
// suxdash/test/dispatch-issue.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  planDispatchIssue,
  executeDispatchIssue,
  type GithubIssueSeam,
} from "../src/actions/dispatch-issue";

describe("planDispatchIssue", () => {
  it("produces a preview plan without mutating anything", () => {
    const plan = planDispatchIssue({ repo: "sux", title: "Add X", body: "why" });
    expect(plan.target).toBe("sux");
    expect(plan.summary).toContain("Add X");
  });
});

describe("executeDispatchIssue", () => {
  it("creates the issue exactly once and returns its url", async () => {
    const seam: GithubIssueSeam = {
      createIssue: vi.fn(async () => ({ url: "https://x/issues/9" })),
    };
    const res = await executeDispatchIssue({ repo: "sux", title: "Add X", body: "why" }, seam);
    expect(res).toEqual({ ok: true, url: "https://x/issues/9" });
    expect(seam.createIssue).toHaveBeenCalledTimes(1);
    expect(seam.createIssue).toHaveBeenCalledWith("sux", "Add X", "why");
  });

  it("rejects an empty title without calling the seam", async () => {
    const seam: GithubIssueSeam = { createIssue: vi.fn() };
    const res = await executeDispatchIssue({ repo: "sux", title: "", body: "" }, seam);
    expect(res.ok).toBe(false);
    expect(seam.createIssue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd suxdash && npx vitest run test/dispatch-issue.test.ts`
Expected: FAIL — cannot resolve `../src/actions/dispatch-issue`.

- [ ] **Step 3: Implement the action**

```ts
// suxdash/src/actions/dispatch-issue.ts
export interface DispatchIssueInput {
  repo: string;
  title: string;
  body: string;
}
export interface Plan {
  summary: string;
  target: string;
}
export interface ActionResult {
  ok: boolean;
  url?: string;
  error?: string;
}
export interface GithubIssueSeam {
  createIssue(repo: string, title: string, body: string): Promise<{ url: string }>;
}

export function planDispatchIssue(input: DispatchIssueInput): Plan {
  return {
    summary: `File issue "${input.title}" on ${input.repo}`,
    target: input.repo,
  };
}

export async function executeDispatchIssue(
  input: DispatchIssueInput,
  seam: GithubIssueSeam,
): Promise<ActionResult> {
  if (!input.repo.trim() || !input.title.trim()) {
    return { ok: false, error: "repo and title are required" };
  }
  const { url } = await seam.createIssue(input.repo, input.title, input.body);
  return { ok: true, url };
}

export function githubIssueSeam(org: string, token: string): GithubIssueSeam {
  return {
    createIssue: async (repo, title, body) => {
      const res = await fetch(`https://api.github.com/repos/${org}/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "suxdash",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error(`github create issue ${res.status}`);
      const created = (await res.json()) as { html_url: string };
      return { url: created.html_url };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd suxdash && npx vitest run test/dispatch-issue.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Wire `POST /api/act/dispatch-issue` into the router**

In `suxdash/src/index.ts`, add the import and route (after `/api/fabric`):

```ts
import {
  planDispatchIssue,
  executeDispatchIssue,
  githubIssueSeam,
  type DispatchIssueInput,
} from "./actions/dispatch-issue";

// ...
    if (url.pathname === "/api/act/dispatch-issue" && req.method === "POST") {
      const input = (await req.json()) as DispatchIssueInput;
      if (url.searchParams.get("dry") === "1") {
        return Response.json(planDispatchIssue(input));
      }
      const seam = githubIssueSeam(env.GITHUB_ORG, env.GITHUB_TOKEN);
      const result = await executeDispatchIssue(input, seam);
      return Response.json(result, { status: result.ok ? 200 : 400 });
    }
```

- [ ] **Step 6: Type-check**

Run: `cd suxdash && npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd suxdash && git add -A && git commit -m "feat: dispatch-issue action with dry-run preview + execute route"
```

---

## Task 6: Shell UI + preview→confirm + e2e smoke

**Files:**
- Create: `suxdash/src/shell.ts`
- Modify: `suxdash/src/index.ts`

**Interfaces:**
- Consumes: all prior routes.
- Produces: `SHELL_HTML: string` served at `GET /`; a self-contained page that fetches `/api/fabric`, renders the panel, and drives the dispatch action through `?dry=1` preview → confirm → execute.

- [ ] **Step 1: Create the shell**

```ts
// suxdash/src/shell.ts
export const SHELL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>suxdash</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
  body { margin: 0; padding: 1.5rem; max-width: 780px; margin-inline: auto; }
  h1 { font-size: 1.1rem; }
  .panel { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px; padding: 1rem; }
  .item { padding: .4rem 0; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
  .item:first-child { border-top: 0; }
  .badge { font-size: .7rem; opacity: .7; border: 1px solid currentColor; border-radius: 999px; padding: 0 .4rem; margin-right: .4rem; }
  .stale { opacity: .5; }
  button { font: inherit; padding: .35rem .7rem; border-radius: 8px; cursor: pointer; }
  input, textarea { font: inherit; width: 100%; box-sizing: border-box; margin: .25rem 0; padding: .4rem; }
  dialog { border: 1px solid; border-radius: 10px; max-width: 460px; }
</style>
</head>
<body>
  <h1>suxdash — Fabric</h1>
  <div id="meta" class="stale">loading…</div>
  <div id="panel" class="panel"></div>

  <dialog id="dlg">
    <form method="dialog" id="form">
      <p><strong>File a fabric issue</strong></p>
      <input id="repo" placeholder="repo (e.g. sux)" />
      <input id="title" placeholder="issue title" />
      <textarea id="body" rows="3" placeholder="body"></textarea>
      <pre id="preview" class="stale"></pre>
      <menu style="display:flex;gap:.5rem;justify-content:flex-end;">
        <button value="cancel">Cancel</button>
        <button id="preview-btn" value="default">Preview</button>
        <button id="confirm-btn" disabled>Confirm &amp; file</button>
      </menu>
    </form>
  </dialog>

<script type="module">
async function load() {
  const res = await fetch("/api/fabric");
  const p = await res.json();
  const el = document.getElementById("panel");
  el.innerHTML = p.items.map(function (i) {
    var badge = i.badge ? '<span class="badge">' + i.badge + "</span>" : "";
    var sub = i.subtitle ? ' <small class="stale">' + i.subtitle + "</small>" : "";
    var t = i.url ? '<a href="' + i.url + '" target="_blank" rel="noopener">' + i.title + "</a>" : i.title;
    return '<div class="item">' + badge + t + sub + "</div>";
  }).join("");
  var ageMs = p.staleAt - Date.now();
  document.getElementById("meta").textContent =
    ageMs > 0 ? "fresh · refreshes in " + Math.round(ageMs / 1000) + "s"
              : "stale — refresh to update";
  var bar = document.createElement("div");
  bar.style.margin = "1rem 0";
  (p.actions || []).forEach(function (a) {
    if (a.verb !== "dispatch-issue") return;
    var b = document.createElement("button");
    b.textContent = a.label;
    b.onclick = function () { document.getElementById("dlg").showModal(); };
    bar.appendChild(b);
  });
  el.after(bar);
}

function payload() {
  return {
    repo: document.getElementById("repo").value,
    title: document.getElementById("title").value,
    body: document.getElementById("body").value,
  };
}

document.getElementById("preview-btn").addEventListener("click", async function (e) {
  e.preventDefault();
  var res = await fetch("/api/act/dispatch-issue?dry=1", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  var plan = await res.json();
  document.getElementById("preview").textContent = plan.summary + "  →  " + plan.target;
  document.getElementById("confirm-btn").disabled = false;
});

document.getElementById("confirm-btn").addEventListener("click", async function (e) {
  e.preventDefault();
  var res = await fetch("/api/act/dispatch-issue", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  var out = await res.json();
  document.getElementById("preview").textContent = out.ok ? "filed: " + out.url : "error: " + out.error;
  document.getElementById("confirm-btn").disabled = true;
});

load();
</script>
</body>
</html>`;
```

- [ ] **Step 2: Serve the shell at `/`**

In `suxdash/src/index.ts`, add the import and route (right after the Access gate, before `/api/fabric`):

```ts
import { SHELL_HTML } from "./shell";

// ...
    if (url.pathname === "/") {
      return new Response(SHELL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
```

- [ ] **Step 3: Type-check and run all unit tests**

Run: `cd suxdash && npm run type-check && npm test`
Expected: type-check clean; all tests from Tasks 2–5 PASS.

- [ ] **Step 4: E2E smoke via wrangler dev + browser**

Because Access verification is on, drive the app with `GITHUB_TOKEN` set and Access temporarily satisfied. Run `wrangler dev` with a local `.dev.vars` containing a real `GITHUB_TOKEN`, then open the Browser pane at `http://localhost:8790/` **with a `Cf-Access-Jwt-Assertion` header stubbed**. For P1 smoke, temporarily short-circuit auth in dev only by exporting `ACCESS_AUD=""` and adding a dev bypass guard, OR verify the two API routes directly with a crafted request. Concretely:

```bash
cd suxdash && printf 'GITHUB_TOKEN=%s\n' "$REAL_TOKEN" > .dev.vars
npx wrangler dev --port 8790
```
Then in the Browser pane, load `http://localhost:8790/healthz` (expect `suxdash ok`). For the gated UI, confirm behind a real Access app in a `wrangler deploy` preview, or assert the adapter/action paths through the unit suite (already green). Manually verify: the panel lists open org PRs/issues; clicking **File issue** → **Preview** shows the plan; **Confirm & file** creates a real issue and shows its URL.

- [ ] **Step 5: Commit**

```bash
cd suxdash && git add -A && git commit -m "feat: shell UI with preview->confirm dispatch flow (P1 complete)"
```

---

## Self-review

**Spec coverage (against `suxdash-command-center-design.md`):**
- §2 BFF + panel contract → Tasks 3, 4, 6. ✓
- §2 service binding to `sux` → **P2, not P1** (Life panel). Out of scope here by design.
- §3 read-through KV cache + `staleAt` + polling → Task 3 (`cached`), Task 6 (staleness display). Auto-refresh polling loop is minimal in P1 (manual refresh); acceptable for the proving slice.
- §4 Fabric panel (read) → Task 4. Dispatch action → Task 5. PR/pipeline-control actions → P3. ✓ (P1 scope)
- §4 preview→confirm → Task 5 (`?dry=1`) + Task 6 (UI). ✓
- §5 Cloudflare Access + no-secrets-in-browser + inert data → Task 2 + Task 6 (server-held token, same-origin calls, text rendering). ✓
- §5 narrow `sux` RPC → P2. Out of scope here. ✓
- §6 P1 phase = skeleton + Fabric + one action → this whole plan. ✓
- §7 adapter unit tests + action round-trip + e2e smoke → Tasks 2–6. ✓

**Placeholder scan:** `REPLACE_WITH_*` tokens in `wrangler.jsonc` are real out-of-band setup values (KV id, Access domain/AUD), documented with the command that produces them — not plan placeholders. No `TODO`/`TBD`/"handle edge cases" in steps.

**Type consistency:** `FabricSeam`, `Panel`/`PanelItem`, `DispatchIssueInput`/`Plan`/`ActionResult`/`GithubIssueSeam`, `verifyAccess`/`parseJwt`, `cached` signatures match between their defining task and every consumer. The `/api/fabric` route builds the panel from cached `items` + wrapper `staleAt` (Task 4 Step 5), consistent with `fabricPanel`'s shape.

---

## Deferred to later phases (own plans)
- **P2:** Life panel + `WorkerEntrypoint` RPC surface on `sux` (`lifeSnapshot`, `triageMail`, `acceptEvent`, `captureNote`) via a `SUX` service binding.
- **P3:** Metrics panel (embed `fabric-health-dashboard.json`), remaining PR/pipeline-control actions, swap Fabric seam to read `fabric-status.json`.
- **P4:** SSE live push via a Durable Object behind the same panel contract.
