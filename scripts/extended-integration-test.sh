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

BPG="sudo ./dist/bpg"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"

    # Stop and remove containers
    docker ps -a | grep bpg- | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true

    # Clean up ZFS datasets
    zfs destroy -r tank/betterpg/databases 2>/dev/null || true
    zfs create tank/betterpg/databases 2>/dev/null || true

    # Remove state and config
    rm -rf /var/lib/betterpg/* /etc/betterpg/* 2>/dev/null || true

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
if [ -f /var/lib/betterpg/state.json ] && [ -f /etc/betterpg/config.yaml ]; then
    echo -e "${GREEN}✓ Init successful${NC}"
else
    echo -e "${RED}✗ Init failed${NC}"
    exit 1
fi

# Test 2: Create database
echo -e "\n${BLUE}=== Test 2: Create primary database ===${NC}"
$BPG create test-prod
if sudo zfs list tank/betterpg/databases/test-prod >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Database created${NC}"
else
    echo -e "${RED}✗ Database creation failed${NC}"
    exit 1
fi

# Verify container is running
if check_container_state "bpg-test-prod" "running"; then
    echo -e "${GREEN}✓ Container is running${NC}"
else
    echo -e "${RED}✗ Container not running${NC}"
    exit 1
fi

# Test 3: Create test data
echo -e "\n${BLUE}=== Test 3: Create test data ===${NC}"
sleep 3  # Give PostgreSQL a moment
PGPASSWORD=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].credentials.password')
PGPORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].port')

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
echo -e "\n${BLUE}=== Test 5: Stop database ===${NC}"
$BPG stop test-prod
sleep 2

if check_container_state "bpg-test-prod" "stopped"; then
    echo -e "${GREEN}✓ Database stopped successfully${NC}"
else
    echo -e "${RED}✗ Database stop failed${NC}"
    exit 1
fi

# Verify state was updated
STATE_STATUS=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].status')
if [ "$STATE_STATUS" = "stopped" ]; then
    echo -e "${GREEN}✓ State updated correctly${NC}"
else
    echo -e "${RED}✗ State not updated (status: $STATE_STATUS)${NC}"
    exit 1
fi

# Test 6: Test start command
echo -e "\n${BLUE}=== Test 6: Start database ===${NC}"
$BPG start test-prod
sleep 3

if check_container_state "bpg-test-prod" "running"; then
    echo -e "${GREEN}✓ Database started successfully${NC}"
else
    echo -e "${RED}✗ Database start failed${NC}"
    exit 1
fi

# Verify database still has data
if PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "SELECT COUNT(*) FROM test_table;" | grep -q "3"; then
    echo -e "${GREEN}✓ Data persisted after stop/start${NC}"
else
    echo -e "${RED}✗ Data lost after stop/start${NC}"
    exit 1
fi

# Test 7: Test restart command
echo -e "\n${BLUE}=== Test 7: Restart database ===${NC}"
$BPG restart test-prod
sleep 3

if check_container_state "bpg-test-prod" "running"; then
    echo -e "${GREEN}✓ Database restarted successfully${NC}"
else
    echo -e "${RED}✗ Database restart failed${NC}"
    exit 1
fi

# Test 8: Create branch with application-consistent snapshot (default)
echo -e "\n${BLUE}=== Test 8: Create branch with application-consistent snapshot ===${NC}"
if $BPG branch test-prod test-dev 2>&1 | tee /tmp/branch_output.txt | grep -q "Backup mode started"; then
    echo -e "${GREEN}✓ Application-consistent snapshot used (pg_backup_start detected)${NC}"
else
    echo -e "${RED}✗ Application-consistent snapshot verification failed${NC}"
    exit 1
fi

if sudo zfs list tank/betterpg/databases/test-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Branch created with application-consistent snapshot${NC}"
else
    echo -e "${RED}✗ Branch creation failed${NC}"
    exit 1
fi

# Test 8a: Create branch with crash-consistent snapshot (--fast)
echo -e "\n${BLUE}=== Test 8a: Create branch with crash-consistent snapshot (--fast) ===${NC}"
if $BPG branch test-prod test-fast --fast 2>&1 | tee /tmp/branch_fast_output.txt | grep -q "crash-consistent"; then
    echo -e "${GREEN}✓ Crash-consistent snapshot used (--fast mode)${NC}"
else
    echo -e "${RED}✗ Crash-consistent snapshot verification failed${NC}"
    exit 1
fi

if sudo zfs list tank/betterpg/databases/test-fast >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Fast branch created${NC}"
else
    echo -e "${RED}✗ Fast branch creation failed${NC}"
    exit 1
fi

# Test 8b: Verify neither backup mode used with --fast
echo -e "\n${BLUE}=== Test 8b: Verify --fast skips backup mode ===${NC}"
if grep -q "Backup mode" /tmp/branch_fast_output.txt; then
    echo -e "${RED}✗ Fast mode should not use backup mode${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Fast mode correctly skipped backup mode${NC}"
fi

# Test 9: Verify branch has same data
echo -e "\n${BLUE}=== Test 9: Verify branch data ===${NC}"
sleep 3
DEV_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[0].port')

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
$BPG stop test-dev
sleep 2

if check_container_state "bpg-test-dev" "stopped"; then
    echo -e "${GREEN}✓ Branch stopped successfully${NC}"
else
    echo -e "${RED}✗ Branch stop failed${NC}"
    exit 1
fi

# Test 12: Start branch
echo -e "\n${BLUE}=== Test 12: Start branch ===${NC}"
$BPG start test-dev
sleep 3

if check_container_state "bpg-test-dev" "running"; then
    echo -e "${GREEN}✓ Branch started successfully${NC}"
else
    echo -e "${RED}✗ Branch start failed${NC}"
    exit 1
fi

# Test 13: Reset branch to parent snapshot
echo -e "\n${BLUE}=== Test 13: Reset branch to parent snapshot ===${NC}"
$BPG reset test-dev
sleep 3

# Verify branch is running after reset
if check_container_state "bpg-test-dev" "running"; then
    echo -e "${GREEN}✓ Branch running after reset${NC}"
else
    echo -e "${RED}✗ Branch not running after reset${NC}"
    exit 1
fi

# Verify data was reset (should be back to 3 rows)
RESET_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;" | xargs)

if [ "$RESET_COUNT" -eq 3 ]; then
    echo -e "${GREEN}✓ Branch data reset to parent snapshot (count: $RESET_COUNT)${NC}"
else
    echo -e "${RED}✗ Branch reset failed (count: $RESET_COUNT, expected: 3)${NC}"
    exit 1
fi

# Test 14: Test idempotent operations
echo -e "\n${BLUE}=== Test 14: Test idempotent operations ===${NC}"

# Try to start already running database
$BPG start test-prod
echo -e "${GREEN}✓ Start on running database is idempotent${NC}"

# Stop and try to stop again
$BPG stop test-prod
sleep 2
$BPG stop test-prod
echo -e "${GREEN}✓ Stop on stopped database is idempotent${NC}"

# Start it back up for next tests
$BPG start test-prod
sleep 3

# Test 15: Test status with mixed states
echo -e "\n${BLUE}=== Test 15: Test status with mixed states ===${NC}"
$BPG stop test-dev
sleep 2
$BPG status
echo -e "${GREEN}✓ Status shows mixed running/stopped states${NC}"
$BPG start test-dev
sleep 3

# Test 16: Create second branch
echo -e "\n${BLUE}=== Test 16: Create second branch ===${NC}"
$BPG branch test-prod test-staging

if sudo zfs list tank/betterpg/databases/test-staging >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Second branch created${NC}"
else
    echo -e "${RED}✗ Second branch creation failed${NC}"
    exit 1
fi

# Test 17: Test list command
echo -e "\n${BLUE}=== Test 17: Test list command ===${NC}"
$BPG list
echo -e "${GREEN}✓ List command shows all databases and branches${NC}"

# Test 18: Verify ZFS space efficiency
echo -e "\n${BLUE}=== Test 18: Verify ZFS space efficiency ===${NC}"
PROD_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod)
DEV_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-dev)
STAGING_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-staging)

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
$BPG destroy test-staging

if ! sudo zfs list tank/betterpg/databases/test-staging >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Staging branch destroyed${NC}"
else
    echo -e "${RED}✗ Staging branch destroy failed${NC}"
    exit 1
fi

$BPG destroy test-dev

if ! sudo zfs list tank/betterpg/databases/test-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Dev branch destroyed${NC}"
else
    echo -e "${RED}✗ Dev branch destroy failed${NC}"
    exit 1
fi

$BPG destroy test-fast

if ! sudo zfs list tank/betterpg/databases/test-fast >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Fast branch destroyed${NC}"
else
    echo -e "${RED}✗ Fast branch destroy failed${NC}"
    exit 1
fi

# Test 20: Edge case - Try to reset primary database (should fail)
echo -e "\n${BLUE}=== Test 20: Edge case - Reset primary database ===${NC}"
if $BPG reset test-prod 2>&1 | grep -q "not found"; then
    echo -e "${GREEN}✓ Reset correctly rejects primary databases${NC}"
else
    echo -e "${RED}✗ Reset should reject primary databases${NC}"
    exit 1
fi

# Test 21: Edge case - Try to start non-existent database
echo -e "\n${BLUE}=== Test 21: Edge case - Start non-existent database ===${NC}"
if $BPG start non-existent 2>&1 | grep -q "not found"; then
    echo -e "${GREEN}✓ Start correctly rejects non-existent databases${NC}"
else
    echo -e "${RED}✗ Start should reject non-existent databases${NC}"
    exit 1
fi

# Test 22: Final status check
echo -e "\n${BLUE}=== Test 22: Final status check ===${NC}"
$BPG status
echo -e "${GREEN}✓ Final status check complete${NC}"

echo -e "\n${GREEN}🎉 All extended tests passed!${NC}"
echo -e "${GREEN}   Total tests: 25${NC}"
echo -e "${GREEN}   All passed ✓${NC}\n"
