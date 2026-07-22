# Serving topology — every SuxOS surface behind Cloudflare, one operator identity

*2026-07-22 (v3). Reconciles the two dashboards (suxdash ↔ the router's LuCI dashboard) and
locks where every web surface lives and how it's gated.*

## The reconcile in one line

**suxdash is THE single pane; the LuCI dashboard is the router's deep-admin plane.** suxdash
*surfaces* router health (same JSON the LuCI view reads) and *links into* LuCI for admin —
it never re-implements it, and LuCI is never iframed (its auth/CSRF makes embedding brittle).

## Topology

| Surface | Host | Backing | Auth |
|---|---|---|---|
| **suxdash** (operator command center) | `dash.suxos.net` | Cloudflare Worker (this repo) | **CF Access** (operator) |
| **Router admin** (LuCI + sux-\* apps) | `router.suxos.net` | cloudflared tunnel on owl-tegu → uhttpd `:80` | **CF Access** (operator) + LuCI login (defense in depth) |
| **Grafana** (fabric-health spine) | `grafana.suxos.net` → Grafana Cloud | custom domain (or link-out until it lands) | Grafana auth; suxdash embeds panels read-only |
| **Portal** (life-record sharing) | `portal.suxos.net` | sux Worker `portal.ts` (sux#1191) | share-link auth + Turnstile — **NOT** operator Access (external audience) |
| **sux MCP** | `suxos.net/mcp` | sux Worker | OAuth (existing) — unchanged |

- **One CF Access group `operator`** (m@colinxs.com) applied to `dash.*` and `router.*`.
  The portal is deliberately outside it (different audience, its own auth per #1191).
- All hosts on `suxos.net`, TLS at Cloudflare's edge, no origin exposed.

## Router panel in suxdash (the actual reconcile work)

- suxdash gains a **Router** panel (4th domain adapter, same `Panel = {title, items[],
  staleAt, actions[]}` contract): WAN/DNS owner (:53), tailscale, service health, presence —
  read from the **exact rpcd JSON the LuCI dashboard's own view calls** (`sux-dashboard`
  `get_status` + heartbeat) through `router.suxos.net`'s tunnel. **One backend, two
  frontends** — zero logic duplication.
- Panel actions are **link-outs** into the corresponding LuCI page (`router.suxos.net/cgi-bin/
  luci/admin/services/sux/<app>`), not remote writes — router writes stay on the box's own
  confirm-gated, SACRED-guarded paths.

## SACRED invariant (unchanged)

The tunnel is an **additional** path, never a replacement: LAN access to LuCI
(`192.168.1.1`) must keep working with Cloudflare fully down. Nothing here touches :53,
DHCP, routing, or the firewall posture; cloudflared ingress is an outbound-only connector
the box already runs (sux-cloudflare app).

## Build plan (dispatched)

1. **suxdash P1** — execute the already-specced plan (`docs/superpowers/plans/2026-07-16-…`):
   skeleton Worker + Access JWT verify + Fabric panel + one dispatch action. Then the Router
   panel as the next adapter.
2. **suxrouter** — cloudflared ingress `router.suxos.net → http://localhost:80` in the
   sux-cloudflare app's tunnel config, box-verified (router session owns the box half).
3. **Access provisioning** — two self-hosted apps (`dash.suxos.net`, `router.suxos.net`),
   one `operator` policy (m@colinxs.com), session 24h. Via API if token perms allow, else
   dashboard (exact config in the dispatch issue).
