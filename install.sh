#!/bin/bash

# TAGOPS Socket Relay Installation Script

echo "======================================"
echo " Starting TAGOPS Socket Relay Setup   "
echo "======================================"

# 1. System Updates
echo "[1/4] Updating system packages..."
sudo apt update -y && sudo apt upgrade -y

# 2. Install Node.js & NPM
echo "[2/4] Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js is already installed. Skipping."
fi

# 3. Install PM2 & Redis
echo "[3/4] Installing PM2 and Redis..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

if ! command -v redis-server &> /dev/null; then
    sudo apt install -y redis-server
    sudo systemctl enable redis-server.service
    sudo systemctl start redis-server.service
else
    echo "Redis is already installed. Skipping."
fi

# 4. Setup Project
echo "[4/4] Installing Node modules..."
npm install

echo "======================================"
echo "Installation Complete!"
echo "Next Steps:"
echo "1. Configure your .env file with a secure AGENT_TOKEN"
echo "2. Start the server using PM2:"
echo "   pm2 start index.js --name tagops-socket-relay"
echo "   pm2 save"
echo "   pm2 startup"
echo "======================================"
