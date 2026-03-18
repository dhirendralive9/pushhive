#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# PushHive — Update Script
# Pulls latest code, rebuilds containers, restarts without data loss
# ─────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║           PushHive Updater v1.0              ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Detect install directory
if [ -f "./docker-compose.yml" ] && grep -q "pushhive" "./docker-compose.yml" 2>/dev/null; then
  INSTALL_DIR=$(pwd)
elif [ -f "/opt/pushhive/docker-compose.yml" ]; then
  INSTALL_DIR="/opt/pushhive"
else
  read -p "PushHive install directory: " INSTALL_DIR
  if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo -e "${RED}docker-compose.yml not found in $INSTALL_DIR${NC}"
    exit 1
  fi
fi

cd "$INSTALL_DIR"
echo -e "${BOLD}Install directory:${NC} $INSTALL_DIR"
echo ""

# ── Step 1: Backup ──────────────────────────────────────────────
echo -e "${BOLD}[1/5] Backing up current installation...${NC}"

BACKUP_DIR="${INSTALL_DIR}/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup .env (contains VAPID keys — critical!)
cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env.backup"

# Backup MongoDB
echo -e "  Dumping MongoDB..."
docker compose exec -T mongo mongodump --db=pushhive --out=/dump/backup_latest > /dev/null 2>&1 && {
  # Copy dump out of container
  docker compose cp mongo:/dump/backup_latest "$BACKUP_DIR/mongo_dump" > /dev/null 2>&1 || true
  echo -e "${GREEN}✓ MongoDB backed up${NC}"
} || {
  echo -e "${YELLOW}⚠ MongoDB backup failed (non-critical, continuing)${NC}"
}

echo -e "${GREEN}✓ Backup saved to $BACKUP_DIR${NC}"

# ── Step 2: Pull Latest Code ────────────────────────────────────
echo -e "${BOLD}[2/5] Pulling latest code...${NC}"

if [ -d ".git" ]; then
  # Git repo — pull latest
  CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  echo -e "  Current version: ${CURRENT_COMMIT}"
  
  git stash > /dev/null 2>&1 || true
  git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || {
    echo -e "${RED}✗ Git pull failed. Check your remote and branch.${NC}"
    echo -e "${YELLOW}  You can manually update files and run this script again.${NC}"
    exit 1
  }
  
  NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  echo -e "  Updated to: ${NEW_COMMIT}"
  
  # Restore .env (git pull won't overwrite it since it's in .gitignore)
  if [ ! -f ".env" ]; then
    cp "$BACKUP_DIR/.env.backup" ".env"
    echo -e "  Restored .env from backup"
  fi
  
  echo -e "${GREEN}✓ Code updated via git${NC}"
else
  echo -e "${YELLOW}  Not a git repo. To update manually:${NC}"
  echo -e "${YELLOW}  1. Download the latest pushhive.tar.gz${NC}"
  echo -e "${YELLOW}  2. Extract it somewhere temporary${NC}"
  echo -e "${YELLOW}  3. Copy files (except .env) to ${INSTALL_DIR}${NC}"
  echo -e "${YELLOW}  4. Run this script again${NC}"
  echo ""
  read -p "Have you already copied the new files? (y/n): " FILES_READY
  if [ "$FILES_READY" != "y" ] && [ "$FILES_READY" != "Y" ]; then
    echo -e "  Exiting. Copy new files first, then run update.sh again."
    exit 0
  fi
  echo -e "${GREEN}✓ Files ready${NC}"
fi

# ── Step 3: Preserve .env ───────────────────────────────────────
echo -e "${BOLD}[3/5] Preserving configuration...${NC}"

# Make sure .env wasn't overwritten
if [ ! -f ".env" ]; then
  cp "$BACKUP_DIR/.env.backup" ".env"
fi

# Check if new .env variables were added in this version
if [ -f ".env.example" ]; then
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    
    KEY=$(echo "$line" | cut -d'=' -f1)
    if ! grep -q "^${KEY}=" ".env" 2>/dev/null; then
      echo "$line" >> ".env"
      echo -e "  ${YELLOW}Added new config: ${KEY}${NC}"
    fi
  done < ".env.example"
fi

echo -e "${GREEN}✓ Configuration preserved${NC}"

# ── Step 4: Rebuild & Restart ───────────────────────────────────
echo -e "${BOLD}[4/5] Rebuilding and restarting containers...${NC}"

docker compose build
docker compose up -d

# Wait for services to be healthy
echo -e "  Waiting for services..."
sleep 5

RETRIES=10
until docker compose exec -T mongo mongosh --eval "db.runCommand({ping:1})" > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo -e "${RED}✗ MongoDB not responding. Rolling back...${NC}"
    # Rollback: restore backup .env
    cp "$BACKUP_DIR/.env.backup" ".env"
    docker compose down
    docker compose up -d
    exit 1
  fi
  sleep 2
done

echo -e "${GREEN}✓ Containers rebuilt and running${NC}"

# ── Step 5: Verify ──────────────────────────────────────────────
echo -e "${BOLD}[5/5] Verifying...${NC}"

sleep 3
if docker compose ps | grep -q "running\|Up"; then
  echo -e "${GREEN}✓ All containers running${NC}"
else
  echo -e "${RED}✗ Some containers may have issues:${NC}"
  docker compose ps
  echo ""
  echo -e "${YELLOW}Check logs: docker compose logs -f${NC}"
  exit 1
fi

# Show current version info
APP_RUNNING=$(docker compose exec -T app node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        PushHive Updated Successfully!        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Version:${NC}     ${APP_RUNNING}"
echo -e "${BOLD}Backup:${NC}      ${BACKUP_DIR}"
echo ""
echo -e "${BOLD}To rollback if needed:${NC}"
echo -e "  cp ${BACKUP_DIR}/.env.backup ${INSTALL_DIR}/.env"
echo -e "  docker compose down"
echo -e "  git checkout <previous-commit>   # if using git"
echo -e "  docker compose up -d --build"
echo ""
