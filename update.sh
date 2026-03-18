#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# PushHive — Update Script
# Checks GitHub for new version, updates if available
# ─────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/dhirendralive9/pushhive.git"
REPO_RAW="https://raw.githubusercontent.com/dhirendralive9/pushhive/main/package.json"
DEFAULT_DIR="/opt/pushhive"

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║           PushHive Updater v1.1              ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Find Install Directory ───────────────────────────────────────
if [ -f "$DEFAULT_DIR/.env" ] && [ -f "$DEFAULT_DIR/docker-compose.yml" ]; then
  INSTALL_DIR="$DEFAULT_DIR"
else
  echo -e "${YELLOW}PushHive not found at $DEFAULT_DIR${NC}"
  read -p "Enter your PushHive install directory: " INSTALL_DIR

  if [ -z "$INSTALL_DIR" ]; then
    echo -e "${RED}No directory provided. Aborting.${NC}"
    exit 1
  fi

  if [ ! -f "$INSTALL_DIR/.env" ] || [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo -e "${RED}✗ Not a valid PushHive installation at $INSTALL_DIR${NC}"
    exit 1
  fi
fi

cd "$INSTALL_DIR"
echo -e "${BOLD}Install directory:${NC} $INSTALL_DIR"

# ── Get Current Version ──────────────────────────────────────────
CURRENT_VER="unknown"

# Method 1: Read from package.json on disk
if [ -f "$INSTALL_DIR/package.json" ]; then
  CURRENT_VER=$(grep '"version"' "$INSTALL_DIR/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
fi

# Method 2: Ask the running app (more accurate)
APP_PORT=$(grep "^APP_PORT=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d'=' -f2 || echo "3000")
APP_PORT=${APP_PORT:-3000}
RUNNING_VER=$(curl -sf "http://localhost:${APP_PORT}/version" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "")
if [ -n "$RUNNING_VER" ]; then
  CURRENT_VER="$RUNNING_VER"
fi

echo -e "${BOLD}Current version:${NC}  $CURRENT_VER"

# ── Check Latest Version on GitHub ───────────────────────────────
echo -e "  Checking GitHub for updates..."
LATEST_VER=$(curl -sf "$REPO_RAW" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "")

if [ -z "$LATEST_VER" ]; then
  echo -e "${YELLOW}  Could not fetch version from GitHub. Continuing anyway...${NC}"
  LATEST_VER="unknown"
fi

echo -e "${BOLD}Latest version:${NC}   $LATEST_VER"
echo ""

# ── Compare Versions ─────────────────────────────────────────────
if [ "$CURRENT_VER" = "$LATEST_VER" ] && [ "$LATEST_VER" != "unknown" ]; then
  echo -e "${GREEN}✓ You're already on the latest version ($CURRENT_VER)${NC}"
  echo ""
  read -p "Force update anyway? (y/n) [n]: " FORCE
  FORCE=${FORCE:-n}
  if [ "$FORCE" != "y" ] && [ "$FORCE" != "Y" ]; then
    echo "  No update needed."
    exit 0
  fi
else
  if [ "$LATEST_VER" != "unknown" ] && [ "$CURRENT_VER" != "unknown" ]; then
    echo -e "${CYAN}Update available: $CURRENT_VER → $LATEST_VER${NC}"
  fi
  read -p "Proceed with update? (y/n) [y]: " PROCEED
  PROCEED=${PROCEED:-y}
  if [ "$PROCEED" != "y" ] && [ "$PROCEED" != "Y" ]; then
    echo "  Update cancelled."
    exit 0
  fi
fi

echo ""

# ── Step 1: Backup ──────────────────────────────────────────────
echo -e "${BOLD}[1/4] Backing up...${NC}"

BACKUP_DIR="${INSTALL_DIR}/backups/$(date +%Y%m%d_%H%M%S)_v${CURRENT_VER}"
mkdir -p "$BACKUP_DIR"

cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env.backup"
echo -e "  ✓ .env backed up"

docker compose exec -T mongo mongodump --db=pushhive --out=/dump/backup_latest > /dev/null 2>&1 && {
  docker compose cp mongo:/dump/backup_latest "$BACKUP_DIR/mongo_dump" > /dev/null 2>&1 || true
  echo -e "  ✓ MongoDB backed up"
} || {
  echo -e "  ${YELLOW}⚠ MongoDB backup skipped${NC}"
}

echo -e "${GREEN}✓ Backup → $BACKUP_DIR${NC}"
echo ""

# ── Step 2: Pull from GitHub ────────────────────────────────────
echo -e "${BOLD}[2/4] Downloading latest from GitHub...${NC}"

TEMP_DIR=$(mktemp -d)

git clone --depth 1 "$REPO_URL" "$TEMP_DIR/pushhive" 2>&1 | tail -3 || {
  echo -e "${RED}✗ Git clone failed. Check your internet connection.${NC}"
  rm -rf "$TEMP_DIR"
  exit 1
}

echo -e "${GREEN}✓ Downloaded${NC}"

# Copy new files, preserve .env and backups
echo -e "  Copying new files..."
cp "$INSTALL_DIR/.env" /tmp/pushhive_env_safe

# Use rsync if available, otherwise manual copy
if command -v rsync &> /dev/null; then
  rsync -a \
    --exclude='.env' \
    --exclude='backups' \
    --exclude='node_modules' \
    --exclude='.git' \
    "$TEMP_DIR/pushhive/" "$INSTALL_DIR/"
else
  # Manual copy — skip protected files
  cd "$TEMP_DIR/pushhive"
  find . -type f \
    ! -path './.env' \
    ! -path './backups/*' \
    ! -path './node_modules/*' \
    ! -path './.git/*' \
    -exec cp --parents {} "$INSTALL_DIR/" \;
  cd "$INSTALL_DIR"
fi

# Restore .env
cp /tmp/pushhive_env_safe "$INSTALL_DIR/.env"
rm -f /tmp/pushhive_env_safe

# Add any new .env variables from .env.example
if [ -f "$INSTALL_DIR/.env.example" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    KEY=$(echo "$line" | cut -d'=' -f1)
    if ! grep -q "^${KEY}=" "$INSTALL_DIR/.env" 2>/dev/null; then
      echo "$line" >> "$INSTALL_DIR/.env"
      echo -e "  ${YELLOW}New config: ${KEY}${NC}"
    fi
  done < "$INSTALL_DIR/.env.example"
fi

rm -rf "$TEMP_DIR"

UPDATED_VER=$(grep '"version"' "$INSTALL_DIR/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo -e "${GREEN}✓ Files updated to v${UPDATED_VER}${NC}"
echo ""

# ── Step 3: Rebuild & Restart ───────────────────────────────────
echo -e "${BOLD}[3/4] Rebuilding containers...${NC}"

cd "$INSTALL_DIR"
docker compose build
docker compose up -d

echo -e "  Waiting for services to be healthy..."
RETRIES=20
until curl -sf "http://localhost:${APP_PORT}/health" > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo -e "${RED}✗ App not responding after rebuild.${NC}"
    echo -e "${YELLOW}  Check logs: docker compose logs -f app${NC}"
    echo -e "${YELLOW}  To rollback: cp $BACKUP_DIR/.env.backup .env && docker compose up -d --build${NC}"
    exit 1
  fi
  sleep 3
done

echo -e "${GREEN}✓ Containers rebuilt and healthy${NC}"
echo ""

# ── Step 4: Verify ──────────────────────────────────────────────
echo -e "${BOLD}[4/4] Verifying...${NC}"

HEALTH=$(curl -sf "http://localhost:${APP_PORT}/health" 2>/dev/null || echo '{}')
RUNNING_VER=$(echo "$HEALTH" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "$UPDATED_VER")
MONGO_STATUS=$(echo "$HEALTH" | grep -o '"mongo":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
MEMORY=$(echo "$HEALTH" | grep -o '"memory":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

echo -e "  Version: ${GREEN}$RUNNING_VER${NC}"
echo -e "  MongoDB: ${GREEN}$MONGO_STATUS${NC}"
echo -e "  Memory:  $MEMORY"
echo ""

# ── Done ─────────────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        PushHive Updated Successfully!        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Updated:${NC}  $CURRENT_VER → $RUNNING_VER"
echo -e "  ${BOLD}Backup:${NC}   $BACKUP_DIR"
echo ""
echo -e "${BOLD}Rollback:${NC}"
echo -e "  cd $INSTALL_DIR"
echo -e "  cp $BACKUP_DIR/.env.backup .env"
echo -e "  docker compose up -d --build"
echo ""
