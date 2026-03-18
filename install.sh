#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# PushHive — Self-Hosted Web Push Notification System
# Docker-based installer for any Linux server
# ─────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║           PushHive Installer v1.0            ║${NC}"
echo -e "${CYAN}${BOLD}║   Self-Hosted Web Push Notification System   ║${NC}"
echo -e "${CYAN}${BOLD}║            (Docker Edition)                  ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root (sudo bash install.sh)${NC}"
  exit 1
fi

# ── Gather Configuration ─────────────────────────────────────────
echo -e "${BOLD}Configuration${NC}"
echo "─────────────────────────────────────"

read -p "Domain name (e.g., push.example.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
  echo -e "${RED}Domain is required${NC}"
  exit 1
fi

read -p "Admin email: " ADMIN_EMAIL
if [ -z "$ADMIN_EMAIL" ]; then
  echo -e "${RED}Admin email is required${NC}"
  exit 1
fi

read -sp "Admin password (min 6 chars): " ADMIN_PASSWORD
echo ""
if [ ${#ADMIN_PASSWORD} -lt 6 ]; then
  echo -e "${RED}Password must be at least 6 characters${NC}"
  exit 1
fi

read -sp "Confirm password: " ADMIN_PASSWORD_CONFIRM
echo ""
if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]; then
  echo -e "${RED}Passwords do not match${NC}"
  exit 1
fi

read -p "Admin display name [Admin]: " ADMIN_NAME
ADMIN_NAME=${ADMIN_NAME:-Admin}

read -p "App port [3000]: " APP_PORT
APP_PORT=${APP_PORT:-3000}

read -p "Install directory [/opt/pushhive]: " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/pushhive}

read -p "Enable SSL with Let's Encrypt? (y/n) [y]: " ENABLE_SSL
ENABLE_SSL=${ENABLE_SSL:-y}

echo ""
echo -e "${BOLD}Cloudflare Turnstile (optional bot protection for login)${NC}"
echo -e "${CYAN}Get keys at: https://dash.cloudflare.com/turnstile${NC}"
read -p "Turnstile Site Key [skip]: " TURNSTILE_SITE_KEY
TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-}
if [ -n "$TURNSTILE_SITE_KEY" ]; then
  read -p "Turnstile Secret Key: " TURNSTILE_SECRET_KEY
  TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY:-}
else
  TURNSTILE_SECRET_KEY=""
  echo -e "${YELLOW}  Skipped — you can add Turnstile later in .env${NC}"
fi

echo ""
echo -e "${YELLOW}Installing PushHive...${NC}"
echo ""

# ── Step 1: Install Docker ──────────────────────────────────────
echo -e "${BOLD}[1/6] Installing Docker...${NC}"

# Detect package manager
detect_pkg_manager() {
  if command -v apt-get &> /dev/null; then
    PKG_MGR="apt"
  elif command -v dnf &> /dev/null; then
    PKG_MGR="dnf"
  elif command -v yum &> /dev/null; then
    PKG_MGR="yum"
  elif command -v apk &> /dev/null; then
    PKG_MGR="apk"
  elif command -v pacman &> /dev/null; then
    PKG_MGR="pacman"
  elif command -v zypper &> /dev/null; then
    PKG_MGR="zypper"
  else
    PKG_MGR="unknown"
  fi
}
detect_pkg_manager

pkg_install() {
  case "$PKG_MGR" in
    apt)    apt-get update -qq && apt-get install -y "$@" ;;
    dnf)    dnf install -y "$@" ;;
    yum)    yum install -y "$@" ;;
    apk)    apk add --no-cache "$@" ;;
    pacman) pacman -Sy --noconfirm "$@" ;;
    zypper) zypper install -y "$@" ;;
    *)      echo -e "${RED}Unknown package manager. Install $@ manually.${NC}" && return 1 ;;
  esac
}

# Ensure curl and git are available
for tool in curl git; do
  if ! command -v $tool &> /dev/null; then
    echo -e "  Installing $tool..."
    pkg_install $tool > /dev/null 2>&1 || true
  fi
done

if command -v docker &> /dev/null; then
  echo -e "${GREEN}✓ Docker already installed ($(docker --version | cut -d' ' -f3 | tr -d ','))${NC}"
else
  echo -e "  Downloading and installing Docker (this may take a minute)..."
  curl -fsSL https://get.docker.com | sh
  if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Docker auto-install failed.${NC}"
    echo -e "${YELLOW}  Try installing Docker manually for your distro:${NC}"
    echo -e "${YELLOW}  https://docs.docker.com/engine/install/${NC}"
    exit 1
  fi
  systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
  systemctl enable docker 2>/dev/null || true
  echo -e "${GREEN}✓ Docker installed${NC}"
fi

# Install Docker Compose plugin if not present
if docker compose version &> /dev/null; then
  echo -e "${GREEN}✓ Docker Compose available${NC}"
else
  echo -e "  Installing Docker Compose plugin..."

  # Try distro package first
  pkg_install docker-compose-plugin 2>/dev/null || {
    # Fallback: download binary directly (works on any Linux)
    echo -e "  Downloading Docker Compose binary..."
    ARCH=$(uname -m)
    COMPOSE_VER=$(curl -sf https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d'"' -f4)
    if [ -n "$COMPOSE_VER" ]; then
      curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-$(uname -s)-${ARCH}" \
        -o /usr/local/bin/docker-compose
      chmod +x /usr/local/bin/docker-compose
      mkdir -p /usr/local/lib/docker/cli-plugins
      ln -sf /usr/local/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
    fi
  }

  if docker compose version &> /dev/null; then
    echo -e "${GREEN}✓ Docker Compose installed${NC}"
  else
    echo -e "${RED}✗ Docker Compose installation failed. Please install manually:${NC}"
    echo -e "${RED}  https://docs.docker.com/compose/install/${NC}"
    exit 1
  fi
fi

# ── Step 2: Install Nginx ───────────────────────────────────────
echo -e "${BOLD}[2/6] Installing Nginx...${NC}"
if command -v nginx &> /dev/null; then
  echo -e "${GREEN}✓ Nginx already installed${NC}"
else
  echo -e "  Installing Nginx..."
  pkg_install nginx
  if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Nginx installation failed. Install it manually for your distro.${NC}"
    exit 1
  fi
  systemctl start nginx 2>/dev/null || service nginx start 2>/dev/null || true
  systemctl enable nginx 2>/dev/null || true
  echo -e "${GREEN}✓ Nginx installed${NC}"
fi

# ── Step 3: Setup Application Files ─────────────────────────────
echo -e "${BOLD}[3/6] Setting up PushHive...${NC}"
mkdir -p "$INSTALL_DIR"

# Copy project files
if [ -f "./package.json" ] && grep -q "pushhive" "./package.json" 2>/dev/null; then
  # Copy everything including hidden files
  cp -r ./* "$INSTALL_DIR/"
  cp ./.env.example "$INSTALL_DIR/" 2>/dev/null || true
  cp ./.dockerignore "$INSTALL_DIR/" 2>/dev/null || true
else
  echo -e "${RED}Please run this script from the PushHive project directory${NC}"
  exit 1
fi

cd "$INSTALL_DIR"

# Generate VAPID keys — use local Node if available, fallback to Docker
echo -e "  Generating VAPID keys..."

if command -v node &> /dev/null; then
  # Node.js is installed locally — use it directly
  echo -e "  Using local Node.js..."
  
  # Install web-push temporarily
  cd "$INSTALL_DIR"
  npm install web-push --save > /dev/null 2>&1
  
  VAPID_OUTPUT=$(node -e "
    const wp=require('web-push');
    const k=wp.generateVAPIDKeys();
    console.log('PUBLIC:'+k.publicKey);
    console.log('PRIVATE:'+k.privateKey);
  " 2>&1)
else
  # No local Node — use Docker
  echo -e "  Pulling Node.js image (first time may take a minute)..."
  docker pull node:20-alpine
  
  VAPID_OUTPUT=$(docker run --rm node:20-alpine sh -c "
    npm install web-push --silent 2>/dev/null && \
    node -e \"
      const wp=require('web-push');
      const k=wp.generateVAPIDKeys();
      console.log('PUBLIC:'+k.publicKey);
      console.log('PRIVATE:'+k.privateKey);
    \"
  " 2>&1)
fi

VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | grep '^PUBLIC:' | cut -d':' -f2-)
VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | grep '^PRIVATE:' | cut -d':' -f2-)

if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ]; then
  echo -e "${RED}✗ Failed to generate VAPID keys. Output was:${NC}"
  echo "$VAPID_OUTPUT"
  exit 1
fi
echo -e "${GREEN}✓ VAPID keys generated${NC}"

# Generate session secret
SESSION_SECRET=$(openssl rand -hex 32)

# Create .env file
cat > "$INSTALL_DIR/.env" << EOF
PORT=3000
APP_PORT=${APP_PORT}
MONGODB_URI=mongodb://mongo:27017/pushhive
SESSION_SECRET=${SESSION_SECRET}
VAPID_PUBLIC_KEY=${VAPID_PUBLIC}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE}
VAPID_EMAIL=${ADMIN_EMAIL}
NODE_ENV=production
TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY}
TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY}
EOF

chmod 600 "$INSTALL_DIR/.env"
echo -e "${GREEN}✓ Configuration created with VAPID keys${NC}"

# ── Step 4: Build & Start Docker Containers ─────────────────────
echo -e "${BOLD}[4/6] Building and starting containers...${NC}"

cd "$INSTALL_DIR"
docker compose down 2>/dev/null || true

echo -e "  Building PushHive image..."
docker compose build
if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Docker build failed${NC}"
  exit 1
fi

echo -e "  Starting containers..."
docker compose up -d
if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Failed to start containers. Logs:${NC}"
  docker compose logs --tail=30
  exit 1
fi

# Wait for MongoDB to be ready
echo -e "  Waiting for MongoDB to be ready..."
RETRIES=20
until docker compose exec -T mongo mongosh --eval "db.runCommand({ping:1})" > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo -e "${RED}✗ MongoDB failed to start. Checking logs:${NC}"
    docker compose logs mongo --tail=20
    exit 1
  fi
  echo -e "  Waiting... ($RETRIES attempts left)"
  sleep 3
done

echo -e "${GREEN}✓ MongoDB is ready${NC}"

# Check if app is running
sleep 3
if docker compose ps | grep -q "running\|Up"; then
  echo -e "${GREEN}✓ PushHive app is running${NC}"
else
  echo -e "${RED}✗ App container issue. Logs:${NC}"
  docker compose logs app --tail=30
  exit 1
fi

# ── Step 5: Seed Admin Account ──────────────────────────────────
echo -e "${BOLD}[5/6] Creating admin account...${NC}"

# Escape special characters in password for shell safety
ESCAPED_PASSWORD=$(printf '%q' "$ADMIN_PASSWORD")

docker compose exec -T app node seed.js "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_NAME"
echo -e "${GREEN}✓ Admin account created${NC}"

# ── Step 6: Configure Nginx + SSL ───────────────────────────────
echo -e "${BOLD}[6/6] Configuring Nginx reverse proxy...${NC}"

# Detect Nginx config style (Debian/Ubuntu vs CentOS/RHEL)
NGINX_CONF=""
if [ -d "/etc/nginx/sites-available" ]; then
  # Debian/Ubuntu style
  NGINX_CONF="/etc/nginx/sites-available/pushhive"
  NGINX_LINK="/etc/nginx/sites-enabled/pushhive"
elif [ -d "/etc/nginx/conf.d" ]; then
  # CentOS/RHEL/Alpine style
  NGINX_CONF="/etc/nginx/conf.d/pushhive.conf"
  NGINX_LINK=""
else
  mkdir -p /etc/nginx/conf.d
  NGINX_CONF="/etc/nginx/conf.d/pushhive.conf"
  NGINX_LINK=""
fi

cat > "$NGINX_CONF" << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 10M;
}
NGINXEOF

# Symlink if Debian/Ubuntu style
if [ -n "$NGINX_LINK" ]; then
  ln -sf "$NGINX_CONF" "$NGINX_LINK"
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
fi

nginx -t > /dev/null 2>&1
systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || nginx -s reload 2>/dev/null
echo -e "${GREEN}✓ Nginx configured${NC}"

# SSL with Let's Encrypt
if [ "$ENABLE_SSL" = "y" ] || [ "$ENABLE_SSL" = "Y" ]; then
  echo -e "  Setting up SSL with Let's Encrypt..."
  if ! command -v certbot &> /dev/null; then
    case "$PKG_MGR" in
      apt)    apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1 ;;
      dnf)    dnf install -y certbot python3-certbot-nginx > /dev/null 2>&1 ;;
      yum)    yum install -y certbot python3-certbot-nginx > /dev/null 2>&1 ;;
      *)      echo -e "${YELLOW}  Install certbot manually for your distro${NC}" ;;
    esac
  fi
  if command -v certbot &> /dev/null; then
    certbot --nginx -d "$DOMAIN" --email "$ADMIN_EMAIL" --agree-tos --non-interactive --redirect 2>/dev/null && {
      echo -e "${GREEN}✓ SSL certificate installed${NC}"
    } || {
      echo -e "${YELLOW}⚠ SSL setup failed. You can run manually later:${NC}"
      echo -e "${YELLOW}  certbot --nginx -d ${DOMAIN}${NC}"
    }
  fi
fi

# ── Done! ────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       PushHive Installed Successfully!       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}┌─ Login Credentials ──────────────────────────┐${NC}"
echo -e "${BOLD}│ Dashboard:${NC}  https://${DOMAIN}/dashboard"
echo -e "${BOLD}│ Email:${NC}      ${ADMIN_EMAIL}"
echo -e "${BOLD}│ Password:${NC}   ${ADMIN_PASSWORD}"
echo -e "${BOLD}└──────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${RED}${BOLD}⚠  SAVE THESE CREDENTIALS — this is the only time the password is shown!${NC}"
echo ""
echo -e "${BOLD}Install Dir:${NC}   ${INSTALL_DIR}"
echo ""
echo -e "${BOLD}Security:${NC}"
echo -e "  Login rate limiting:    ${GREEN}Enabled${NC} (5 attempts / 15 min)"
echo -e "  Account lockout:        ${GREEN}Enabled${NC} (locks after 10 failures)"
echo -e "  CSRF protection:        ${GREEN}Enabled${NC}"
echo -e "  Helmet security headers:${GREEN} Enabled${NC}"
echo -e "  MongoDB injection guard: ${GREEN}Enabled${NC}"
if [ -n "$TURNSTILE_SITE_KEY" ]; then
  echo -e "  Cloudflare Turnstile:   ${GREEN}Enabled${NC}"
else
  echo -e "  Cloudflare Turnstile:   ${YELLOW}Disabled${NC} (add keys to .env to enable)"
fi
echo ""
echo -e "${BOLD}Docker Commands:${NC}"
echo -e "  cd ${INSTALL_DIR}"
echo -e "  docker compose ps          # Status"
echo -e "  docker compose logs -f     # Live logs"
echo -e "  docker compose restart     # Restart"
echo -e "  docker compose down        # Stop"
echo -e "  docker compose up -d       # Start"
echo -e "  docker compose up -d --build  # Rebuild & start"
echo ""
echo -e "${BOLD}MongoDB:${NC}"
echo -e "  Backup:  docker compose exec mongo mongodump --out /dump"
echo -e "  Shell:   docker compose exec mongo mongosh pushhive"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Login at https://${DOMAIN}/dashboard"
echo -e "  2. Add your first site"
echo -e "  3. Copy the embed code to your website"
echo -e "  4. Start collecting subscribers!"
echo ""
echo -e "${YELLOW}IMPORTANT: Back up ${INSTALL_DIR}/.env — it contains your VAPID keys.${NC}"
echo -e "${YELLOW}If you lose them, existing subscribers can't receive notifications.${NC}"
echo ""
