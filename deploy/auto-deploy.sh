#!/bin/zsh
# Auto-deploy: poll origin/main; on new commits -> pull, build the SPA, restart the gateway if its code changed.
# Run by launchd (com.matterhome.deploy) every 2 minutes on the host Mac. Logs to ~/Library/Logs/matterhome/deploy.log.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
REPO="${REPO:-$HOME/Developer/matter-home}"
cd "$REPO"

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0   # up to date — nothing to do

echo "[$(date '+%F %T')] deploying $LOCAL -> $REMOTE"
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
git reset --hard origin/main --quiet

if echo "$CHANGED" | grep -q '^web/'; then
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
