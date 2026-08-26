# Agent guide — matter-home

Guidance for AI agents (and humans) working in this repo. Keep it accurate; it is the source of truth for how the project is built and hosted.

## What this is

A self-hosted control surface for a Matter smart home:

```
Matter devices ──▶ matter-server (matter.js controller, ws://…:5580)
                      └──▶ gateway (Node, no deps) ──▶ SSE + REST + serves the SPA (:8788)
                              └──▶ web (SolidJS SPA) — login-gated, talks to the gateway
```

- **gateway/** — dependency-free Node ESM (`server.mjs`, `model.mjs`, `matter-client.mjs`). Connects to matter-server, builds the enriched device model, streams SSE deltas, takes commands, serves the built SPA. Token-authenticated (`GW_TOKEN` in `gateway/.env`, gitignored — it is both the login password and the API bearer token).
- **web/** — SolidJS + Vite SPA. `npm run build` produces `web/dist`, which the gateway serves.
- **tools/** — operational scripts run with `node tools/<script>.mjs`.
- **deploy/** — `auto-deploy.sh`, the legacy poll-based deployer. **No longer used** (see Hosting). Kept for reference only.

## Hosting — READ THIS

**All hosted/production traffic runs on the always-on server `kl_2_server`. Nothing is hosted on a developer laptop, MacBook, or any personal machine.** Do not add, re-enable, or document any laptop/MacBook-hosted runtime — that setup has been fully decommissioned.

- **Production host:** `kl_2_server` — an always-on Mac on the home LAN, reachable over ZeroTier at `172.30.2.3`. It runs four launchd agents (`com.matterhome.*`):
  - `matterserver` — matter.js controller on `:5580`, bound to the LAN interface.
  - `gateway` — API + built SPA on `:8788`.
  - `tunnel` — Cloudflare tunnel exposing the gateway at `https://home.sigma-rahul.com` (so the PWA works away from home).
  - `watchdog` — every 120s, restarts `tunnel` if the public URL is down while the gateway is healthy. See [Tunnel outages](#tunnel-outages-cloudflare-error-1033).

  Reference copies of all four plists live in `deploy/`, with `__HOME__` standing in for the server's home directory. Only the watchdog is installed by the deploy; the other three are committed for review and rebuild-after-reimage. If you change one on the server, update the copy here.
- **Public URL:** `https://home.sigma-rahul.com` → Cloudflare tunnel → gateway on the server. This is the only production entry point.
- **The Matter fabric lives on the server** (`~/.matter_server`). Never run a second controller against the same fabric elsewhere — two controllers on one fabric cause session contention. There must only ever be one live matter-server, and it is the one on `kl_2_server`.

## Deploying

**Pushing to `main` is the deploy.** The `.github/workflows/deploy-server.yml` workflow runs on push (paths under `gateway/`, `web/`, `tools/`, `deploy/`) or manual dispatch:

1. A GitHub-hosted runner joins the ZeroTier network.
2. SSHes into `kl_2_server`, fast-forwards the checkout (`git reset --hard origin/main`).
3. Rebuilds the SPA only if `web/` changed; restarts the gateway only if `gateway/` changed.
4. Verifies `/api/health`.
5. Leaves the ZeroTier network and deauthorizes the ephemeral runner member.

Required repo secrets: `ZEROTIER_NETWORK_ID`, `ZEROTIER_CENTRAL_TOKEN`, `ZEROTIER_HOST_IP`, `REMOTE_USER`, `REMOTE_PASSWORD`.

The deploy fast-forwards in place and preserves gitignored runtime data on the server (`gateway/.env`, `tools/device-map.json`, `tools/home.json`, `gateway/config.json`, the Matter fabric). Do not add a step that clobbers the tree or that copy secrets into the repo.

The other workflows: `ci.yml` (syntax-checks the gateway, builds the SPA on every push) and `deploy-pages.yml` (publishes the SPA to GitHub Pages as a standalone password gate that connects to whatever gateway URL you enter — this is not the production host).

## Tunnel outages (Cloudflare error 1033)

Error 1033 on `home.sigma-rahul.com` means cloudflared is not connected to Cloudflare's edge. The gateway is usually fine — it keeps serving on `:8788` over the LAN/ZeroTier the whole time. Confirm with `curl http://172.30.2.3:8788/` (expect 200) before touching anything else.

**Known cause.** cloudflared logs `Lost connection with the edge` and, on some reconnect attempts, `DialContext error: dial tcp 198.41.192.x:7844: i/o timeout`. It retries but does not always recover all four connections, and the process stays alive throughout — so launchd's `KeepAlive` never fires. That is the gap the watchdog fills. The tunnel runs with `--protocol http2` rather than the QUIC default; don't switch to QUIC unless outbound UDP/7844 is known to work from the home LAN.

**Self-healing.** `deploy/tunnel-watchdog.sh` runs every 120s under `com.matterhome.watchdog` and kickstarts the tunnel when the public URL is down *and* the gateway is healthy *and* the server has internet. It requires two consecutive bad probes, waits 10 min between restarts, and backs off to hourly after three restarts that didn't restore service — so a Cloudflare-side outage isn't met with a restart loop. Logs to `~/Library/Logs/matterhome/watchdog.log`.

**Manual recovery**, if you're on the server and don't want to wait for the watchdog:

```sh
launchctl kickstart -k "gui/$(id -u)/com.matterhome.tunnel"
```

A push to `main` also probes the public URL and restarts the tunnel if needed, so a manual `workflow_dispatch` of `deploy-server.yml` recovers it without SSH.

**Monitoring.** There is none — the last outage was noticed by a human. An external check on `https://home.sigma-rahul.com/` (UptimeRobot free tier or a Cloudflare health check) would catch it first; still worth setting up.

## Local development

```sh
cd web && npm install && npm run dev   # Vite dev server, proxies /api to localhost:8788
```

To run the gateway locally you need a reachable matter-server. **Do not point a local gateway at the production fabric** — stand up a separate matter-server or work against the live one read-only. Prefer changing code and letting the deploy pipeline ship it to the server over running a competing controller.

## Conventions

- The gateway is intentionally dependency-free — keep `gateway/` free of npm dependencies.
- Match the surrounding code's style; the SPA is plain SolidJS with hand-written CSS under `web/src/styles/`.
- Secrets and home-specific data are gitignored; never commit `gateway/.env`, device maps, or fabric data.
