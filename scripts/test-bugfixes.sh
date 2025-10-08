#!/bin/bash

set -e

TESTPROJECT="bugtest"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Bug Fix Verification Tests${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    pgd project delete $TESTPROJECT -f 2>/dev/null || true
    sleep 2
}

trap cleanup EXIT

# Start fresh
cleanup

echo -e "${BLUE}=== Test 1: Branch Sync + PITR Bug ===${NC}"
echo "This tests the fix for snapshots being orphaned after branch sync"
echo ""

echo -e "${BLUE}Step 1: Create project${NC}"
pgd project create $TESTPROJECT
sleep 3
echo ""

# Get connection info for main
STATE_FILE="$HOME/.local/share/@elitan/pgd/state.json"
PGPASSWORD=$(jq -r '.projects[] | select(.name=="'$TESTPROJECT'") | .credentials.password' $STATE_FILE)
MAIN_PORT=$(jq -r '.projects[] | select(.name=="'$TESTPROJECT'") | .branches[] | select(.isPrimary==true) | .port' $STATE_FILE)
export PGPASSWORD

echo -e "${BLUE}Step 2: Add data to main${NC}"
psql -h localhost -p $MAIN_PORT -U postgres -d postgres -c "
  CREATE TABLE test_data (id SERIAL PRIMARY KEY, value TEXT);
  INSERT INTO test_data (value) VALUES ('data1'), ('data2');
  SELECT pg_switch_wal();
"
sleep 2
echo ""

echo -e "${BLUE}Step 3: Create dev branch${NC}"
pgd branch create $TESTPROJECT/dev
sleep 3
echo ""

DEV_PORT=$(jq -r '.projects[] | select(.name=="'$TESTPROJECT'") | .branches[] | select(.name=="'$TESTPROJECT'/dev") | .port' $STATE_FILE)

echo -e "${BLUE}Step 4: Create snapshot of dev branch${NC}"
pgd snapshot create $TESTPROJECT/dev --label "before-sync"
echo ""

echo -e "${BLUE}Step 5: Add more data to main${NC}"
psql -h localhost -p $MAIN_PORT -U postgres -d postgres -c "
  INSERT INTO test_data (value) VALUES ('data3'), ('data4');
  SELECT pg_switch_wal();
"
sleep 2
echo ""

echo -e "${BLUE}Step 6: Sync dev branch with main${NC}"
pgd branch sync $TESTPROJECT/dev
sleep 3
echo ""

echo -e "${BLUE}Step 7: Check that orphaned snapshots were cleaned up${NC}"
SNAPSHOT_COUNT=$(jq '[.snapshots[] | select(.branchName=="'$TESTPROJECT'/dev")] | length' $STATE_FILE)
echo "Snapshots remaining for $TESTPROJECT/dev: $SNAPSHOT_COUNT"

if [ "$SNAPSHOT_COUNT" = "0" ]; then
    echo -e "${GREEN}✓ Test 1 PASSED: Orphaned snapshots cleaned up correctly${NC}"
else
    echo -e "${RED}✗ Test 1 FAILED: Found $SNAPSHOT_COUNT orphaned snapshots (expected 0)${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}=== Test 2: Branch Delete with Dependents Bug ===${NC}"
echo "This tests the fix for deleting branches with dependent clones"
echo ""

echo -e "${BLUE}Step 1: Create test branch${NC}"
pgd branch create $TESTPROJECT/test
sleep 3
echo ""

echo -e "${BLUE}Step 2: Delete test branch (should succeed even if main has clones)${NC}"
pgd branch delete $TESTPROJECT/test
echo ""

echo -e "${BLUE}Step 3: Verify branch was deleted${NC}"
BRANCH_COUNT=$(jq '[.projects[] | select(.name=="'$TESTPROJECT'") | .branches[] | select(.name=="'$TESTPROJECT'/test")] | length' $STATE_FILE)

if [ "$BRANCH_COUNT" = "0" ]; then
    echo -e "${GREEN}✓ Test 2 PASSED: Branch deleted successfully${NC}"
else
    echo -e "${RED}✗ Test 2 FAILED: Branch still exists in state${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}=== Test 3: Snapshot State Cleanup on Branch Delete ===${NC}"
echo "This tests that snapshots are cleaned from state when branch is deleted"
echo ""

echo -e "${BLUE}Step 1: Create new branch${NC}"
pgd branch create $TESTPROJECT/temp
sleep 3
echo ""

echo -e "${BLUE}Step 2: Create snapshot for temp branch${NC}"
pgd snapshot create $TESTPROJECT/temp --label "temp-snapshot"
echo ""

echo -e "${BLUE}Step 3: Verify snapshot exists${NC}"
SNAP_COUNT_BEFORE=$(jq '[.snapshots[] | select(.branchName=="'$TESTPROJECT'/temp")] | length' $STATE_FILE)
echo "Snapshots before delete: $SNAP_COUNT_BEFORE"

if [ "$SNAP_COUNT_BEFORE" != "1" ]; then
    echo -e "${RED}✗ Test 3 FAILED: Snapshot not found (expected 1, got $SNAP_COUNT_BEFORE)${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}Step 4: Delete temp branch${NC}"
pgd branch delete $TESTPROJECT/temp
echo ""

echo -e "${BLUE}Step 5: Verify snapshots were cleaned up${NC}"
SNAP_COUNT_AFTER=$(jq '[.snapshots[] | select(.branchName=="'$TESTPROJECT'/temp")] | length' $STATE_FILE)
echo "Snapshots after delete: $SNAP_COUNT_AFTER"

if [ "$SNAP_COUNT_AFTER" = "0" ]; then
    echo -e "${GREEN}✓ Test 3 PASSED: Snapshots cleaned up on branch delete${NC}"
else
    echo -e "${RED}✗ Test 3 FAILED: Found $SNAP_COUNT_AFTER orphaned snapshots (expected 0)${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}All bug fix tests passed!${NC}"
echo -e "${BLUE}========================================${NC}"
