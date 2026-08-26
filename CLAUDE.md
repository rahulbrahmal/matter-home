# CLAUDE.md

This file guides Claude Code (and other agents) working in this repo. The full guide lives in [AGENTS.md](AGENTS.md) — read it. Key points:

## Hosting — all production traffic is on the kl2 server, not this machine

**Everything hosted runs on the always-on server `kl_2_server`** (on the home LAN, reachable over ZeroTier at `172.30.2.3`). **No production runtime runs on a developer laptop, MacBook, or any personal machine** — that setup is fully decommissioned. Don't re-introduce or document laptop-hosted services.

- Production host `kl_2_server` runs four launchd agents: `matterserver` (`:5580`), `gateway` (`:8788`), `tunnel` (Cloudflare → `https://home.sigma-rahul.com`), and `watchdog` (restarts the tunnel when the public URL is down but the gateway is healthy).
- A Cloudflare **error 1033** means the tunnel dropped, not that the app is down — the gateway keeps serving on `:8788`. See "Tunnel outages" in [AGENTS.md](AGENTS.md).
- The Matter fabric lives on the server (`~/.matter_server`). Never run a second controller against it — one live matter-server only, on `kl_2_server`.
- Public entry point: `https://home.sigma-rahul.com`.

## Deploying

Pushing to `main` is the deploy — `.github/workflows/deploy-server.yml` joins ZeroTier, SSHes into `kl_2_server`, fast-forwards the checkout, rebuilds/restarts as needed, verifies health, and leaves the network. It preserves gitignored runtime data on the server; do not add steps that clobber the tree or commit secrets.

## Local development

`cd web && npm run dev` for the SPA. Don't point a local gateway at the production fabric — prefer shipping via the deploy pipeline over running a competing controller. See [AGENTS.md](AGENTS.md) for the rest.
