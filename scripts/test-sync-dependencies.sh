#!/bin/bash
# Test sync command with dependent branches
# Tests that syncing a branch with dependents is blocked unless --force is used

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${YELLOW}🧪 Running pgd branch sync dependency tests${NC}\n"

if [ ! -f "./dist/pgd" ]; then
    echo -e "${RED}✗ Binary not found. Please run: bun run build${NC}"
    exit 1
fi

BPG="./dist/pgd"

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

branch_exists() {
    local branch_name=$1
    cat ~/.local/share/@elitan/pgd/state.json | jq -e ".projects[].branches[] | select(.name == \"$branch_name\")" >/dev/null 2>&1
}

# ============================================================================
# Setup
# ============================================================================

echo -e "\n${BLUE}=== Setup ===${NC}"
$BPG project create testdb >/dev/null 2>&1 && sleep 3
PGPASSWORD=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].credentials.password')
MAIN_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[0].branches[0].port')

# Create test data
PGPASSWORD=$PGPASSWORD psql -h localhost -p $MAIN_PORT -U postgres -d postgres >/dev/null 2>&1 <<EOF
CREATE TABLE test_data (id SERIAL PRIMARY KEY, value TEXT);
INSERT INTO test_data (value) VALUES ('initial');
EOF

echo -e "${GREEN}✓ Setup complete${NC}"

# ============================================================================
# Test 1: Sync branch without dependents succeeds
# ============================================================================

echo -e "\n${BLUE}Test 1: Sync branch without dependents succeeds${NC}"

# Create a simple branch
$BPG branch create testdb/dev >/dev/null 2>&1 && sleep 3

# Modify main branch
PGPASSWORD=$PGPASSWORD psql -h localhost -p $MAIN_PORT -U postgres -d postgres -c "INSERT INTO test_data (value) VALUES ('update1');" >/dev/null 2>&1

# Sync should succeed
$BPG branch sync testdb/dev >/dev/null 2>&1 && sleep 3
check_test "Sync branch without dependents"

# ============================================================================
# Test 2: Sync branch with one dependent is blocked
# ============================================================================

echo -e "\n${BLUE}Test 2: Sync branch with one dependent is blocked${NC}"

# Create branch chain: main -> dev -> feature
$BPG branch create testdb/feature --from testdb/dev >/dev/null 2>&1 && sleep 3

# Try to sync dev (which has feature as dependent) - should fail
$BPG branch sync testdb/dev >/dev/null 2>&1
if [ $? -ne 0 ]; then
    check_test "Sync blocked when branch has one dependent"
else
    false
    check_test "Sync blocked when branch has one dependent"
fi

# Verify feature branch still exists (was not destroyed)
if branch_exists "testdb/feature"; then
    check_test "Dependent branch not destroyed when sync is blocked"
else
    false
    check_test "Dependent branch not destroyed when sync is blocked"
fi

# ============================================================================
# Test 3: Sync branch with multiple dependents is blocked
# ============================================================================

echo -e "\n${BLUE}Test 3: Sync branch with multiple dependents is blocked${NC}"

# Create multiple dependents: main -> dev -> feature1, feature2
$BPG branch create testdb/feature2 --from testdb/dev >/dev/null 2>&1 && sleep 3

# Try to sync dev - should fail
$BPG branch sync testdb/dev >/dev/null 2>&1
if [ $? -ne 0 ]; then
    check_test "Sync blocked when branch has multiple dependents"
else
    false
    check_test "Sync blocked when branch has multiple dependents"
fi

# Verify both dependent branches still exist
if branch_exists "testdb/feature" && branch_exists "testdb/feature2"; then
    check_test "Multiple dependent branches not destroyed when sync is blocked"
else
    false
    check_test "Multiple dependent branches not destroyed when sync is blocked"
fi

# ============================================================================
# Test 4: --force flag allows sync with dependents
# ============================================================================

echo -e "\n${BLUE}Test 4: --force flag allows sync with dependents${NC}"

# Sync with --force should succeed
$BPG branch sync testdb/dev --force >/dev/null 2>&1 && sleep 3
check_test "Sync with --force succeeds"

# Verify dependent branches were destroyed
if ! branch_exists "testdb/feature" && ! branch_exists "testdb/feature2"; then
    check_test "Dependent branches destroyed after --force sync"
else
    echo "  Feature exists: $(branch_exists testdb/feature && echo yes || echo no)"
    echo "  Feature2 exists: $(branch_exists testdb/feature2 && echo yes || echo no)"
    false
    check_test "Dependent branches destroyed after --force sync"
fi

# Verify dev branch still exists and is functional
if branch_exists "testdb/dev"; then
    DEV_PORT=$(cat ~/.local/share/@elitan/pgd/state.json | jq -r '.projects[] | .branches[] | select(.name == "testdb/dev") | .port')
    DEV_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_data;" 2>/dev/null | xargs)

    if [ "$DEV_COUNT" -ge 1 ]; then
        check_test "Dev branch functional after --force sync"
    else
        echo "  Expected at least 1 row, got $DEV_COUNT"
        false
        check_test "Dev branch functional after --force sync"
    fi
else
    false
    check_test "Dev branch exists after --force sync"
fi

# ============================================================================
# Test 5: Nested dependency chain (three levels)
# ============================================================================

echo -e "\n${BLUE}Test 5: Nested dependency chain (three levels)${NC}"

# Create chain: main -> branch1 -> branch2 -> branch3
$BPG branch create testdb/branch1 >/dev/null 2>&1 && sleep 3
$BPG branch create testdb/branch2 --from testdb/branch1 >/dev/null 2>&1 && sleep 3
$BPG branch create testdb/branch3 --from testdb/branch2 >/dev/null 2>&1 && sleep 3

# Try to sync branch1 (has branch2 as dependent) - should fail
$BPG branch sync testdb/branch1 >/dev/null 2>&1
if [ $? -ne 0 ]; then
    check_test "Sync blocked for first level in nested chain"
else
    false
    check_test "Sync blocked for first level in nested chain"
fi

# Try to sync branch2 (has branch3 as dependent) - should fail
$BPG branch sync testdb/branch2 >/dev/null 2>&1
if [ $? -ne 0 ]; then
    check_test "Sync blocked for middle level in nested chain"
else
    false
    check_test "Sync blocked for middle level in nested chain"
fi

# Sync branch3 (no dependents) - should succeed
$BPG branch sync testdb/branch3 >/dev/null 2>&1 && sleep 3
check_test "Sync succeeds for leaf branch in nested chain"

# ============================================================================
# Test 6: Error message includes dependent branch names
# ============================================================================

echo -e "\n${BLUE}Test 6: Error message includes dependent branch names${NC}"

# Clean up test 5 branches first
$BPG branch delete testdb/branch3 >/dev/null 2>&1 || true
$BPG branch delete testdb/branch2 >/dev/null 2>&1 || true

# Recreate dependencies for test 6
$BPG branch create testdb/dep1 --from testdb/branch1 >/dev/null 2>&1 && sleep 3
$BPG branch create testdb/dep2 --from testdb/branch1 >/dev/null 2>&1 && sleep 3

# Try to sync and capture error message
ERROR_MSG=$($BPG branch sync testdb/branch1 2>&1)

if echo "$ERROR_MSG" | grep -q "testdb/dep1" && echo "$ERROR_MSG" | grep -q "testdb/dep2"; then
    check_test "Error message includes all dependent branch names"
else
    echo "  Error message: $ERROR_MSG"
    false
    check_test "Error message includes all dependent branch names"
fi

if echo "$ERROR_MSG" | grep -q "force"; then
    check_test "Error message mentions --force flag"
else
    echo "  Error message: $ERROR_MSG"
    false
    check_test "Error message mentions --force flag"
fi

# ============================================================================
# Test 7: Deleting dependent allows sync
# ============================================================================

echo -e "\n${BLUE}Test 7: Deleting dependent allows sync${NC}"

# Delete one dependent
$BPG branch delete testdb/dep1 >/dev/null 2>&1

# Still has dep2, should fail
$BPG branch sync testdb/branch1 >/dev/null 2>&1
if [ $? -ne 0 ]; then
    check_test "Sync still blocked with remaining dependents"
else
    false
    check_test "Sync still blocked with remaining dependents"
fi

# Delete remaining dependent
$BPG branch delete testdb/dep2 >/dev/null 2>&1

# Now sync should succeed
$BPG branch sync testdb/branch1 >/dev/null 2>&1 && sleep 3
check_test "Sync succeeds after deleting all dependents"

# ============================================================================
# Results
# ============================================================================

echo -e "\n${BLUE}=== Test Results ===${NC}"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}✗ Some tests failed${NC}"
    exit 1
fi
