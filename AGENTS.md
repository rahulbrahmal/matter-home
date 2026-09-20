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

**Second known failure mode — half-dead tunnel (blank app, no 1033).** Seen 2026-09-20: `https://home.sigma-rahul.com/` returned 200 and small files (index.html, manifest, the 8 KB icon) loaded, but every response above roughly 16 KB — the SPA bundle, its CSS, the 19 KB icon — stalled until the client gave up. The app opened to a blank white page and the lights "stopped working". Over the LAN the same files downloaded in about a second, so this is cloudflared's edge connection, not the gateway. The original watchdog only fetched `/`, so it saw a healthy tunnel and never restarted it. Both the watchdog and the deploy now probe the app bundle referenced by index.html (`deploy/tunnel-watchdog.sh --check` does just that probe). Quick way to tell the two modes apart from any machine:

```sh
curl -s -o /dev/null -m 15 -w '%{http_code} %{size_download}\n' https://home.sigma-rahul.com/icons/icon-512.png
```

`200 19007` is healthy. A `000 0` timeout while `/` still answers is this mode.

**Root cause found on 2026-09-20: it was not the tunnel. The server's TCP stack was wedged.** The same 19 KB file stalled from the server itself over `localhost`, `127.0.0.1`, `::1` and its own LAN IP, and so did a throwaway Python HTTP server, while ZeroTier clients got it in a second. Every local transfer delivered exactly one segment and then hung. Evidence that the kernel's TCP timers had stopped firing: 62,900 sockets in `TIME_WAIT` that never expired (flat over 20 s; they should live 15 s), 225 `nc -z -G 1` processes from a Sep 3 LAN port sweep still in `SYN_SENT` with their 1-second timeout never fired, 130+ orphaned `::1.8788` sockets in `CLOSING` holding ~72 KB of the app bundle each that never retransmitted, and `netstat -m` showing the 16 KB mbuf cluster pool (`lo0` MTU is 16384) at `494/507` in use. cloudflared proxies to `localhost:8788`, so the public URL broke first; the gateway ↔ matter-server WebSocket over `::1.5580` had 400 KB queued too. Uptime was 243 days on macOS 26.2.

Things that did **not** help, so don't repeat them: restarting cloudflared, upgrading it (2026.8.2 → 2026.9.1, kept), restarting the gateway, and `sudo ifconfig lo0 mtu 1500` (segments shrank to 1448 bytes and still only the first one arrived). Orphaned kernel sockets belong to no process, so there is nothing to kill. The watchdog now detects this state (`origin_large_ok`) and logs it instead of restarting the tunnel.

**The fix is a reboot**, which needs root; the `kl_2_server` account's sudo prompts for a password, so an agent over SSH cannot do it. **Before rebooting:** the box has no auto-login configured and FileVault is off, so after a restart it sits at the login window and none of the `gui/` launch agents (matterserver, gateway, tunnel, watchdog) start until someone logs in, locally or via Screen Sharing (the ARD agent is running). Either log in afterwards, or enable auto-login first with `sysadminctl -autologin set -userName kl_2_server -password -` (prompts for the password). The same Mac also runs Scrypted under user `pi`, and something on it had opened 36,000 HTTPS connections that sat in `TIME_WAIT`; worth a look after the reboot so this doesn't recur.

**Self-healing.** `deploy/tunnel-watchdog.sh` runs every 120s under `com.matterhome.watchdog` and kickstarts the tunnel when the public URL is down (index.html or the app bundle it references fails to load) *and* the gateway is healthy *and* the server has internet. It requires two consecutive bad probes, waits 10 min between restarts, and backs off to hourly after three restarts that didn't restore service — so a Cloudflare-side outage isn't met with a restart loop. Logs to `~/Library/Logs/matterhome/watchdog.log`.

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
