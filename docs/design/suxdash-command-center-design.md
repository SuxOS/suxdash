# suxdash — SuxOS command center · design

Status: **Design approved 2026-07-16.** Next step: implementation plan (superpowers:writing-plans).
Home: new `suxdash` repo/Worker in the SuxOS org (add to `~/.claude/fabric.json`).

---

## 1. Context — what we are building

A single **web command center** for the whole SuxOS fabric, served by a new Cloudflare
Worker (`suxdash`) and opened in a browser behind Cloudflare Access. It unifies three
domains into one page and lets the operator *act*, not just watch:

- **Fabric ops** — the `.github` three-loop pipeline, PRs/issues/Actions across the org's repos.
- **Personal life** — mail triage, calendar, vault activity (the `sux` connectors).
- **Metrics** — the existing Grafana fabric-health spine.

It is a **single-operator** tool (`m@colinxs.com`), consistent with the rest of SuxOS: one
operator, private repos, operator nearby to intervene. The one real residual risk is
**prompt injection via content the dashboard displays** (mail bodies, issue text); the
defense is the same as the pipeline's — *scope what a write action can do, and gate every
side effect behind an explicit human click with a preview* (see §5).

This is explicitly **not** "orient rendered in a browser." The action layer (dispatch to
the pipeline, PR/pipeline control, reversible mail/life triage) is what makes it a command
center rather than a viewer.

### Ground truth (verified 2026-07-16)

- `sux` is one Worker (`sux/sux/src/index.ts`), fronted by an OAuth **MCP gate**, with
  `mail` / `calendar` / `vault` already implemented as fns, plus anonymous HTTP routes
  (`/metrics`, `/logs`, `/s/*`).
- `sux/sux/wrangler.jsonc` sets `global_fetch_strictly_public` → **same-account `fetch()`
  loops out through the public front door** and would hit sux's MCP gate. A **service
  binding (isolate-to-isolate RPC)** bypasses this and is the correct internal seam.
- The `suxos_*` fabric-health Prometheus gauges are **already pushed by `sux`'s `*/5` cron**
  to Grafana Cloud. The dashboard **surfaces** fabric health it can read; it does not
  recompute it.
- `SuxOS/.github/grafana/fabric-health-dashboard.json` is the existing dashboard to embed.

---

## 2. Architecture

`suxdash` is a **backend-for-frontend (BFF)**: it serves the UI *and* owns a small server
that each panel calls. No domain logic runs in the browser.

```
Browser (Cloudflare Access — single operator)
   │  loads shell + polls /api/*
   ▼
suxdash Worker  ── BFF ──┐
   ├─ /api/fabric   → GitHub API (App token) + reads suxos_* from Grafana/Prometheus
   ├─ /api/life     → service binding → sux (mail/calendar/vault fns via RPC)
   ├─ /api/metrics  → Grafana API / embedded panels
   └─ /api/act/*    → routes each action to its native seam (§4)
        KV: read-through cache (fabric + metrics), short TTL, staleAt stamped
```

Three **domain adapters** sit behind one uniform **panel contract** so the shell renders
every panel identically and a fourth panel is mechanical to add:

```
Panel = { title, items[], staleAt, actions[] }
Action = { verb, label, kind: "reversible" | "confirm", dryRun(): Plan, execute(): Result }
```

Each adapter is independently testable: mock its seam (GitHub / Grafana / `SUX`), assert
the panel contract and each action's dry-run plan without touching the UI.

### The `sux` life-domain seam

`suxdash` declares `services: [{ binding: "SUX", service: "sux" }]`. `sux` exposes a
**`WorkerEntrypoint`** with a *narrow* set of RPC methods — a deliberate internal surface
distinct from the public MCP gate, so the dashboard never widens sux's external attack
surface:

- `lifeSnapshot()` → `{ mailTriage, todayCalendar, proposedEvents, recentVault }`
- `triageMail(ids, action)` → reversible-only (label / archive / unarchive / undelete),
  mirroring the existing `MAIL_TRIAGE_ACT` allow-list; returns an undo handle.
- `acceptEvent(proposalId)` and `captureNote(text|url)`.

---

## 3. Data flow & caching

- **Read-through KV cache** for rate-limited/expensive seams (GitHub, Grafana). Payloads
  carry `staleAt`; the UI shows "updated Ns ago" and dims when stale.
- **Polling, not push, for v1.** The shell polls per panel (fabric ~30s, metrics ~60s,
  life ~2m). A Durable-Object SSE stream is a clean later upgrade behind the same contract
  (P4, out of v1 — YAGNI).
- **Freshness honesty.** GitHub is the live source of truth for PR/issue lists (uncached
  within its rate budget); `suxos_*` gauges are read from Prometheus (already 5-min
  granular). The dashboard surfaces fabric health from the existing spine; it never
  recomputes it.
- **Local degradation.** A failed adapter renders its own error state; the other panels
  still render. No whole-page failure.

---

## 4. Panels + action layer

| Panel | Read | Actions (write) → seam |
|---|---|---|
| **Fabric** | Open PRs & issues per repo; Actions run status; drain/backlog counts; `needs-human` / throttle flags; blockers | **Dispatch** (file issue / promote a `[ready]` ledger idea) → GitHub API; **PR/pipeline control** (hold/unhold, re-run check, pause/resume loop crons) → GitHub API + workflow enable/disable |
| **Life** | Unread-mail triage summary; today's calendar; proposed events; recent vault activity | **Triage** (archive/label mail), **accept event**, **capture note** → `SUX` RPC (reversible-only allow-list) |
| **Metrics** | Fabric-health spine: drain rate, pipeline utilization, per-loop latency, `suxos_*` gauges | read-only (embeds existing `fabric-health-dashboard.json` panels) |

### Action safety — preview → confirm

Every write action is two-step:

1. `POST /api/act/<verb>?dry=1` → returns the exact **Plan** (what will happen), rendered
   for the operator.
2. A second **confirmed** call executes and hits the seam exactly once.

Reversible life actions (label/archive) confirm inline and expose an undo handle;
irreversible-ish fabric actions (file issue, pause crons) get an explicit confirm dialog.
This maps the existing reversible-only doctrine directly onto the UI.

---

## 5. Auth & security

- **Cloudflare Access** fronts the whole Worker — single identity, no app-level login.
- **Injection boundary.** Mail / issue / PR content renders as **inert data** — never as
  instructions, never auto-executed. Every side effect is human-clicked with a preview.
  This is the pipeline's "scope what an agent can *do* after reading untrusted text"
  doctrine (`three-loop-pipeline.md §1`) applied to a UI.
- **Narrow `sux` RPC.** The `WorkerEntrypoint` exposes only the methods in §2 — not a
  general proxy — so it cannot widen sux's blast radius.
- **No secrets in the browser.** GitHub App + Grafana tokens live as `suxdash` secrets; the
  browser only sees rendered data and calls same-origin `/api/*`.

---

## 6. Phasing (thin vertical slice first)

1. **P1 — Skeleton + Fabric panel, read + one action.** `suxdash` Worker, Access, panel
   contract, KV cache, Fabric panel reading GitHub, and **Dispatch-file-issue** wired
   end-to-end. Proves the entire stack (UI → BFF → seam → action → confirm) on one panel.
2. **P2 — Life panel + `SUX` RPC.** Add the `WorkerEntrypoint` to `sux`; life snapshot +
   triage / capture actions.
3. **P3 — Metrics panel.** Embed the existing Grafana fabric-health panels; add the
   remaining PR/pipeline-control actions.
4. **P4 (post-v1, optional) — SSE live push** via a Durable Object, behind the same
   contract.

Each phase is independently shippable and leaves a working dashboard.

---

## 7. Testing

- **Adapter unit tests** (Vitest, matching sux's setup): mock each seam; assert the panel
  contract shape and every action's dry-run plan.
- **Action round-trip tests:** dry-run returns the correct plan; a confirmed call hits the
  seam exactly once; reversible actions expose an undo handle.
- **One end-to-end smoke per phase** via `wrangler dev` + browser tools: load the shell,
  confirm the panel populates, click one action through preview → confirm.

---

## 8. Out of scope (v1)

- Live push / SSE (P4, later).
- Multi-user / non-operator auth beyond Cloudflare Access.
- A fourth data domain — the contract makes it mechanical, but not now.
- Recomputing metrics the fabric-health spine already exposes.
