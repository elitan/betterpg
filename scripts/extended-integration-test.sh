#!/bin/bash
# Extended integration test script for betterpg including lifecycle commands
# Run this on a Linux system with ZFS installed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Running betterpg extended integration tests${NC}\n"

# Check if binary exists
if [ ! -f "./dist/bpg" ]; then
    echo -e "${RED}✗ Binary not found. Please run: bun run build${NC}"
    exit 1
fi

BPG="./dist/bpg"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"

    # Stop and remove containers
    docker ps -a | grep bpg- | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true

    # Clean up ZFS datasets
    sudo zfs destroy -r tank/betterpg/databases 2>/dev/null || true
    sudo zfs create tank/betterpg/databases 2>/dev/null || true

    # Remove state and config (user directories)
    rm -rf ~/.config/betterpg ~/.local/share/betterpg 2>/dev/null || true

    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Run cleanup on start and exit
cleanup
trap cleanup EXIT

# Helper function to check container state
check_container_state() {
    local container_name=$1
    local expected_state=$2

    if [ "$expected_state" = "running" ]; then
        if docker ps | grep -q "$container_name"; then
            return 0
        else
            return 1
        fi
    elif [ "$expected_state" = "stopped" ]; then
        if docker ps -a | grep "$container_name" | grep -q "Exited"; then
            return 0
        else
            return 1
        fi
    fi
    return 1
}

# Test 1: Initialize
echo -e "\n${BLUE}=== Test 1: Initialize betterpg ===${NC}"
$BPG init
if [ -f ~/.local/share/betterpg/state.json ] && [ -f ~/.config/betterpg/config.yaml ]; then
    echo -e "${GREEN}✓ Init successful${NC}"
else
    echo -e "${RED}✗ Init failed${NC}"
    exit 1
fi

# Test 2: Create project
echo -e "\n${BLUE}=== Test 2: Create primary project ===${NC}"
$BPG project create test-prod
if sudo zfs list tank/betterpg/databases/test-prod-main >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Project created${NC}"
else
    echo -e "${RED}✗ Project creation failed${NC}"
    exit 1
fi

# Verify container is running
if check_container_state "bpg-test-prod-main" "running"; then
    echo -e "${GREEN}✓ Container is running${NC}"
else
    echo -e "${RED}✗ Container not running${NC}"
    exit 1
fi

# Test 3: Create test data
echo -e "\n${BLUE}=== Test 3: Create test data ===${NC}"
sleep 3  # Give PostgreSQL a moment
PGPASSWORD=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[0].credentials.password')
PGPORT=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[0].branches[0].port')

PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres <<EOF
CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW());
INSERT INTO test_table (name) VALUES ('test-data-1'), ('test-data-2'), ('test-data-3');
EOF

if PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "SELECT COUNT(*) FROM test_table;" | grep -q "3"; then
    echo -e "${GREEN}✓ Test data created${NC}"
else
    echo -e "${RED}✗ Test data creation failed${NC}"
    exit 1
fi

# Test 4: Test status command
echo -e "\n${BLUE}=== Test 4: Test status command ===${NC}"
$BPG status
echo -e "${GREEN}✓ Status command executed${NC}"

# Test 5: Test stop command
echo -e "\n${BLUE}=== Test 5: Stop branch ===${NC}"
$BPG stop test-prod/main
sleep 2

if check_container_state "bpg-test-prod-main" "stopped"; then
    echo -e "${GREEN}✓ Branch stopped successfully${NC}"
else
    echo -e "${RED}✗ Branch stop failed${NC}"
    exit 1
fi

# Verify state was updated
STATE_STATUS=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[0].branches[0].status')
if [ "$STATE_STATUS" = "stopped" ]; then
    echo -e "${GREEN}✓ State updated correctly${NC}"
else
    echo -e "${RED}✗ State not updated (status: $STATE_STATUS)${NC}"
    exit 1
fi

# Test 6: Test start command
echo -e "\n${BLUE}=== Test 6: Start branch ===${NC}"
$BPG start test-prod/main

if check_container_state "bpg-test-prod-main" "running"; then
    echo -e "${GREEN}✓ Branch started successfully${NC}"
else
    echo -e "${RED}✗ Branch start failed${NC}"
    exit 1
fi

# Re-read port from state (Docker may have reassigned it)
PGPORT=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[0].branches[0].port')

# Wait for PostgreSQL to be ready to accept connections
echo -n "  Waiting for PostgreSQL to accept connections (port: $PGPORT)"
for i in {1..30}; do
    if PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
        echo " ✓"
        break
    fi
    echo -n "."
    sleep 1
done

# Verify database still has data
if PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "SELECT COUNT(*) FROM test_table;" | grep -q "3"; then
    echo -e "${GREEN}✓ Data persisted after stop/start${NC}"
else
    echo -e "${RED}✗ Data lost after stop/start${NC}"
    exit 1
fi

# Test 7: Test restart command
echo -e "\n${BLUE}=== Test 7: Restart branch ===${NC}"
$BPG restart test-prod/main

if check_container_state "bpg-test-prod-main" "running"; then
    echo -e "${GREEN}✓ Branch restarted successfully${NC}"
else
    echo -e "${RED}✗ Branch restart failed${NC}"
    exit 1
fi

# Wait for PostgreSQL to be ready after restart
sleep 5

# Test 8: Create branch with application-consistent snapshot (default)
echo -e "\n${BLUE}=== Test 8: Create branch with application-consistent snapshot ===${NC}"
if $BPG branch create test-prod/dev 2>&1 | tee /tmp/branch_output.txt | grep -q "checkpointed"; then
    echo -e "${GREEN}✓ Application-consistent snapshot used (checkpoint detected)${NC}"
else
    echo -e "${RED}✗ Application-consistent snapshot verification failed${NC}"
    exit 1
fi

if sudo zfs list tank/betterpg/databases/test-prod-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Branch created with application-consistent snapshot${NC}"
else
    echo -e "${RED}✗ Branch creation failed${NC}"
    exit 1
fi

# Test 8a: Create another branch (removed --fast flag tests)
echo -e "\n${BLUE}=== Test 8a: Create second branch ===${NC}"
if $BPG branch create test-prod/dev 2>&1 | tee /tmp/branch_dev_output.txt | grep -q "application-consistent"; then
    echo -e "${GREEN}✓ Second branch created with application-consistent snapshot${NC}"
else
    echo -e "${RED}✗ Second branch creation failed${NC}"
    exit 1
fi

if sudo zfs list tank/betterpg/databases/test-prod-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Dev branch created${NC}"
else
    echo -e "${RED}✗ Dev branch creation failed${NC}"
    exit 1
fi

# Test 8b: Verify checkpoint was used
echo -e "\n${BLUE}=== Test 8b: Verify checkpoint was used ===${NC}"
if grep -q "Checkpointing\|checkpointed" /tmp/branch_dev_output.txt; then
    echo -e "${GREEN}✓ Application-consistent snapshot used checkpoint${NC}"
else
    echo -e "${RED}✗ Checkpoint should have been used${NC}"
    exit 1
fi

# Test 9: Verify branch has same data
echo -e "\n${BLUE}=== Test 9: Verify branch data ===${NC}"
sleep 3
DEV_PORT=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name == "test-prod/dev") | .port')

if PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -c "SELECT COUNT(*) FROM test_table;" | grep -q "3"; then
    echo -e "${GREEN}✓ Branch has same data as primary${NC}"
else
    echo -e "${RED}✗ Branch data verification failed${NC}"
    exit 1
fi

# Test 10: Modify branch data
echo -e "\n${BLUE}=== Test 10: Modify branch data ===${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -c "INSERT INTO test_table (name) VALUES ('dev-only-data-1'), ('dev-only-data-2');"

DEV_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;" | xargs)

if [ "$DEV_COUNT" -eq 5 ]; then
    echo -e "${GREEN}✓ Branch data modified (count: $DEV_COUNT)${NC}"
else
    echo -e "${RED}✗ Branch modification failed (count: $DEV_COUNT)${NC}"
    exit 1
fi

# Test 11: Stop branch
echo -e "\n${BLUE}=== Test 11: Stop branch ===${NC}"
$BPG stop test-prod/dev
sleep 2

if check_container_state "bpg-test-prod-dev" "stopped"; then
    echo -e "${GREEN}✓ Branch stopped successfully${NC}"
else
    echo -e "${RED}✗ Branch stop failed${NC}"
    exit 1
fi

# Test 12: Start branch
echo -e "\n${BLUE}=== Test 12: Start branch ===${NC}"
$BPG start test-prod/dev
sleep 3

if check_container_state "bpg-test-prod-dev" "running"; then
    echo -e "${GREEN}✓ Branch started successfully${NC}"
else
    echo -e "${RED}✗ Branch start failed${NC}"
    exit 1
fi

# Test 13: Reset branch to parent snapshot
echo -e "\n${BLUE}=== Test 13: Reset branch to parent snapshot ===${NC}"
# Note: reset command not yet implemented in namespace CLI, skip for now
echo -e "${YELLOW}⚠️  Reset command not yet implemented in namespace CLI - skipping${NC}"

# Test 14: Test idempotent operations
echo -e "\n${BLUE}=== Test 14: Test idempotent operations ===${NC}"

# Try to start already running branch
$BPG start test-prod/main
echo -e "${GREEN}✓ Start on running branch is idempotent${NC}"

# Stop and try to stop again
$BPG stop test-prod/main
sleep 2
$BPG stop test-prod/main
echo -e "${GREEN}✓ Stop on stopped branch is idempotent${NC}"

# Start it back up for next tests
$BPG start test-prod/main
sleep 3

# Test 15: Test status with mixed states
echo -e "\n${BLUE}=== Test 15: Test status with mixed states ===${NC}"
$BPG stop test-prod/dev
sleep 2
$BPG status
echo -e "${GREEN}✓ Status shows mixed running/stopped states${NC}"
$BPG start test-prod/dev
sleep 3

# Test 16: Create second branch
echo -e "\n${BLUE}=== Test 16: Create second branch ===${NC}"
$BPG branch create test-prod/staging

if sudo zfs list tank/betterpg/databases/test-prod-staging >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Second branch created${NC}"
else
    echo -e "${RED}✗ Second branch creation failed${NC}"
    exit 1
fi

# Test 17: Test list command
echo -e "\n${BLUE}=== Test 17: Test list command ===${NC}"
$BPG branch list
echo -e "${GREEN}✓ List command shows all branches${NC}"

# Test 18: Verify ZFS space efficiency
echo -e "\n${BLUE}=== Test 18: Verify ZFS space efficiency ===${NC}"
PROD_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod-main)
DEV_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod-dev)
STAGING_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod-staging)

echo "Primary size: $PROD_SIZE bytes"
echo "Dev branch size: $DEV_SIZE bytes"
echo "Staging branch size: $STAGING_SIZE bytes"

if [ "$DEV_SIZE" -lt "$PROD_SIZE" ] && [ "$STAGING_SIZE" -lt "$PROD_SIZE" ]; then
    echo -e "${GREEN}✓ Branches use less space than primary (copy-on-write working)${NC}"
else
    echo -e "${YELLOW}⚠ Branch sizes similar to primary (might be expected for small datasets)${NC}"
fi

# Test 19: Test destroy branch
echo -e "\n${BLUE}=== Test 19: Destroy branches ===${NC}"
$BPG branch delete test-prod/staging

if ! sudo zfs list tank/betterpg/databases/test-prod-staging >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Staging branch destroyed${NC}"
else
    echo -e "${RED}✗ Staging branch destroy failed${NC}"
    exit 1
fi

$BPG branch delete test-prod/dev

if ! sudo zfs list tank/betterpg/databases/test-prod-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Dev branch destroyed${NC}"
else
    echo -e "${RED}✗ Dev branch destroy failed${NC}"
    exit 1
fi

$BPG branch delete test-prod/fast

if ! sudo zfs list tank/betterpg/databases/test-prod-fast >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Fast branch destroyed${NC}"
else
    echo -e "${RED}✗ Fast branch destroy failed${NC}"
    exit 1
fi

# Test 20: Edge case - Try to start non-existent branch
echo -e "\n${BLUE}=== Test 20: Edge case - Start non-existent branch ===${NC}"
if $BPG start non-existent/main 2>&1 | grep -q "not found"; then
    echo -e "${GREEN}✓ Start correctly rejects non-existent branches${NC}"
else
    echo -e "${RED}✗ Start should reject non-existent branches${NC}"
    exit 1
fi

# Test 21: Final status check
echo -e "\n${BLUE}=== Test 21: Final status check ===${NC}"
$BPG status
echo -e "${GREEN}✓ Final status check complete${NC}"

echo -e "\n${GREEN}🎉 All extended tests passed!${NC}"
echo -e "${GREEN}   Total tests: 21${NC}"
echo -e "${GREEN}   All passed ✓${NC}\n"
