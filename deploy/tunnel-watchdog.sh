#!/bin/zsh
# Tunnel watchdog for kl_2_server. Run every 120s by com.matterhome.watchdog.
#
# The gateway can be perfectly healthy while cloudflared has silently lost its
# connection to Cloudflare's edge — that surfaces as an error 1033 page on the
# public URL while :8788 keeps serving fine on the LAN. launchd's KeepAlive
# can't catch it, because the cloudflared process is still alive. So probe both
# ends and kickstart the tunnel only when the gateway is up and the public URL
# is not.
#
# Deliberately does nothing when the gateway itself is down (that's not a tunnel
# fault) or when the server has no internet at all (restarting cloudflared can't
# fix an ISP outage, and retrying every 2 min would just churn).
#
# Logs to ~/Library/Logs/matterhome/watchdog.log.
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

REPO="${REPO:-$HOME/matter-home}"
PUBLIC_URL="${PUBLIC_URL:-https://home.sigma-rahul.com/}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8788/api/health}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8788/}"
UPSTREAM_URL="${UPSTREAM_URL:-https://www.cloudflare.com/cdn-cgi/trace}"
# AGENT and STATE are overridable so the deploy can self-test the decision path
# against a throwaway label and state file without disturbing the live tunnel.
AGENT="${AGENT:-gui/$(id -u)/com.matterhome.tunnel}"
STATE="${STATE:-$HOME/.matterhome/watchdog.state}"

# Act only after FAIL_THRESHOLD consecutive bad probes (~4 min) so a single
# blip is ridden out, and never restart more often than the cooldown. After
# BACKOFF_AFTER restarts that didn't bring the public URL back, the fault is
# almost certainly upstream — stretch the cooldown instead of hammering it.
FAIL_THRESHOLD=2
RESTART_COOLDOWN=600
BACKOFF_AFTER=3
BACKOFF_COOLDOWN=3600

log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$(dirname "$STATE")"
FAILS=0 RESTARTS=0 LAST_RESTART=0
[ -f "$STATE" ] && . "$STATE"

save_state() {
  printf 'FAILS=%d\nRESTARTS=%d\nLAST_RESTART=%d\n' \
    "$FAILS" "$RESTARTS" "$LAST_RESTART" > "$STATE"
}

probe() { curl -fs -m 10 -o /dev/null "$1"; }

# The gateway health endpoint is token-authenticated; fall back to the SPA root
# (unauthenticated, 200) if .env can't be read for any reason.
gateway_ok() {
  local token
  token=$(grep -oE 'GW_TOKEN=.*' "$REPO/gateway/.env" 2>/dev/null | cut -d= -f2)
  if [ -n "${token:-}" ]; then
    curl -fs -m 10 -o /dev/null -H "Authorization: Bearer $token" "$HEALTH_URL"
  else
    probe "$GATEWAY_URL"
  fi
}

if probe "$PUBLIC_URL"; then
  # Healthy. Clear the counters so a later fault starts from a clean slate.
  if [ "$FAILS" -ne 0 ] || [ "$RESTARTS" -ne 0 ]; then
    log "public URL healthy again (after $FAILS failed probes, $RESTARTS restarts)"
    FAILS=0 RESTARTS=0
    save_state
  fi
  exit 0
fi

if ! gateway_ok; then
  log "public URL down, but the gateway is down too — not a tunnel fault, leaving it alone"
  FAILS=0
  save_state
  exit 0
fi

if ! probe "$UPSTREAM_URL"; then
  log "public URL down and the server has no internet — restarting the tunnel would not help"
  FAILS=0
  save_state
  exit 0
fi

FAILS=$((FAILS + 1))
if [ "$FAILS" -lt "$FAIL_THRESHOLD" ]; then
  log "public URL down (gateway healthy) — probe $FAILS/$FAIL_THRESHOLD, waiting for confirmation"
  save_state
  exit 0
fi

COOLDOWN=$RESTART_COOLDOWN
[ "$RESTARTS" -ge "$BACKOFF_AFTER" ] && COOLDOWN=$BACKOFF_COOLDOWN
NOW=$(date +%s)
SINCE=$((NOW - LAST_RESTART))
if [ "$SINCE" -lt "$COOLDOWN" ]; then
  log "public URL still down, but last restart was ${SINCE}s ago (cooldown ${COOLDOWN}s) — holding off"
  save_state
  exit 0
fi

log "public URL down while the gateway is healthy — restarting the tunnel (restart #$((RESTARTS + 1)))"
if launchctl kickstart -k "$AGENT"; then
  RESTARTS=$((RESTARTS + 1))
  LAST_RESTART=$NOW
  FAILS=0
  save_state
  # Give cloudflared a moment to re-establish before reporting the outcome.
  for i in $(seq 1 15); do
    sleep 2
    if probe "$PUBLIC_URL"; then
      log "tunnel restarted — public URL back up"
      RESTARTS=0
      save_state
      exit 0
    fi
  done
  log "tunnel restarted but the public URL is still down"
else
  log "launchctl kickstart $AGENT failed"
  save_state
fi
