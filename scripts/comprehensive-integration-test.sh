#!/bin/bash
# Comprehensive integration test script for betterpg
# Tests all commands and edge cases
# Run this on a Linux system with ZFS installed

# NOTE: We don't use 'set -e' because we want to count failures, not exit on first failure

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${YELLOW}🧪 Running betterpg comprehensive integration tests${NC}\n"

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

# Helper function to check test result
check_test() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ $1${NC}"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# SECTION 1: Basic Setup & Database Commands
# ============================================================================

echo -e "\n${BLUE}=== Section 1: Basic Setup & Database Commands ===${NC}"

# Test 1: Initialize
echo -e "\n${BLUE}Test 1: Initialize betterpg${NC}"
$BPG init >/dev/null 2>&1
check_test "Initialize betterpg"

# Test 2: Create first database
echo -e "\n${BLUE}Test 2: Create first database${NC}"
$BPG db create test-prod >/dev/null 2>&1 && sleep 3
check_test "Create database 'test-prod'"

# Test 3: Create second database
echo -e "\n${BLUE}Test 3: Create second database${NC}"
$BPG db create test-staging >/dev/null 2>&1 && sleep 3
check_test "Create database 'test-staging'"

# Test 4: List databases
echo -e "\n${BLUE}Test 4: List databases${NC}"
OUTPUT=$($BPG db list 2>&1)
if echo "$OUTPUT" | grep -q "test-prod" && echo "$OUTPUT" | grep -q "test-staging"; then
    check_test "List databases shows both databases"
else
    false
    check_test "List databases shows both databases"
fi

# Test 5: Get database details
echo -e "\n${BLUE}Test 5: Get database details${NC}"
OUTPUT=$($BPG db get test-prod 2>&1)
if echo "$OUTPUT" | grep -q "test-prod"; then
    check_test "Get database details"
else
    false
    check_test "Get database details"
fi

# Test 6: Database rename
echo -e "\n${BLUE}Test 6: Rename database${NC}"
$BPG db rename test-staging test-dev >/dev/null 2>&1
if sudo zfs list tank/betterpg/databases/test-dev-main >/dev/null 2>&1; then
    check_test "Rename database (ZFS dataset renamed)"
else
    false
    check_test "Rename database (ZFS dataset renamed)"
fi

# Test 7: Create test data in test-prod
echo -e "\n${BLUE}Test 7: Create test data${NC}"
PGPASSWORD=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[] | select(.name == "test-prod") | .credentials.password')
PGPORT=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[] | select(.name == "test-prod") | .branches[0].port')

PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres >/dev/null 2>&1 <<EOF
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW());
INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');
EOF
check_test "Create test data in test-prod"

# ============================================================================
# SECTION 2: Branch Commands
# ============================================================================

echo -e "\n${BLUE}=== Section 2: Branch Commands ===${NC}"

# Test 8: Create branch from main (default)
echo -e "\n${BLUE}Test 8: Create branch from main${NC}"
$BPG branch create test-prod/dev >/dev/null 2>&1
sleep 3
check_test "Create branch 'test-prod/dev'"

# Test 9: Create branch with --from flag
echo -e "\n${BLUE}Test 9: Create branch from non-main parent${NC}"
$BPG branch create test-prod/feature --from test-prod/dev >/dev/null 2>&1
sleep 3
if sudo zfs list tank/betterpg/databases/test-prod-feature >/dev/null 2>&1; then
    check_test "Create branch with --from flag"
else
    false
    check_test "Create branch with --from flag"
fi

# Test 10: List branches (all)
echo -e "\n${BLUE}Test 10: List all branches${NC}"
OUTPUT=$($BPG branch list 2>&1)
if echo "$OUTPUT" | grep -q "test-prod/main" && echo "$OUTPUT" | grep -q "test-prod/dev"; then
    check_test "List all branches"
else
    false
    check_test "List all branches"
fi

# Test 11: List branches for specific database
echo -e "\n${BLUE}Test 11: List branches for specific database${NC}"
OUTPUT=$($BPG branch list test-prod 2>&1)
if echo "$OUTPUT" | grep -q "test-prod/main" && ! echo "$OUTPUT" | grep -q "test-dev"; then
    check_test "List branches for specific database"
else
    false
    check_test "List branches for specific database"
fi

# Test 12: Get branch details
echo -e "\n${BLUE}Test 12: Get branch details${NC}"
OUTPUT=$($BPG branch get test-prod/dev 2>&1)
if echo "$OUTPUT" | grep -q "test-prod/dev"; then
    check_test "Get branch details"
else
    false
    check_test "Get branch details"
fi

# Test 13: Branch rename
echo -e "\n${BLUE}Test 13: Rename branch${NC}"
$BPG branch rename test-prod/feature test-prod/hotfix >/dev/null 2>&1
if sudo zfs list tank/betterpg/databases/test-prod-hotfix >/dev/null 2>&1 && ! sudo zfs list tank/betterpg/databases/test-prod-feature >/dev/null 2>&1; then
    check_test "Rename branch"
else
    false
    check_test "Rename branch"
fi

# ============================================================================
# SECTION 3: Snapshot & PITR Commands
# ============================================================================

echo -e "\n${BLUE}=== Section 3: Snapshot & PITR Commands ===${NC}"

# Test 14: Create manual snapshot without label
echo -e "\n${BLUE}Test 14: Create manual snapshot${NC}"
$BPG snapshot create test-prod/main >/dev/null 2>&1
if [ $(cat ~/.local/share/betterpg/state.json | jq '[.databases[] | .snapshots[]] | length') -gt 0 ]; then
    check_test "Create manual snapshot"
else
    false
    check_test "Create manual snapshot"
fi

# Test 15: Create snapshot with label
echo -e "\n${BLUE}Test 15: Create snapshot with label${NC}"
$BPG snapshot create test-prod/main --label "before-migration" >/dev/null 2>&1
OUTPUT=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[] | .snapshots[] | select(.label == "before-migration") | .label')
if [ "$OUTPUT" = "before-migration" ]; then
    check_test "Create snapshot with label"
else
    false
    check_test "Create snapshot with label"
fi

# Test 16: List all snapshots
echo -e "\n${BLUE}Test 16: List all snapshots${NC}"
OUTPUT=$($BPG snapshot list 2>&1)
if echo "$OUTPUT" | grep -q "before-migration"; then
    check_test "List all snapshots"
else
    false
    check_test "List all snapshots"
fi

# Test 17: List snapshots for specific branch
echo -e "\n${BLUE}Test 17: List snapshots for specific branch${NC}"
OUTPUT=$($BPG snapshot list test-prod/main 2>&1)
if echo "$OUTPUT" | grep -q "test-prod/main"; then
    check_test "List snapshots for specific branch"
else
    false
    check_test "List snapshots for specific branch"
fi

# Test 18: Modify data after snapshot
echo -e "\n${BLUE}Test 18: Modify data after snapshot${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "INSERT INTO users (name) VALUES ('David'), ('Eve');" >/dev/null 2>&1
sleep 2
ROW_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM users;" | xargs)
if [ "$ROW_COUNT" -eq 5 ]; then
    check_test "Modify data (5 rows total)"
else
    false
    check_test "Modify data (5 rows total)"
fi

# Test 19: PITR - Recover to snapshot time
echo -e "\n${BLUE}Test 19: Point-in-time recovery${NC}"
SNAPSHOT_TIME=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[] | .snapshots[] | select(.label == "before-migration") | .createdAt')
$BPG branch create test-prod/pitr-recovery --pitr "$SNAPSHOT_TIME" >/dev/null 2>&1
sleep 5

PITR_PORT=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[] | .branches[] | select(.name == "test-prod/pitr-recovery") | .port')
PITR_ROW_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PITR_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | xargs)

if [ "$PITR_ROW_COUNT" -eq 3 ]; then
    check_test "PITR recovery (recovered to 3 rows)"
else
    echo "  Expected 3 rows, got $PITR_ROW_COUNT"
    false
    check_test "PITR recovery (recovered to 3 rows)"
fi

# ============================================================================
# SECTION 4: WAL Commands
# ============================================================================

echo -e "\n${BLUE}=== Section 4: WAL Commands ===${NC}"

# Test 20: WAL info for all branches
echo -e "\n${BLUE}Test 20: WAL info (all branches)${NC}"
OUTPUT=$($BPG wal info 2>&1)
if echo "$OUTPUT" | grep -q "test-prod"; then
    check_test "WAL info shows branches"
else
    false
    check_test "WAL info shows branches"
fi

# Test 21: WAL info for specific branch
echo -e "\n${BLUE}Test 21: WAL info (specific branch)${NC}"
OUTPUT=$($BPG wal info test-prod/main 2>&1)
if echo "$OUTPUT" | grep -q "test-prod/main"; then
    check_test "WAL info for specific branch"
else
    false
    check_test "WAL info for specific branch"
fi

# Test 22: WAL cleanup dry-run
echo -e "\n${BLUE}Test 22: WAL cleanup --dry-run${NC}"
OUTPUT=$($BPG wal cleanup test-prod/main --days 1 --dry-run 2>&1)
if echo "$OUTPUT" | grep -q "dry-run\|Dry run\|would"; then
    check_test "WAL cleanup dry-run mode"
else
    false
    check_test "WAL cleanup dry-run mode"
fi

# ============================================================================
# SECTION 5: Edge Cases & Error Handling
# ============================================================================

echo -e "\n${BLUE}=== Section 5: Edge Cases & Error Handling ===${NC}"

# Test 23: Create database with invalid name
echo -e "\n${BLUE}Test 23: Invalid database name${NC}"
if $BPG db create "test@invalid!" 2>&1 | grep -q "Invalid\|invalid"; then
    check_test "Reject invalid database name"
else
    false
    check_test "Reject invalid database name"
fi

# Test 24: Create branch from non-existent database
echo -e "\n${BLUE}Test 24: Branch from non-existent database${NC}"
if $BPG branch create non-existent/branch 2>&1 | grep -q "not found"; then
    check_test "Reject branch from non-existent database"
else
    false
    check_test "Reject branch from non-existent database"
fi

# Test 25: Delete database (without force - should fail with branches)
echo -e "\n${BLUE}Test 25: Delete database without --force${NC}"
if $BPG db delete test-dev 2>&1 | grep -q "force\|branches"; then
    check_test "Reject delete database with branches (no --force)"
else
    false
    check_test "Reject delete database with branches (no --force)"
fi

# Test 26: Delete database with --force
echo -e "\n${BLUE}Test 26: Delete database with --force${NC}"
$BPG db delete test-dev --force >/dev/null 2>&1
if ! sudo zfs list tank/betterpg/databases/test-dev-main >/dev/null 2>&1; then
    check_test "Delete database with --force"
else
    false
    check_test "Delete database with --force"
fi

# Test 27: Rename to existing name (collision)
echo -e "\n${BLUE}Test 27: Rename to existing branch name${NC}"
if $BPG branch rename test-prod/dev test-prod/main 2>&1 | grep -q "exists\|already"; then
    check_test "Reject rename to existing branch"
else
    false
    check_test "Reject rename to existing branch"
fi

# Test 28: Stop already stopped branch (idempotent)
echo -e "\n${BLUE}Test 28: Idempotent stop${NC}"
$BPG stop test-prod/dev >/dev/null 2>&1
$BPG stop test-prod/dev >/dev/null 2>&1
check_test "Stop already stopped branch (idempotent)"

# Test 29: Start already running branch (idempotent)
echo -e "\n${BLUE}Test 29: Idempotent start${NC}"
$BPG start test-prod/main >/dev/null 2>&1
$BPG start test-prod/main >/dev/null 2>&1
check_test "Start already running branch (idempotent)"

# Test 30: Delete snapshot
echo -e "\n${BLUE}Test 30: Delete snapshot${NC}"
SNAPSHOT_ID=$(cat ~/.local/share/betterpg/state.json | jq -r '.databases[] | .snapshots[0].id')
SNAPSHOT_COUNT_BEFORE=$(cat ~/.local/share/betterpg/state.json | jq '[.databases[] | .snapshots[]] | length')
$BPG snapshot delete "$SNAPSHOT_ID" >/dev/null 2>&1
SNAPSHOT_COUNT_AFTER=$(cat ~/.local/share/betterpg/state.json | jq '[.databases[] | .snapshots[]] | length')

if [ "$SNAPSHOT_COUNT_AFTER" -lt "$SNAPSHOT_COUNT_BEFORE" ]; then
    check_test "Delete snapshot"
else
    false
    check_test "Delete snapshot"
fi

# ============================================================================
# SECTION 6: Multi-Branch Stress Test
# ============================================================================

echo -e "\n${BLUE}=== Section 6: Multi-Branch Operations ===${NC}"

# Test 31: Create multiple branches
echo -e "\n${BLUE}Test 31: Create 5 branches from same parent${NC}"
for i in {1..5}; do
    $BPG branch create test-prod/test-branch-$i >/dev/null 2>&1 &
done
wait
sleep 5

BRANCH_COUNT=$(cat ~/.local/share/betterpg/state.json | jq '.databases[] | select(.name == "test-prod") | .branches | length')
if [ "$BRANCH_COUNT" -ge 7 ]; then  # main + dev + hotfix + pitr-recovery + 5 new = 9 total
    check_test "Create multiple branches concurrently"
else
    echo "  Expected >= 7 branches, got $BRANCH_COUNT"
    false
    check_test "Create multiple branches concurrently"
fi

# Test 32: Verify ZFS space efficiency with many branches
echo -e "\n${BLUE}Test 32: ZFS space efficiency${NC}"
MAIN_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod-main)
BRANCH1_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod-test-branch-1)

if [ "$BRANCH1_SIZE" -lt "$MAIN_SIZE" ]; then
    echo "  Main: $MAIN_SIZE bytes, Branch: $BRANCH1_SIZE bytes"
    check_test "ZFS copy-on-write efficiency verified"
else
    false
    check_test "ZFS copy-on-write efficiency verified"
fi

# ============================================================================
# Summary
# ============================================================================

echo -e "\n${BLUE}=== Test Summary ===${NC}"
TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
echo -e "${GREEN}✓ Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}✗ Failed: $TESTS_FAILED${NC}"
fi
echo -e "Total: $TOTAL_TESTS"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed!${NC}\n"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed${NC}\n"
    exit 1
fi
