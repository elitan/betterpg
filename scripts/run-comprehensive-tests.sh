#!/bin/bash
# Wrapper script to build and run comprehensive tests
# This avoids sudo path issues with bun

set -e

echo "🔨 Building pgd..."
~/.bun/bin/bun run build

echo "🧪 Running comprehensive integration tests..."
sudo bash scripts/comprehensive-integration-test.sh
