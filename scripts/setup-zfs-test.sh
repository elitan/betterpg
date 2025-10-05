#!/bin/bash
set -e

echo "Installing ZFS and dependencies..."
apt-get update
apt-get install -y zfsutils-linux curl docker.io

echo "Creating ZFS pool from file..."
# Create a 2GB file for ZFS pool
dd if=/dev/zero of=/tmp/zfs-pool.img bs=1M count=2048
zpool create -f tank /tmp/zfs-pool.img

echo "Setting up ZFS dataset base..."
zfs create tank/betterpg
zfs create tank/betterpg/databases

echo "Installing Bun..."
curl -fsSL https://bun.sh/install | bash
export PATH="/root/.bun/bin:$PATH"

echo "ZFS test environment ready!"
zpool status
zfs list
