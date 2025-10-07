#!/bin/bash
# Test rollback functionality - ensures resources are cleaned up on failure

set -e

BPG="./dist/bpg"
TEST_DB="rollback-test-$(date +%s)"

echo "🧪 Testing rollback on branch creation failure"
echo ""

# Setup: Create database
echo "Setup: Creating test database..."
$BPG db create "$TEST_DB"

# Test 1: Simulate failure during branch creation by using invalid dataset name
echo ""
echo "Test 1: Branch creation with simulated failure..."
echo "  (This should fail and clean up resources)"

# Capture state before
DATASETS_BEFORE=$(sudo zfs list -H -o name | grep betterpg || true)
CONTAINERS_BEFORE=$(docker ps -a --filter "name=bpg-" --format "{{.Names}}" | sort)

# Try to create branch with a name that will cause issues
# We'll force a failure by creating a ZFS dataset with same name first
FAIL_BRANCH="$TEST_DB/fail-test"
FAIL_DATASET="$TEST_DB-fail-test"

echo "  Creating conflicting ZFS dataset to force failure..."
sudo zfs create tank/betterpg/databases/$FAIL_DATASET 2>/dev/null || true

# This should fail and trigger rollback
set +e
$BPG branch create "$FAIL_BRANCH" 2>&1 | grep -q "already exists"
RESULT=$?
set -e

if [ $RESULT -eq 0 ]; then
    echo "  ✓ Branch creation failed as expected"
else
    echo "  ✗ Expected failure but command succeeded"
    exit 1
fi

# Check that no container was left behind
CONTAINERS_AFTER=$(docker ps -a --filter "name=bpg-$TEST_DB-fail-test" --format "{{.Names}}")
if [ -z "$CONTAINERS_AFTER" ]; then
    echo "  ✓ No orphaned containers (rollback succeeded)"
else
    echo "  ✗ Found orphaned container: $CONTAINERS_AFTER"
    echo "    Rollback failed to clean up!"
    exit 1
fi

# Cleanup the manually created dataset
sudo zfs destroy tank/betterpg/databases/$FAIL_DATASET 2>/dev/null || true

# Test 2: Create a successful branch to verify normal operation still works
echo ""
echo "Test 2: Normal branch creation (should succeed)..."
$BPG branch create "$TEST_DB/dev"
echo "  ✓ Branch created successfully"

# Test 3: Verify the successful branch has all resources
echo ""
echo "Test 3: Verify successful branch has all resources..."

# Check ZFS dataset exists
if sudo zfs list tank/betterpg/databases/$TEST_DB-dev >/dev/null 2>&1; then
    echo "  ✓ ZFS dataset exists"
else
    echo "  ✗ ZFS dataset missing"
    exit 1
fi

# Check container exists
if docker ps -a --filter "name=bpg-$TEST_DB-dev" --format "{{.Names}}" | grep -q "bpg-$TEST_DB-dev"; then
    echo "  ✓ Container exists"
else
    echo "  ✗ Container missing"
    exit 1
fi

# Check container is running
if docker ps --filter "name=bpg-$TEST_DB-dev" --format "{{.Names}}" | grep -q "bpg-$TEST_DB-dev"; then
    echo "  ✓ Container is running"
else
    echo "  ✗ Container not running"
    exit 1
fi

# Cleanup
echo ""
echo "Cleanup: Removing test database..."
$BPG db delete "$TEST_DB" --force

echo ""
echo "✅ All rollback tests passed!"
echo "   - Failed operations clean up resources"
echo "   - Successful operations complete normally"
echo "   - No resource leaks detected"
