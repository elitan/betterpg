#!/bin/bash
# Comprehensive cleanup script for velo tests
# Removes all containers, ZFS datasets, and state files

set -e

echo "Starting velo cleanup..."

# Stop and remove all velo containers
echo "Removing velo containers..."
docker ps -a | grep "velo-" | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true

# Get ZFS pool and dataset base
POOL="tank"
DATASET_BASE="velo/databases"

# Check if state file exists to get actual config
STATE_FILE="$HOME/.velo/state.json"
if [ -f "$STATE_FILE" ]; then
  POOL=$(jq -r '.zfsPool // "tank"' "$STATE_FILE")
  DATASET_BASE=$(jq -r '.zfsDatasetBase // "velo/databases"' "$STATE_FILE")
fi

# When running with sudo, check root's state file too
if [ -f "/root/.velo/state.json" ]; then
  POOL=$(jq -r '.zfsPool // "tank"' /root/.velo/state.json)
  DATASET_BASE=$(jq -r '.zfsDatasetBase // "velo/databases"' /root/.velo/state.json)
fi

# Clean up ZFS datasets
echo "Removing ZFS datasets from $POOL/$DATASET_BASE..."
if sudo zfs list -H -o name | grep -q "^$POOL/$DATASET_BASE$"; then
  sudo zfs destroy -r "$POOL/$DATASET_BASE" 2>/dev/null || true
  sudo zfs create "$POOL/$DATASET_BASE" 2>/dev/null || true
else
  echo "Base dataset doesn't exist, creating it..."
  sudo zfs create -p "$POOL/$DATASET_BASE" 2>/dev/null || true
fi

# Remove state and config directories
echo "Removing state and config directories..."
rm -rf "$HOME/.velo" 2>/dev/null || true

# When running with sudo (UID 0), also clean /root directories
if [ "$(id -u)" -eq 0 ]; then
  rm -rf /root/.velo 2>/dev/null || true
fi

echo "Cleanup complete!"
