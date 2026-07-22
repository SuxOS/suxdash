# suxdash

The SuxOS operator command center — a Cloudflare Worker served at `dash.suxos.net`
behind Cloudflare Access, single operator (`m@colinxs.com`).

Design: `docs/design/suxdash-command-center-design.md`
Serving topology: `docs/design/serving-topology.md`
P1 implementation plan: `docs/superpowers/plans/2026-07-16-suxdash-p1-fabric-slice.md`

## Status

**P1 shipped** (this repo, sux#1): skeleton Worker, Cloudflare Access JWT verification
gate, a **Fabric** panel (live GitHub org PR/issue counts + recent activity), and a
**Dispatch → file issue** action with a preview (`?dry=1`) → confirm flow.

Deferred to later phases (see the design doc §6):
- **P2** — Life panel + a narrow `SUX` service-binding RPC on the `sux` Worker.
- **P3** — Metrics panel (embed the existing Grafana fabric-health dashboard),
  remaining PR/pipeline-control actions.
- **Router panel** (serving-topology.md) — reads `sux-dashboard` rpcd JSON via
  `router.suxos.net`; blocked on the cloudflared ingress + Access app for
  `router.suxos.net` (suxrouter#631, open).

## Local development

```bash
npm install
npm run type-check
npm test
npm run dev   # wrangler dev — /healthz is ungated, everything else needs a real
              # Cf-Access-Jwt-Assertion header once ACCESS_TEAM_DOMAIN/ACCESS_AUD are real
```

## Deploy prerequisites (not done by this repo's CI — deploy is manual)

`wrangler.jsonc` has three placeholders that must be set before `wrangler deploy`:

- **KV namespace**: `npx wrangler kv namespace create CACHE`, paste the id into
  `kv_namespaces[0].id`.
- **`ACCESS_TEAM_DOMAIN`**: the Cloudflare Access team domain
  (`<team>.cloudflareaccess.com`).
- **`ACCESS_AUD`**: the Access application AUD tag for the `dash.suxos.net`
  self-hosted app.

Secret (out-of-band, not in `wrangler.jsonc`):

- **`GITHUB_TOKEN`**: `npx wrangler secret put GITHUB_TOKEN` — a fine-grained PAT
  scoped to the `SuxOS` org with `issues:write` + `issues:read` (used by both the
  Fabric panel's GitHub search reads and the Dispatch-issue action's write).

The `routes` entry in `wrangler.jsonc` targets `dash.suxos.net` as a custom domain —
confirm that hostname is attached to this Worker in the Cloudflare dashboard (or via
`wrangler deploy`, which provisions it) once the Access app exists.
