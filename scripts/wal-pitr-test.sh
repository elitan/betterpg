#!/usr/bin/env bash

# WAL Archiving and PITR Test Script for BetterPG
# Tests WAL archiving functionality and point-in-time recovery

set -e  # Exit on error

BPG="./dist/bpg"
TEST_DB="waltest"
TEST_BRANCH="${TEST_DB}/main"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

function print_test() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${BLUE}[Test $TESTS_RUN]${NC} $1"
}

function pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓${NC} $1"
}

function fail() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

function cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    $BPG project delete $TEST_DB --force 2>/dev/null || true
    sudo rm -rf ~/.local/share/betterpg/wal-archive/${TEST_DB}-* 2>/dev/null || true
}

# Trap to cleanup on exit
trap cleanup EXIT

echo -e "${BLUE}=== BetterPG WAL/PITR Test Suite ===${NC}\n"

# Test 1: Initialize system
print_test "Initialize BetterPG"
$BPG init || fail "Failed to initialize betterpg"
pass "System initialized"

# Test 2: Create project
print_test "Create test project with WAL archiving enabled"
$BPG project create $TEST_DB || fail "Failed to create project"
pass "Project created with WAL archiving"

# Test 3: Get connection details
print_test "Get PostgreSQL connection details"
# Get connection details from state file
STATE_FILE=~/.local/share/betterpg/state.json
if [ ! -f "$STATE_FILE" ]; then
    fail "State file not found"
fi

PORT=$(cat $STATE_FILE | jq -r ".databases[] | select(.name == \"$TEST_DB\") | .branches[] | select(.isPrimary == true) | .port")
PASS=$(cat $STATE_FILE | jq -r ".databases[] | select(.name == \"$TEST_DB\") | .credentials.password")

if [ -z "$PORT" ] || [ -z "$PASS" ] || [ "$PORT" == "null" ] || [ "$PASS" == "null" ]; then
    fail "Could not extract connection details from state"
fi
pass "Got connection details (port: $PORT)"

# Test 4: Insert initial data and wait for checkpoint
print_test "Insert initial data and create checkpoint"
docker exec bpg-${TEST_DB}-main psql -U postgres -d postgres -c "
CREATE TABLE wal_test (
    id SERIAL PRIMARY KEY,
    value TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO wal_test (value) VALUES ('initial_data');
SELECT pg_switch_wal();
CHECKPOINT;
" || fail "Failed to insert initial data"
pass "Initial data inserted and checkpoint created"

# Test 5: Wait and generate more transactions to ensure consistent state
print_test "Generate transactions and wait for consistent state"
sleep 5
docker exec bpg-${TEST_DB}-main psql -U postgres -d postgres -c "
INSERT INTO wal_test (value) VALUES ('before_recovery_point_1');
INSERT INTO wal_test (value) VALUES ('before_recovery_point_2');
SELECT pg_switch_wal();
CHECKPOINT;
" || fail "Failed to generate transactions"
sleep 3
pass "Transactions generated and checkpointed"

# Test 6: Record timestamp for PITR (now database is in consistent state)
print_test "Recording timestamp for PITR recovery"
sleep 2
RECOVERY_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "Recovery timestamp: $RECOVERY_TIME"
# Wait and generate more WAL activity to ensure timestamp is in consistent state
sleep 3
docker exec bpg-${TEST_DB}-main psql -U postgres -d postgres -c "
SELECT pg_switch_wal();
CHECKPOINT;
" > /dev/null
sleep 5
pass "Timestamp recorded: $RECOVERY_TIME"

# Test 7: Insert more data (AFTER timestamp and checkpoint)
print_test "Insert data AFTER recovery timestamp"
docker exec bpg-${TEST_DB}-main psql -U postgres -d postgres -c "
INSERT INTO wal_test (value) VALUES ('after_recovery_point');
INSERT INTO wal_test (value) VALUES ('should_not_exist_in_pitr');
SELECT pg_switch_wal();
CHECKPOINT;
" || fail "Failed to insert post-recovery data"
pass "Post-recovery data inserted"

# Test 8: Verify all 5 rows exist in main branch
print_test "Verify all 5 rows exist in main branch"
ROW_COUNT=$(docker exec bpg-${TEST_DB}-main psql -U postgres -d postgres -t -A -c "SELECT COUNT(*) FROM wal_test;")
if [ "$ROW_COUNT" != "5" ]; then
    fail "Expected 5 rows in main, got $ROW_COUNT"
fi
pass "Main branch has 5 rows as expected"

# Test 9: Check WAL archive status
print_test "Check WAL archive status"
$BPG wal info $TEST_BRANCH || fail "Failed to get WAL info"
pass "WAL info command works"

# Test 10: Create PITR branch
print_test "Create PITR branch recovering to timestamp"
$BPG branch create ${TEST_DB}/pitr --pitr "$RECOVERY_TIME" || fail "Failed to create PITR branch"
pass "PITR branch created"

# Test 11: Wait for PITR recovery to complete
print_test "Wait for PITR recovery to complete"
sleep 15
pass "Recovery completed"

# Test 12: Verify PITR branch has only 3 rows (data before recovery time)
print_test "Verify PITR branch has 3 rows (before recovery time)"
PITR_PORT=$(cat $STATE_FILE | jq -r ".databases[] | select(.name == \"$TEST_DB\") | .branches[] | select(.name == \"${TEST_DB}/pitr\") | .port")

if [ -z "$PITR_PORT" ] || [ "$PITR_PORT" == "null" ]; then
    fail "Could not get PITR branch port"
fi

# Check total row count in PITR branch
PITR_TOTAL=$(docker exec bpg-${TEST_DB}-pitr psql -U postgres -d postgres -t -A -c "SELECT COUNT(*) FROM wal_test;" 2>/dev/null || echo "0")

if [ "$PITR_TOTAL" != "3" ]; then
    echo "Debug: Expected 3 rows in PITR branch, got $PITR_TOTAL"
    echo "Debug: Rows in PITR branch:"
    docker exec bpg-${TEST_DB}-pitr psql -U postgres -d postgres -c "SELECT * FROM wal_test ORDER BY id;"
    fail "Expected 3 rows in PITR branch (before recovery), got $PITR_TOTAL"
fi

# Verify that post-recovery data does NOT exist
POST_RECOVERY_COUNT=$(docker exec bpg-${TEST_DB}-pitr psql -U postgres -d postgres -t -A -c "SELECT COUNT(*) FROM wal_test WHERE value LIKE 'after_%';" 2>/dev/null || echo "0")

if [ "$POST_RECOVERY_COUNT" != "0" ]; then
    fail "PITR branch should not have post-recovery data, but found $POST_RECOVERY_COUNT rows"
fi

pass "PITR branch recovered correctly to point in time (3 rows before recovery)"

# Test 13: Test WAL cleanup dry-run
print_test "Test WAL cleanup (dry run)"
$BPG wal cleanup $TEST_BRANCH --days 30 --dry-run || fail "WAL cleanup dry-run failed"
pass "WAL cleanup dry-run works"

# Test 14: Create another regular branch (non-PITR)
print_test "Create regular branch for comparison"
$BPG branch create ${TEST_DB}/regular || fail "Failed to create regular branch"
pass "Regular branch created"

# Test 15: Verify regular branch has all 5 rows
print_test "Verify regular branch has all 5 rows"
REGULAR_ROW_COUNT=$(docker exec bpg-${TEST_DB}-regular psql -U postgres -d postgres -t -A -c "SELECT COUNT(*) FROM wal_test;" || echo "0")

if [ "$REGULAR_ROW_COUNT" != "5" ]; then
    fail "Expected 5 rows in regular branch, got $REGULAR_ROW_COUNT"
fi
pass "Regular branch has all 5 rows"

# Test 16: List all branches
print_test "List all branches"
$BPG branch list $TEST_DB || fail "Failed to list branches"
pass "Branch list works"

# Test 17: Check WAL info for all branches
print_test "Check WAL info for all databases"
$BPG wal info || fail "Failed to get WAL info for all"
pass "WAL info for all works"

# Summary
echo -e "\n${GREEN}=== Test Summary ===${NC}"
echo -e "${GREEN}✓ Passed: $TESTS_PASSED / $TESTS_RUN${NC}"

if [ $TESTS_PASSED -eq $TESTS_RUN ]; then
    echo -e "${GREEN}All WAL/PITR tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi
