#!/bin/bash
# Test runner for pgd
# Tests require sudo for ZFS and Docker operations

set -e

# Clean up any existing test artifacts first
echo "Cleaning up existing test artifacts..."
sudo "$(dirname "$0")/cleanup.sh"

# Build the binary
echo "Building pgd..."
bun run build

# Run tests with sudo sequentially
# Timeout is configured in bunfig.toml (120s per test)
# Tests are run sequentially to avoid resource contention on:
# - State file locking (state.json)
# - ZFS dataset operations
# - Docker container startup (memory pressure on small machines)
echo "Running tests with sudo..."
BUN_PATH="$(which bun)"
cd "$(dirname "$0")/.." && sudo "$BUN_PATH" test "$@"
