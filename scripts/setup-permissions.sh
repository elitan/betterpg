#!/usr/bin/env bash
set -euo pipefail

# pgd One-Time Permission Setup Script
# This script grants your user the necessary permissions to run pgd without sudo.
#
# What this does:
# 1. Grants ZFS delegation permissions for creating/destroying datasets
# 2. Adds user to docker group (for docker socket access)
# 3. Sets up proper directory permissions
#
# This script MUST be run with sudo, but pgd itself will NOT require sudo afterwards.

SCRIPT_NAME="pgd-setup"
USER="${SUDO_USER:-$USER}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root/sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This setup script must be run with sudo${NC}"
   echo "Usage: sudo ./scripts/setup-permissions.sh"
   exit 1
fi

# Check if user is set
if [[ -z "$USER" ]]; then
    echo -e "${RED}Error: Could not determine user. Please run with: sudo -u USERNAME $0${NC}"
    exit 1
fi

echo "=========================================="
echo "  pgd Permission Setup"
echo "=========================================="
echo ""
echo -e "User: ${GREEN}$USER${NC}"
echo ""

# 1. Check ZFS availability
echo -e "${YELLOW}[1/4]${NC} Checking ZFS installation..."
if ! command -v zpool &> /dev/null; then
    echo -e "${RED}Error: ZFS is not installed${NC}"
    echo "Install ZFS first:"
    echo "  Ubuntu/Debian: sudo apt install zfsutils-linux"
    echo "  Arch: sudo pacman -S zfs-dkms"
    exit 1
fi
echo -e "${GREEN}✓${NC} ZFS is installed"
echo ""

# 2. Auto-detect or prompt for ZFS pool
echo -e "${YELLOW}[2/4]${NC} Detecting ZFS pools..."
POOLS=$(zpool list -H -o name 2>/dev/null || true)

if [[ -z "$POOLS" ]]; then
    echo -e "${RED}Error: No ZFS pools found${NC}"
    echo "Create a ZFS pool first:"
    echo "  sudo zpool create tank /dev/sdX"
    exit 1
fi

POOL_COUNT=$(echo "$POOLS" | wc -l)

if [[ $POOL_COUNT -eq 1 ]]; then
    POOL="$POOLS"
    echo -e "${GREEN}✓${NC} Found pool: ${GREEN}$POOL${NC}"
else
    echo "Multiple pools found:"
    echo "$POOLS" | nl
    echo ""
    read -p "Enter pool name to use for pgd: " POOL

    if ! echo "$POOLS" | grep -q "^$POOL$"; then
        echo -e "${RED}Error: Pool '$POOL' not found${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓${NC} Using pool: ${GREEN}$POOL${NC}"
echo ""

# 3. Grant ZFS delegation permissions
echo -e "${YELLOW}[3/4]${NC} Granting ZFS delegation permissions..."

# Check if delegation is enabled (should be by default)
DELEGATION=$(zpool get -H -o value delegation "$POOL" 2>/dev/null || echo "on")

if [[ "$DELEGATION" != "on" ]]; then
    echo "Enabling ZFS delegation on pool '$POOL'..."
    zpool set delegation=on "$POOL"
fi

# Create base dataset if it doesn't exist
BASE_DATASET="${POOL}/pgd"
if ! zfs list "$BASE_DATASET" &>/dev/null; then
    echo "Creating base dataset: $BASE_DATASET"
    zfs create "$BASE_DATASET"
fi

# Create databases subdirectory if needed
DATABASES_DATASET="${POOL}/pgd/databases"

# Grant comprehensive permissions to user
echo "Granting permissions to user '$USER' on dataset '$DATABASES_DATASET'..."
if ! zfs list "$DATABASES_DATASET" &>/dev/null; then
    echo "Creating databases dataset: $DATABASES_DATASET"
    zfs create "$DATABASES_DATASET"
fi

# ZFS permissions needed for pgd:
# Note: We set permissions in batches due to ZFS limitations on some systems
# - Operations: create, destroy, snapshot, clone, promote
# - Properties: compression, recordsize, mountpoint
# Note: mount/unmount require sudo on Linux (kernel limitation)

echo "Setting dataset operation permissions..."
zfs allow "$USER" create,destroy,snapshot,clone,mount "$DATABASES_DATASET"

echo "Setting additional permissions..."
zfs allow "$USER" promote,send,receive "$DATABASES_DATASET"

echo "Setting property permissions..."
zfs allow "$USER" compression,recordsize,mountpoint "$DATABASES_DATASET"

echo -e "${GREEN}✓${NC} ZFS permissions granted"
echo ""

# 4. Configure Docker and pgd group
echo -e "${YELLOW}[4/5]${NC} Configuring Docker access..."

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Warning: Docker is not installed${NC}"
    echo "Install Docker before using pgd:"
    echo "  https://docs.docker.com/engine/install/"
else
    # Check if docker group exists
    if ! getent group docker &>/dev/null; then
        echo "Creating docker group..."
        groupadd docker
    fi

    # Add user to docker group if not already a member
    if ! groups "$USER" | grep -q docker; then
        echo "Adding user '$USER' to docker group..."
        usermod -aG docker "$USER"
        echo -e "${GREEN}✓${NC} User added to docker group"
        echo -e "${YELLOW}Note: User needs to log out and back in for docker group to take effect${NC}"
    else
        echo -e "${GREEN}✓${NC} User already in docker group"
    fi
fi

echo ""

# 5. Install sudoers configuration for ZFS mount/unmount
echo -e "${YELLOW}[5/5]${NC} Installing targeted sudoers configuration..."

# Create pgd group if it doesn't exist
if ! getent group pgd &>/dev/null; then
    echo "Creating pgd group..."
    groupadd pgd
fi

# Add user to pgd group
if ! groups "$USER" | grep -q pgd; then
    echo "Adding user '$USER' to pgd group..."
    usermod -aG pgd "$USER"
    echo -e "${GREEN}✓${NC} User added to pgd group"
else
    echo -e "${GREEN}✓${NC} User already in pgd group"
fi

# Install sudoers file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDOERS_FILE="$SCRIPT_DIR/pgd-sudoers"

if [[ ! -f "$SUDOERS_FILE" ]]; then
    echo -e "${RED}Error: pgd-sudoers file not found at $SUDOERS_FILE${NC}"
    exit 1
fi

echo "Installing sudoers configuration..."
cp "$SUDOERS_FILE" /etc/sudoers.d/pgd
chmod 0440 /etc/sudoers.d/pgd

# Verify sudoers syntax
if visudo -c -f /etc/sudoers.d/pgd &>/dev/null; then
    echo -e "${GREEN}✓${NC} Sudoers configuration installed and verified"
else
    echo -e "${RED}Error: Sudoers configuration has syntax errors${NC}"
    rm /etc/sudoers.d/pgd
    exit 1
fi

echo ""
echo ""
echo "=========================================="
echo -e "${GREEN}✓ Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Configuration summary:"
echo "  • ZFS pool: $POOL"
echo "  • ZFS delegation: create, destroy, snapshot, clone, promote, etc."
echo "  • Groups: docker, pgd"
echo "  • Sudoers: /etc/sudoers.d/pgd (restricted to ZFS commands only)"
echo ""
echo -e "${YELLOW}IMPORTANT: Log out and log back in now!${NC}"
echo "Group membership (docker, pgd) requires a new login session."
echo ""
echo -e "${YELLOW}After re-logging in:${NC}"
echo "1. Verify groups: groups | grep -E 'docker|pgd'"
echo "2. Verify ZFS: zfs allow $POOL/pgd"
echo "3. Create first project: pgd project create myapp"
echo ""
echo -e "${GREEN}Security Note:${NC}"
echo "pgd uses sudo ONLY for ZFS commands (mount/unmount limitation on Linux)."
echo "This is restricted via /etc/sudoers.d/pgd - much more secure than full sudo."
echo ""

# Save pool info for later reference
SETUP_INFO_FILE="/tmp/pgd-setup-info.txt"
echo "POOL=$POOL" > "$SETUP_INFO_FILE"
echo "USER=$USER" >> "$SETUP_INFO_FILE"
echo "DATE=$(date)" >> "$SETUP_INFO_FILE"
chown "$USER:$USER" "$SETUP_INFO_FILE" 2>/dev/null || true

echo "Setup info saved to: $SETUP_INFO_FILE"
echo ""
