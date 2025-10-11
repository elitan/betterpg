#!/bin/bash
# Test runner for velo
# Tests require sudo for ZFS and Docker operations

set -e

# Clean up any existing test artifacts first
echo "Cleaning up existing test artifacts..."
sudo "$(dirname "$0")/cleanup.sh"

# Build the binary
echo "Building velo..."
bun run build

# Run tests with sudo sequentially
# Timeout is configured in bunfig.toml (60s per test)
# Tests are run sequentially to avoid resource contention on:
# - State file locking (state.json)
# - ZFS dataset operations
# - Docker container startup (memory pressure on small machines)
echo "Running tests with sudo..."
BUN_PATH="$(which bun)"

# Default to --bail (stop after first failure)
# Can override with BAIL_COUNT env var (e.g., BAIL_COUNT=5 for CI)
BAIL_FLAG="${BAIL_COUNT:+--bail=$BAIL_COUNT}"
BAIL_FLAG="${BAIL_FLAG:---bail}"

cd "$(dirname "$0")/.." && sudo NODE_ENV=test "$BUN_PATH" test "$BAIL_FLAG" "$@"
