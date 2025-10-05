#!/bin/bash
# Setup script for Ubuntu 22.04/24.04 VPS for betterpg testing

set -e

echo "🚀 Setting up betterpg test environment on Ubuntu..."

# Update system
echo "📦 Updating system..."
sudo apt-get update
sudo apt-get upgrade -y

# Install ZFS
echo "📦 Installing ZFS..."
sudo apt-get install -y zfsutils-linux

# Install unzip (needed for Bun)
sudo apt-get install -y unzip

# Install Docker
echo "🐳 Installing Docker..."
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Add current user to docker group
sudo usermod -aG docker $USER

# Install Bun
echo "📦 Installing Bun..."
curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH for current session
export PATH="$HOME/.bun/bin:$PATH"

# Install git and jq if not present
sudo apt-get install -y git jq postgresql-client

# Create ZFS pool from file (for testing)
echo "📦 Creating ZFS test pool..."
sudo dd if=/dev/zero of=/tank.img bs=1G count=10
sudo zpool create -f tank /tank.img

echo "✅ ZFS pool created:"
sudo zpool status tank
sudo zfs list

# Create directories
echo "📁 Creating directories..."
sudo mkdir -p /etc/betterpg
sudo mkdir -p /var/lib/betterpg
sudo chown -R $USER:$USER /etc/betterpg
sudo chown -R $USER:$USER /var/lib/betterpg

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Clone the repo: git clone https://github.com/elitan/betterpg.git"
echo "  2. cd betterpg"
echo "  3. bun install"
echo "  4. sudo bun run src/index.ts init"
echo "  5. Run tests: ./scripts/integration-test.sh"
echo ""
echo "Note: You may need to log out and back in for docker group to take effect"
echo "      Or run: newgrp docker"
