#!/bin/bash
# Wrapper script to build and run v1 tests

set -e

echo "🔨 Building betterpg..."
~/.bun/bin/bun run build

echo "🧪 Running v1 integration tests..."
sudo bash scripts/test-v1.sh
