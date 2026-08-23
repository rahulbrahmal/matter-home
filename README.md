# Matter Home

A self-hosted control surface for a Matter smart home — a warm, Apple-Home-style dashboard (SolidJS) on top of a lightweight gateway that talks to a [matter.js Matter Server](https://github.com/matter-js/matterjs-server) controller. Native mobile / iPad / desktop layouts, room & zone grouping, per-gang naming, consolidated climate (AC + power switch + humidity), scenes, and live (SSE) state.

## Architecture

```
Matter devices ──▶ matter-server (controller, ws://…:5580)
                      └──▶ gateway (Node, no deps) ──▶ SSE /api/stream + REST /api/* + serves the SPA
                              └──▶ web (SolidJS SPA) — login-gated, talks to the gateway
```

- **gateway/** — dependency-free Node ESM. Connects to matter-server, builds an enriched device model (rooms, floors, gangs, climate consolidation), streams deltas over SSE, takes commands, persists customizations, and serves the built SPA. Token-authenticated.
- **web/** — SolidJS + Vite. Login screen → dashboard. Configurable backend URL; sends the password as a bearer token.
- **tools/** — operational scripts, run with `node tools/<script>.mjs`: `extract-rich.mjs` (deep device extraction from matter-server), `name-from-live.mjs` / `friendly-names.mjs` (generate friendly device names into `device-map.json`).

## Auth (one shared secret)

The **password you log in with is the gateway's bearer token** (`GW_TOKEN`). The gateway rejects any `/api/*` request without it (header `Authorization: Bearer …`, or `?token=…` for the SSE stream). Set it in `gateway/.env` (gitignored).

## Run locally (in-house)

Prereqs: Node 22+, a running matter-server (`ws://localhost:5580`).

```sh
# 1. gateway
cd gateway
cp .env.example .env          # set GW_TOKEN to a long random string
cd ../web && npm install && npm run build   # builds the SPA the gateway serves
cd ../gateway && node --env-file=.env server.mjs
# open http://<this-host>:8788 and log in with GW_TOKEN
```

Data files (`tools/device-map.json`, `tools/home.json`, `gateway/config.json`) hold your home layout / customizations and are gitignored.

## CI / Deploy

- **CI** (`.github/workflows/ci.yml`) — syntax-checks the gateway and builds the SPA on every push.
- **Pages** (`.github/workflows/deploy-pages.yml`) — builds the SPA and deploys it to GitHub Pages. The hosted app is a password gate; it connects to whatever gateway URL you enter.
- **Server deploy** (`.github/workflows/deploy-server.yml`) — on push to `main` (paths under `gateway/`, `web/`, `tools/`, `deploy/`) or manual dispatch, a GitHub-hosted runner joins the ZeroTier network, SSHes into the production server, fast-forwards its checkout, rebuilds the SPA if `web/` changed, restarts the gateway if `gateway/` changed, verifies `/api/health`, then leaves the ZeroTier network. Pushing to `main` is the deploy. Requires repo secrets `ZEROTIER_NETWORK_ID`, `ZEROTIER_CENTRAL_TOKEN`, `ZEROTIER_HOST_IP`, `REMOTE_USER`, `REMOTE_PASSWORD`.
- **Production (always-on Mac, `kl_2_server`)** — three launchd agents (`com.matterhome.*`): `matterserver` (matter.js controller on :5580, bound to the LAN interface), `gateway` (serves API + built SPA on :8788), and `tunnel` (Cloudflare tunnel exposing the gateway at `home.sigma-rahul.com` over HTTPS, so the PWA works away from home). Deploys arrive via the `deploy-server` workflow above — the old poll-based `deploy/auto-deploy.sh` launchd agent is not used on this host.

## Dev

```sh
cd web && npm run dev      # Vite dev server, proxies /api to localhost:8788
```
