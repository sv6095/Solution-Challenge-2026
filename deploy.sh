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
info "[1/4] Pulling latest code from git..."
git pull origin main

info "[2/4] Building images and starting containers (this may take a while on first run)..."
docker compose up -d --build --remove-orphans

info "[3/4] Container status:"
docker compose ps

info "[4/4] Recent backend logs:"
docker compose logs --tail=80 backend

echo ""
info "Health check via nginx (port 80):"
sleep 10   # Give the backend time to fully initialise (torch load + scheduler start)
if curl -sf http://localhost/api/ping > /dev/null; then
  echo -e "${GREEN}✅ /api/ping returned OK — deployment successful!${NC}"
else
  error "/api/ping check failed. Check the logs above."
  echo "  docker compose logs backend"
  echo "  docker compose logs nginx"
  exit 1
fi
