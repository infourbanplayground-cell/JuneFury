#!/usr/bin/env bash
# Run this from your LOCAL machine (the one that has the repo cloned).
# Usage: bash server/deploy.sh
# Requires: the urbanpadel-owner-key set up in ~/.ssh/config as "urbanpadel"
#           (or adjust SSH_HOST below)

set -e
SSH_HOST="urbanpadel"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== 1. Copy API files to server ==="
ssh "$SSH_HOST" 'mkdir -p /opt/june-fury-api'
scp "$REPO_ROOT/server/api.js"        "$SSH_HOST:/opt/june-fury-api/api.js"
scp "$REPO_ROOT/server/package.json"  "$SSH_HOST:/opt/june-fury-api/package.json"

echo "=== 2. Copy site to web root ==="
scp "$REPO_ROOT/index.html"           "$SSH_HOST:/var/www/urbanpadel.om/public/index.html"

echo "=== 3. Install Node.js (if needed) + npm deps ==="
ssh "$SSH_HOST" '
  if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  cd /opt/june-fury-api && npm install --production
'

echo "=== 4. Create .env (if not already present) ==="
ssh "$SSH_HOST" '
  if [ ! -f /opt/june-fury-api/.env ]; then
    cat > /opt/june-fury-api/.env << EOF
DATABASE_URL=postgresql://urbanpadel_app:FeaihAJAIUEL8c9BjCY4BPGj@127.0.0.1:5432/urbanpadel
ADMIN_PIN=CHANGE_ME
SCORER_PIN=CHANGE_ME
TOKEN_SECRET=$(openssl rand -base64 48)
PORT=3001
EOF
    echo "IMPORTANT: edit /opt/june-fury-api/.env and set ADMIN_PIN and SCORER_PIN"
  else
    echo ".env already exists — skipping"
  fi
'

echo "=== 5. Install + start systemd service ==="
scp "$REPO_ROOT/server/june-fury-api.service" "$SSH_HOST:/etc/systemd/system/june-fury-api.service"
ssh "$SSH_HOST" '
  systemctl daemon-reload
  systemctl enable june-fury-api
  systemctl restart june-fury-api
  sleep 2
  systemctl status june-fury-api --no-pager | head -8
'

echo "=== 6. Patch nginx config ==="
ssh "$SSH_HOST" '
  CONF=/etc/nginx/sites-available/urbanpadel.om
  if ! grep -q "june-fury" "$CONF"; then
    # Insert API proxy before the first location / block
    sed -i "/location \/ {/i\\
    location ~ ^\\/(state|login|save)\\$ {\\
        proxy_pass         http:\\/\\/127.0.0.1:3001;\\
        proxy_http_version 1.1;\\
        proxy_set_header   Host \\$host;\\
        proxy_read_timeout 30s;\\
        add_header         Access-Control-Allow-Origin  \"https:\\/\\/urbanpadel.om\" always;\\
        add_header         Access-Control-Allow-Methods \"GET, POST, OPTIONS\" always;\\
        add_header         Access-Control-Allow-Headers \"Content-Type, Authorization\" always;\\
        if (\\$request_method = OPTIONS) { return 204; }\\
    }\\
" "$CONF"
    nginx -t && systemctl reload nginx && echo "nginx reloaded OK"
  else
    echo "nginx already patched"
  fi
'

echo ""
echo "=== DONE ==="
echo "Visit https://urbanpadel.om — the JUNE FURY app should be live."
echo ""
echo "IMPORTANT: Set your PINs on the server:"
echo "  ssh urbanpadel 'nano /opt/june-fury-api/.env'"
echo "  ssh urbanpadel 'systemctl restart june-fury-api'"
