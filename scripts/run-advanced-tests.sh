#!/bin/bash
# Wrapper script to build and run advanced tests

set -e

echo "🔨 Building betterpg..."
~/.bun/bin/bun run build

echo "🧪 Running advanced integration tests..."
sudo bash scripts/test-advanced.sh
