#!/bin/bash
# Test runner for pgd
# Tests require sudo for ZFS and Docker operations

set -e

# Build the binary first
echo "Building pgd..."
bun run build

# Run tests with sudo, explicitly specifying timeout
# Using 120s timeout for slower machines with limited resources
echo "Running tests with sudo..."
BUN_PATH="$(which bun)"
cd "$(dirname "$0")/.." && sudo "$BUN_PATH" test --timeout 120000 "$@"
