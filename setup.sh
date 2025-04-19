#!/bin/bash

# Update packages
echo "Updating packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Node.js and npm
echo "Installing Node.js and npm..."
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify node and npm installations
echo "Verifying Node.js and npm..."
node -v
npm -v

# Install necessary dependencies for Puppeteer
echo "Installing dependencies for Puppeteer..."
sudo apt install -y \
  libatk1.0-0t64 \
  libatk-bridge2.0-0t64 \
  libcups2t64 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libnss3 \
  libxss1 \
  libasound2t64 \
  libx11-xcb1 \
  libxcb1 \
  libx11-6 \
  libglib2.0-0t64 \
  libgtk-3-0t64 \
  xdg-utils


# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Clone your GitHub repository
echo "📦 Cloning your GitHub repository..."
git clone https://github.com/varshney-ansh/slew-crawler.git /home/ubuntu/slew-crawler

# Navigate to the cloned repo
cd /home/ubuntu/slew-crawler

echo "📥 Downloading Chromium..."
wget https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/1181205/chrome-linux.zip
unzip chrome-linux.zip
sudo mv chrome-linux /opt/chromium
sudo ln -s /opt/chromium/chrome /usr/bin/chromium

echo "🧪 Verifying Chromium install..."
chromium --version


# Install dependencies from package.json
echo "Installing project dependencies..."
npm i

# PM2 setup to auto-start after reboot
echo "Setting up PM2 to auto-start your app..."
pm2 startup systemd
pm2 start index.js --name slew-crawler
pm2 save

echo "🚀 Your setup is complete! Your app is running with PM2."
pm2 list
