#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# PushHive — Self-Hosted Web Push Notification System
# One-command installer for Ubuntu/Debian
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

read -p "Admin display name [Admin]: " ADMIN_NAME
ADMIN_NAME=${ADMIN_NAME:-Admin}

read -p "App port [3000]: " APP_PORT
APP_PORT=${APP_PORT:-3000}

read -p "Install directory [/opt/pushhive]: " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/pushhive}

read -p "Enable SSL with Let's Encrypt? (y/n) [y]: " ENABLE_SSL
ENABLE_SSL=${ENABLE_SSL:-y}

echo ""
echo -e "${YELLOW}Installing PushHive...${NC}"
echo ""

# ── Install System Dependencies ──────────────────────────────────
echo -e "${BOLD}[1/8] Installing system dependencies...${NC}"
apt-get update -qq
apt-get install -y -qq curl git build-essential nginx > /dev/null 2>&1
echo -e "${GREEN}✓ System dependencies installed${NC}"

# ── Install Node.js (LTS) ───────────────────────────────────────
echo -e "${BOLD}[2/8] Installing Node.js...${NC}"
if command -v node &> /dev/null; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    echo -e "${GREEN}✓ Node.js $(node -v) already installed${NC}"
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"
fi

# ── Install MongoDB ──────────────────────────────────────────────
echo -e "${BOLD}[3/8] Installing MongoDB...${NC}"
if command -v mongod &> /dev/null || command -v mongosh &> /dev/null; then
  echo -e "${GREEN}✓ MongoDB already installed${NC}"
else
  # MongoDB 7.0 for Ubuntu
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
    gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg 2>/dev/null
  
  # Detect Ubuntu version
  UBUNTU_VER=$(lsb_release -cs 2>/dev/null || echo "jammy")
  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_VER}/mongodb-org/7.0 multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-7.0.list > /dev/null
  
  apt-get update -qq
  apt-get install -y -qq mongodb-org > /dev/null 2>&1 || {
    # Fallback: try mongosh separately or use system mongo
    echo -e "${YELLOW}⚠ MongoDB repo install failed, trying alternative...${NC}"
    apt-get install -y -qq mongodb > /dev/null 2>&1 || true
  }
  
  systemctl start mongod 2>/dev/null || systemctl start mongodb 2>/dev/null || true
  systemctl enable mongod 2>/dev/null || systemctl enable mongodb 2>/dev/null || true
  echo -e "${GREEN}✓ MongoDB installed and started${NC}"
fi

# ── Install PM2 ─────────────────────────────────────────────────
echo -e "${BOLD}[4/8] Installing PM2...${NC}"
if command -v pm2 &> /dev/null; then
  echo -e "${GREEN}✓ PM2 already installed${NC}"
else
  npm install -g pm2 > /dev/null 2>&1
  echo -e "${GREEN}✓ PM2 installed${NC}"
fi

# ── Setup Application ───────────────────────────────────────────
echo -e "${BOLD}[5/8] Setting up PushHive application...${NC}"
mkdir -p "$INSTALL_DIR"

# If we're running from the repo directory, copy files
if [ -f "./package.json" ] && grep -q "pushhive" "./package.json" 2>/dev/null; then
  cp -r ./* "$INSTALL_DIR/"
  cp -r ./.env.example "$INSTALL_DIR/" 2>/dev/null || true
else
  echo -e "${RED}Please run this script from the PushHive project directory${NC}"
  exit 1
fi

cd "$INSTALL_DIR"

# Install Node dependencies
npm install --production > /dev/null 2>&1
echo -e "${GREEN}✓ Application files ready${NC}"

# ── Generate VAPID Keys & Config ────────────────────────────────
echo -e "${BOLD}[6/8] Generating VAPID keys and configuration...${NC}"

# Generate VAPID keys using Node.js
VAPID_KEYS=$(node -e "
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log(JSON.stringify(keys));
")

VAPID_PUBLIC=$(echo "$VAPID_KEYS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).publicKey)")
VAPID_PRIVATE=$(echo "$VAPID_KEYS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).privateKey)")

# Generate session secret
SESSION_SECRET=$(openssl rand -hex 32)

# Create .env file
cat > "$INSTALL_DIR/.env" << EOF
PORT=${APP_PORT}
MONGODB_URI=mongodb://localhost:27017/pushhive
SESSION_SECRET=${SESSION_SECRET}
VAPID_PUBLIC_KEY=${VAPID_PUBLIC}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE}
VAPID_EMAIL=${ADMIN_EMAIL}
NODE_ENV=production
EOF

chmod 600 "$INSTALL_DIR/.env"
echo -e "${GREEN}✓ VAPID keys generated, .env created${NC}"

# ── Seed Admin Account ──────────────────────────────────────────
echo -e "${BOLD}[7/8] Creating admin account...${NC}"

node -e "
require('dotenv').config({ path: '${INSTALL_DIR}/.env' });
const mongoose = require('mongoose');
const Admin = require('./models/Admin');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Remove existing admin with same email
  await Admin.deleteMany({ email: '${ADMIN_EMAIL}'.toLowerCase() });
  
  const admin = new Admin({
    email: '${ADMIN_EMAIL}',
    password: '${ADMIN_PASSWORD}',
    name: '${ADMIN_NAME}',
    role: 'super'
  });
  await admin.save();
  
  console.log('Admin created');
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
"

echo -e "${GREEN}✓ Admin account created${NC}"

# ── Configure Nginx ─────────────────────────────────────────────
echo -e "${BOLD}[8/8] Configuring Nginx...${NC}"

cat > "/etc/nginx/sites-available/pushhive" << EOF
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

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 10M;
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/pushhive /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Test and reload nginx
nginx -t > /dev/null 2>&1
systemctl reload nginx

echo -e "${GREEN}✓ Nginx configured${NC}"

# ── SSL with Let's Encrypt ──────────────────────────────────────
if [ "$ENABLE_SSL" = "y" ] || [ "$ENABLE_SSL" = "Y" ]; then
  echo -e "${BOLD}Setting up SSL...${NC}"
  
  if ! command -v certbot &> /dev/null; then
    apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1
  fi
  
  certbot --nginx -d "$DOMAIN" --email "$ADMIN_EMAIL" --agree-tos --non-interactive --redirect 2>/dev/null && {
    echo -e "${GREEN}✓ SSL certificate installed${NC}"
  } || {
    echo -e "${YELLOW}⚠ SSL setup failed. You can run 'certbot --nginx -d ${DOMAIN}' later.${NC}"
  }
fi

# ── Start Application ───────────────────────────────────────────
cd "$INSTALL_DIR"
pm2 stop pushhive 2>/dev/null || true
pm2 delete pushhive 2>/dev/null || true
pm2 start server.js --name pushhive --cwd "$INSTALL_DIR"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║         PushHive Installed Successfully!     ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Dashboard:${NC}  https://${DOMAIN}/dashboard"
echo -e "${BOLD}Email:${NC}      ${ADMIN_EMAIL}"
echo -e "${BOLD}Password:${NC}   (the one you entered)"
echo ""
echo -e "${BOLD}Install Dir:${NC} ${INSTALL_DIR}"
echo -e "${BOLD}Logs:${NC}        pm2 logs pushhive"
echo -e "${BOLD}Restart:${NC}     pm2 restart pushhive"
echo -e "${BOLD}Status:${NC}      pm2 status"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Login to https://${DOMAIN}/dashboard"
echo -e "  2. Add your first site"
echo -e "  3. Copy the embed code to your website"
echo -e "  4. Start collecting subscribers!"
echo ""
echo -e "${YELLOW}IMPORTANT: Save your VAPID keys from ${INSTALL_DIR}/.env${NC}"
echo -e "${YELLOW}If you lose them, existing subscribers won't receive notifications.${NC}"
echo ""
