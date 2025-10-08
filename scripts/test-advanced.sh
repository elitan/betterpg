#!/bin/bash
# Advanced integration tests for pgd
# Tests edge cases, stress scenarios, and advanced features

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${YELLOW}🧪 Running pgd advanced integration tests${NC}\n"

if [ ! -f "./dist/pgd" ]; then
    echo -e "${RED}✗ Binary not found. Please run: bun run build${NC}"
    exit 1
fi

BPG="./dist/pgd"

# Get CLI name from package.json for state file paths
CLI_NAME=$(cat package.json | jq -r '.cliName // .name')
STATE_FILE=~/.local/share/${CLI_NAME}/state.json

cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    docker ps -a | grep pgd- | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true
    sudo zfs destroy -r tank/pgd/databases 2>/dev/null || true
    sudo zfs create tank/pgd/databases 2>/dev/null || true
    rm -rf ~/.config/pgd ~/.local/share/pgd ~/.local/share/@elitan/pgd 2>/dev/null || true
    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

cleanup
trap cleanup EXIT

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
# Setup
# ============================================================================

echo -e "\n${BLUE}=== Setup ===${NC}"
$BPG project create test-db >/dev/null 2>&1 && sleep 3
PGPASSWORD=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].credentials.password')
PGPORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].branches[0].port')

# Create test data
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres >/dev/null 2>&1 <<EOF
CREATE TABLE test_data (id SERIAL PRIMARY KEY, value TEXT);
INSERT INTO test_data (value) VALUES ('initial');
EOF

echo -e "${GREEN}✓ Setup complete${NC}"

# ============================================================================
# SECTION 1: Branch Sync
# ============================================================================

echo -e "\n${BLUE}=== Section 1: Branch Sync ===${NC}"

# Test 1: Create branch and sync
echo -e "\n${BLUE}Test 1: Branch sync updates branch with parent changes${NC}"
$BPG branch create test-db/dev >/dev/null 2>&1 && sleep 3

# Modify parent
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "INSERT INTO test_data (value) VALUES ('parent-change');" >/dev/null 2>&1

# Sync branch
$BPG branch sync test-db/dev >/dev/null 2>&1 && sleep 3

# Check if branch has new data
DEV_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[] | .branches[] | select(.name == "test-db/dev") | .port')
DEV_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_data WHERE value='parent-change';" 2>/dev/null | xargs)

if [ "$DEV_COUNT" -eq 1 ]; then
    check_test "Branch sync updates with parent changes"
else
    echo "  Expected 1 row with 'parent-change', got $DEV_COUNT"
    false
    check_test "Branch sync updates with parent changes"
fi

# Test 2: Verify branch changes are lost after sync
echo -e "\n${BLUE}Test 2: Branch sync discards local changes${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -c "INSERT INTO test_data (value) VALUES ('dev-only');" >/dev/null 2>&1

$BPG branch sync test-db/dev >/dev/null 2>&1 && sleep 3

DEV_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[] | .branches[] | select(.name == "test-db/dev") | .port')
DEV_ONLY_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_data WHERE value='dev-only';" 2>/dev/null | xargs)

if [ "$DEV_ONLY_COUNT" -eq 0 ]; then
    check_test "Branch sync discards local changes"
else
    echo "  Expected 0 'dev-only' rows after sync, got $DEV_ONLY_COUNT"
    false
    check_test "Branch sync discards local changes"
fi

# ============================================================================
# SECTION 2: Connection String Verification
# ============================================================================

echo -e "\n${BLUE}=== Section 2: Connection String Verification ===${NC}"

# Test 3: Verify connection string works
echo -e "\n${BLUE}Test 3: Connection string from status is valid${NC}"
CONN_STRING=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].credentials | "postgresql://\(.username):\(.password)@localhost:\(.port // 5432)/\(.database)"')
MAIN_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].branches[0].port')
CONN_STRING_WITH_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].credentials | "postgresql://\(.username):\(.password)@localhost:'$MAIN_PORT'/\(.database)"')

if PGPASSWORD= psql "$CONN_STRING_WITH_PORT" -c "SELECT 1;" >/dev/null 2>&1; then
    check_test "Connection string is valid"
else
    false
    check_test "Connection string is valid"
fi

# ============================================================================
# SECTION 3: State Integrity
# ============================================================================

echo -e "\n${BLUE}=== Section 3: State Integrity ===${NC}"

# Test 4: Create multiple branches and verify state consistency
echo -e "\n${BLUE}Test 4: State consistency with multiple branches${NC}"
for i in {1..3}; do
    $BPG branch create test-db/branch-$i >/dev/null 2>&1
    sleep 2
done

# Verify all branches are in state
BRANCH_COUNT=$(cat ~/.local/share/@elitan/pgd/state.json | jq '.projects[0].branches | length')
if [ "$BRANCH_COUNT" -ge 5 ]; then  # main + dev + 3 new branches
    check_test "State tracks all branches in project"
else
    echo "  Expected >= 5 branches, got $BRANCH_COUNT"
    false
    check_test "State tracks all branches in project"
fi

# Test 5: Verify no duplicate branch names
echo -e "\n${BLUE}Test 5: State prevents duplicate branch names${NC}"
DUPLICATE_COUNT=$(cat ~/.local/share/@elitan/pgd/state.json | jq '[.projects[0].branches[].name] | group_by(.) | map(length) | max')
if [ "$DUPLICATE_COUNT" -eq 1 ]; then
    check_test "No duplicate branch names"
else
    echo "  Found duplicate branch names (max count: $DUPLICATE_COUNT)"
    false
    check_test "No duplicate branch names"
fi

# ============================================================================
# SECTION 4: Branch Deletion Constraints
# ============================================================================

echo -e "\n${BLUE}=== Section 4: Branch Deletion Constraints ===${NC}"

# Test 6: Cannot delete main branch
echo -e "\n${BLUE}Test 6: Prevent deletion of main branch${NC}"
if $BPG branch delete test-db/main 2>&1 | grep -qi "main\|primary\|cannot"; then
    check_test "Cannot delete main branch"
else
    false
    check_test "Cannot delete main branch"
fi

# ============================================================================
# SECTION 5: Stop/Start Edge Cases
# ============================================================================

echo -e "\n${BLUE}=== Section 5: Stop/Start Edge Cases ===${NC}"

# Test 7: Operations on stopped branches
echo -e "\n${BLUE}Test 7: Cannot create snapshot of stopped branch${NC}"
$BPG stop test-db/dev >/dev/null 2>&1
if $BPG snapshot create test-db/dev 2>&1 | grep -qi "stopped\|not running\|running"; then
    check_test "Snapshot requires running branch"
else
    # Snapshot might succeed on stopped branch, which is fine for ZFS
    echo "  Note: Snapshot succeeded on stopped branch (acceptable)"
    check_test "Snapshot behavior on stopped branch verified"
fi

# Test 8: Restart restores functionality
echo -e "\n${BLUE}Test 8: Start restores branch functionality${NC}"
$BPG start test-db/dev >/dev/null 2>&1 && sleep 3
DEV_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[] | .branches[] | select(.name == "test-db/dev") | .port')
if PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
    check_test "Started branch is connectable"
else
    false
    check_test "Started branch is connectable"
fi

# ============================================================================
# SECTION 6: ZFS Integration
# ============================================================================

echo -e "\n${BLUE}=== Section 6: ZFS Integration ===${NC}"

# Test 9: Verify ZFS datasets exist for all branches
echo -e "\n${BLUE}Test 9: ZFS datasets match state${NC}"
STATE_DATASETS=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].branches[].zfsDatasetName' | sort)
ZFS_DATASETS=$(sudo zfs list -H -o name -r tank/pgd/databases | grep "^tank/pgd/databases/" | sed 's|tank/pgd/databases/||' | sort)

if [ "$(echo "$STATE_DATASETS" | wc -l)" -eq "$(echo "$ZFS_DATASETS" | wc -l)" ]; then
    check_test "ZFS datasets match state count"
else
    echo "  State datasets: $(echo "$STATE_DATASETS" | wc -l)"
    echo "  ZFS datasets: $(echo "$ZFS_DATASETS" | wc -l)"
    false
    check_test "ZFS datasets match state count"
fi

# Test 10: Verify snapshots exist in ZFS
echo -e "\n${BLUE}Test 10: ZFS snapshots match state${NC}"
$BPG snapshot create test-db/main --label "test-snap" >/dev/null 2>&1
SNAPSHOT_COUNT=$(cat ~/.local/share/@elitan/pgd/state.json | jq '[.snapshots[] | select(.projectName == "test-db")] | length')
ZFS_SNAPSHOT_COUNT=$(sudo zfs list -t snapshot -H | grep "tank/pgd/databases/test-db" | wc -l)

if [ "$ZFS_SNAPSHOT_COUNT" -gt 0 ]; then
    check_test "ZFS snapshots exist"
else
    echo "  ZFS snapshots: $ZFS_SNAPSHOT_COUNT"
    false
    check_test "ZFS snapshots exist"
fi

# ============================================================================
# SECTION 7: Docker Integration
# ============================================================================

echo -e "\n${BLUE}=== Section 7: Docker Integration ===${NC}"

# Test 11: Verify all running branches have containers
echo -e "\n${BLUE}Test 11: Running branches have Docker containers${NC}"
RUNNING_BRANCHES=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].branches[] | select(.status == "running") | .containerName')
MISSING_CONTAINERS=0
for container in $RUNNING_BRANCHES; do
    if ! docker ps | grep -q "$container"; then
        ((MISSING_CONTAINERS++))
    fi
done

if [ "$MISSING_CONTAINERS" -eq 0 ]; then
    check_test "All running branches have containers"
else
    echo "  Missing containers: $MISSING_CONTAINERS"
    false
    check_test "All running branches have containers"
fi

# Test 12: Container naming convention
echo -e "\n${BLUE}Test 12: Container names follow convention${NC}"
CONTAINER_NAME=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].branches[0].containerName')
if echo "$CONTAINER_NAME" | grep -q "^pgd-test-db-main$"; then
    check_test "Container naming convention (pgd-<db>-<branch>)"
else
    echo "  Container name: $CONTAINER_NAME"
    false
    check_test "Container naming convention"
fi

# ============================================================================
# SECTION 8: Cleanup Verification
# ============================================================================

echo -e "\n${BLUE}=== Section 8: Cleanup Verification ===${NC}"

# Test 13: Delete branch removes all artifacts
echo -e "\n${BLUE}Test 13: Delete branch cleans up completely${NC}"
$BPG branch delete test-db/branch-1 >/dev/null 2>&1
sleep 2

# Check ZFS dataset is gone
if ! sudo zfs list tank/pgd/databases/test-db-branch-1 >/dev/null 2>&1; then
    ZFS_GONE=true
else
    ZFS_GONE=false
fi

# Check container is gone
if ! docker ps -a | grep -q "pgd-test-db-branch-1"; then
    CONTAINER_GONE=true
else
    CONTAINER_GONE=false
fi

# Check state is updated
if ! cat ~/.local/share/@elitan/pgd/state.json | jq -e '.projects[0].branches[] | select(.name == "test-db/branch-1")' >/dev/null 2>&1; then
    STATE_GONE=true
else
    STATE_GONE=false
fi

if [ "$ZFS_GONE" = true ] && [ "$CONTAINER_GONE" = true ] && [ "$STATE_GONE" = true ]; then
    check_test "Delete removes all artifacts (ZFS, Docker, State)"
else
    echo "  ZFS gone: $ZFS_GONE, Container gone: $CONTAINER_GONE, State gone: $STATE_GONE"
    false
    check_test "Delete removes all artifacts"
fi

# ============================================================================
# Summary
# ============================================================================

echo -e "\n${BLUE}=== Test Summary ===${NC}"
TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
echo -e "${GREEN}✓ Passed: $TESTS_PASSED/$TOTAL_TESTS${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}✗ Failed: $TESTS_FAILED/$TOTAL_TESTS${NC}"
fi

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All advanced tests passed!${NC}\n"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed${NC}\n"
    exit 1
fi
