#!/usr/bin/env bash
# deploy.sh
# the Praecantator backend.
#
# Usage:
#   chmod +x deploy.sh   # first time only
#   ./deploy.sh

set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Pre-flight checks ──────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  error "Docker is not installed. Install Docker CE on Ubuntu "
  echo ""
  echo "  sudo apt-get update"
  echo "  sudo apt-get install -y ca-certificates curl"
  echo "  sudo install -m 0755 -d /etc/apt/keyrings"
  echo "  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \\"
  echo "       -o /etc/apt/keyrings/docker.asc"
  echo "  sudo chmod a+r /etc/apt/keyrings/docker.asc"
  echo "  echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \\"
  echo "       https://download.docker.com/linux/ubuntu \\"
  echo "       \$(. /etc/os-release && echo \"\$VERSION_CODENAME\") stable\" \\"
  echo "       | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null"
  echo "  sudo apt-get update"
  echo "  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \\"
  echo "       docker-buildx-plugin docker-compose-plugin"
  echo "  sudo usermod -aG docker \$USER && newgrp docker"
  echo ""
  exit 1
fi

if [ ! -f "Backend/.env" ]; then
  error "Backend/.env not found."
  warn "Run: cp Backend/.env.docker.example Backend/.env  then fill in all values."
  exit 1
fi

if [ ! -f "secrets/gcp-sa.json" ]; then
  error "secrets/gcp-sa.json not found."
  warn "Copy your GCP service-account key JSON to secrets/gcp-sa.json"
  exit 1
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
info "[1/5] Pulling latest code from git..."
git pull origin main

info "[2/5] Cleaning up old resources (preserving build cache)..."
# Just clean up dangling/untagged images
docker image prune -f
# Prune the build cache but keep the most recent 15GB to ensure fast rebuilds without disk exhaustion
docker builder prune -f --keep-storage 15GB 2>/dev/null || true

info "[3/5] Building fresh images and starting containers..."
docker compose up -d --build --remove-orphans

# Force nginx to reload its config in case the container was not recreated
# (nginx:alpine image unchanged = container kept alive, config not re-read)
docker compose exec nginx nginx -s reload 2>/dev/null || true

info "[4/5] Container status:"
docker compose ps

info "[5/5] Recent backend logs:"
docker compose logs --tail=80 backend

echo ""
info "Health check via nginx (port 80):"
echo "  Waiting up to 30s for backend to be reachable through nginx..."
for i in $(seq 1 6); do
  if curl -sf http://localhost/api/ping > /dev/null; then
    echo -e "${GREEN}✅ /api/ping returned OK — deployment successful!${NC}"
    exit 0
  fi
  echo "  Attempt $i/6 failed, retrying in 5s..."
  sleep 5
done
error "/api/ping check failed after 30s. Check the logs above."
echo "  docker compose logs backend"
echo "  docker compose logs nginx"
exit 1
