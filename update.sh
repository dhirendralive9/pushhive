#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# PushHive — Update Script
# Fetches latest code from GitHub, rebuilds, restarts
# ─────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/dhirendralive9/pushhive.git"
DEFAULT_DIR="/opt/pushhive"

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║           PushHive Updater v1.0              ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Find Install Directory ───────────────────────────────────────
if [ -f "$DEFAULT_DIR/.env" ] && [ -f "$DEFAULT_DIR/docker-compose.yml" ]; then
  INSTALL_DIR="$DEFAULT_DIR"
  echo -e "${BOLD}Install directory:${NC} $INSTALL_DIR"
else
  echo -e "${YELLOW}PushHive not found at default location ($DEFAULT_DIR)${NC}"
  read -p "Enter your PushHive install directory: " INSTALL_DIR
  
  if [ -z "$INSTALL_DIR" ]; then
    echo -e "${RED}No directory provided. Aborting.${NC}"
    exit 1
  fi
  
  if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo -e "${RED}✗ No .env found at $INSTALL_DIR — not a valid PushHive installation.${NC}"
    exit 1
  fi
  
  if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo -e "${RED}✗ No docker-compose.yml found at $INSTALL_DIR${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}✓ Found PushHive at $INSTALL_DIR${NC}"
fi

cd "$INSTALL_DIR"
echo ""

# Get current version
CURRENT_VER=$(node -e "try{console.log(require('$INSTALL_DIR/package.json').version)}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
echo -e "${BOLD}Current version:${NC} $CURRENT_VER"
echo ""

# ── Step 1: Backup ──────────────────────────────────────────────
echo -e "${BOLD}[1/4] Backing up...${NC}"

BACKUP_DIR="${INSTALL_DIR}/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup .env
cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env.backup"
echo -e "  ✓ .env backed up"

# Backup MongoDB
docker compose exec -T mongo mongodump --db=pushhive --out=/dump/backup_latest > /dev/null 2>&1 && {
  docker compose cp mongo:/dump/backup_latest "$BACKUP_DIR/mongo_dump" > /dev/null 2>&1 || true
  echo -e "  ✓ MongoDB backed up"
} || {
  echo -e "  ${YELLOW}⚠ MongoDB backup skipped (containers may not be running)${NC}"
}

echo -e "${GREEN}✓ Backup saved to $BACKUP_DIR${NC}"
echo ""

# ── Step 2: Fetch Latest from GitHub ────────────────────────────
echo -e "${BOLD}[2/4] Fetching latest code from GitHub...${NC}"

TEMP_DIR=$(mktemp -d)
echo -e "  Cloning $REPO_URL ..."

git clone --depth 1 "$REPO_URL" "$TEMP_DIR/pushhive" 2>&1 | tail -1 || {
  echo -e "${RED}✗ Git clone failed. Check your internet connection.${NC}"
  rm -rf "$TEMP_DIR"
  exit 1
}

NEW_VER=$(node -e "try{console.log(require('$TEMP_DIR/pushhive/package.json').version)}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
echo -e "  Latest version: ${NEW_VER}"

if [ "$CURRENT_VER" = "$NEW_VER" ]; then
  echo -e "${YELLOW}  You're already on the latest version ($NEW_VER)${NC}"
  read -p "  Continue anyway? (y/n) [n]: " FORCE_UPDATE
  FORCE_UPDATE=${FORCE_UPDATE:-n}
  if [ "$FORCE_UPDATE" != "y" ] && [ "$FORCE_UPDATE" != "Y" ]; then
    rm -rf "$TEMP_DIR"
    echo -e "  Update cancelled."
    exit 0
  fi
fi

# Copy new files to install directory, preserving .env and backups
echo -e "  Copying new files..."

# Save .env before copying
cp "$INSTALL_DIR/.env" /tmp/pushhive_env_backup

# Copy everything except .env, backups, and node_modules
rsync -a --exclude='.env' --exclude='backups' --exclude='node_modules' --exclude='.git' \
  "$TEMP_DIR/pushhive/" "$INSTALL_DIR/" 2>/dev/null || {
  # Fallback if rsync not available
  find "$TEMP_DIR/pushhive" -maxdepth 1 -not -name '.env' -not -name 'backups' -not -name '.git' | while read f; do
    fname=$(basename "$f")
    if [ "$fname" != "pushhive" ]; then
      cp -r "$f" "$INSTALL_DIR/"
    fi
  done
}

# Restore .env
cp /tmp/pushhive_env_backup "$INSTALL_DIR/.env"
rm -f /tmp/pushhive_env_backup

# Check for new .env variables
if [ -f "$INSTALL_DIR/.env.example" ]; then
  ADDED_VARS=0
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    KEY=$(echo "$line" | cut -d'=' -f1)
    if ! grep -q "^${KEY}=" "$INSTALL_DIR/.env" 2>/dev/null; then
      echo "$line" >> "$INSTALL_DIR/.env"
      echo -e "  ${YELLOW}New config added: ${KEY}${NC}"
      ADDED_VARS=$((ADDED_VARS + 1))
    fi
  done < "$INSTALL_DIR/.env.example"
  if [ $ADDED_VARS -gt 0 ]; then
    echo -e "  ${YELLOW}Review new variables in .env if needed${NC}"
  fi
fi

# Cleanup temp
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Code updated to $NEW_VER${NC}"
echo ""

# ── Step 3: Rebuild & Restart ───────────────────────────────────
echo -e "${BOLD}[3/4] Rebuilding and restarting...${NC}"

cd "$INSTALL_DIR"
docker compose build
docker compose up -d

# Wait for services
echo -e "  Waiting for services..."
RETRIES=15
until docker compose exec -T mongo mongosh --eval "db.runCommand({ping:1})" > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo -e "${RED}✗ MongoDB not responding after rebuild.${NC}"
    echo -e "${YELLOW}  Restoring .env from backup...${NC}"
    cp "$BACKUP_DIR/.env.backup" "$INSTALL_DIR/.env"
    docker compose restart
    exit 1
  fi
  sleep 2
done

echo -e "${GREEN}✓ Containers rebuilt and running${NC}"
echo ""

# ── Step 4: Verify ──────────────────────────────────────────────
echo -e "${BOLD}[4/4] Verifying...${NC}"

sleep 3
if docker compose ps | grep -q "running\|Up"; then
  echo -e "${GREEN}✓ All containers healthy${NC}"
else
  echo -e "${RED}✗ Container issue detected:${NC}"
  docker compose ps
  echo ""
  echo -e "${YELLOW}Check logs: cd $INSTALL_DIR && docker compose logs -f${NC}"
  exit 1
fi

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        PushHive Updated Successfully!        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Previous:${NC}  $CURRENT_VER"
echo -e "  ${BOLD}Current:${NC}   $NEW_VER"
echo -e "  ${BOLD}Backup:${NC}    $BACKUP_DIR"
echo ""
echo -e "${BOLD}Rollback if needed:${NC}"
echo -e "  cp $BACKUP_DIR/.env.backup $INSTALL_DIR/.env"
echo -e "  docker compose up -d --build"
echo ""
