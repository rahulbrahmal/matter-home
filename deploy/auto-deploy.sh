#!/bin/zsh
# LEGACY / UNUSED. Production deploys now run via .github/workflows/deploy-server.yml
# (push to main -> GitHub runner joins ZeroTier -> SSHes into kl_2_server -> pull/build/restart).
# This poll-based deployer is kept for reference only and is not wired to any launchd agent.
#
# Auto-deploy: poll origin/main; on new commits -> pull, build the SPA, restart the gateway if its code changed.
# Logs to ~/Library/Logs/matterhome/deploy.log.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
REPO="${REPO:-$HOME/Developer/matter-home}"
cd "$REPO"

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0   # up to date — nothing to do
# only fast-forward: if local has commits origin lacks (mid-dev), do NOT clobber them
if [ -n "$(git rev-list origin/main..HEAD)" ]; then echo "[$(date '+%F %T')] local ahead/diverged — skipping"; exit 0; fi

echo "[$(date '+%F %T')] deploying $LOCAL -> $REMOTE"
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
git reset --hard origin/main --quiet

# rebuild if web changed OR the built output is missing/incomplete
if echo "$CHANGED" | grep -q '^web/' || [ ! -f "$REPO/web/dist/manifest.json" ]; then
  cd web
  if echo "$CHANGED" | grep -q '^web/package'; then npm install --no-audit --no-fund; fi
  npm run build
  cd ..
  echo "  web rebuilt"
fi

if echo "$CHANGED" | grep -q '^gateway/'; then
  launchctl kickstart -k "gui/$(id -u)/com.matterhome.gateway"
  echo "  gateway restarted"
fi
echo "[$(date '+%F %T')] deployed $(git rev-parse --short HEAD)"

# self-update the out-of-repo copy that launchd actually runs (survives broken checkouts)
cp "$REPO/deploy/auto-deploy.sh" "$HOME/.matterhome/auto-deploy.sh" 2>/dev/null || true
