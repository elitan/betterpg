#!/bin/bash
# Wrapper script to build and run extended tests
# This avoids sudo path issues with bun

set -e

echo "🔨 Building pgd..."
~/.bun/bin/bun run build

echo "🧪 Running extended integration tests..."
sudo bash scripts/extended-integration-test.sh
