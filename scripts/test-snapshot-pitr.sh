#!/bin/bash

set -e

TESTDB="snaptest"
TESTBRANCH="$TESTDB/main"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Snapshot + PITR Integration Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    pgd db delete $TESTDB -f 2>/dev/null || true
    sleep 2
    # Clean up any leftover resources
    sudo zfs destroy -r tank/pgd/databases/$TESTDB-main 2>/dev/null || true
    docker rm -f pgd-$TESTDB-main 2>/dev/null || true
    docker rm -f pgd-$TESTDB-pitr-test 2>/dev/null || true
    docker rm -f pgd-$TESTDB-pitr-snapshot1 2>/dev/null || true
}

trap cleanup EXIT

# Start fresh
cleanup

echo -e "${BLUE}Step 1: Create database${NC}"
pgd db create $TESTDB
echo ""

# Wait for PostgreSQL to be ready
sleep 5

echo -e "${BLUE}Step 2: Insert initial data (t=0)${NC}"
# Parse connection info from state file
PGPASSWORD=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .credentials.password' ~/.local/share/pgd/state.json)
PORT=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .branches[] | select(.isPrimary==true) | .port' ~/.local/share/pgd/state.json)
export PGPASSWORD
echo "Connecting to localhost:$PORT"

psql -h localhost -p $PORT -U postgres -d postgres -c "
  CREATE TABLE timeline (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    event TEXT
  );
  INSERT INTO timeline (event) VALUES ('Initial data at t=0');
  -- Force WAL segment switch to trigger archiving
  SELECT pg_switch_wal();
"
echo ""

# Wait for WAL archiving
echo "Waiting for WAL archiving..."
sleep 3

# Create snapshot 1
echo -e "${BLUE}Step 3: Create snapshot 1 (before-test-1)${NC}"
sleep 2  # Ensure some time passes
pgd snapshot create $TESTBRANCH --label before-test-1
SNAPSHOT1_TIME=$(date -Iseconds)
echo -e "${GREEN}Snapshot 1 created at: $SNAPSHOT1_TIME${NC}"
echo ""

# Insert more data
echo -e "${BLUE}Step 4: Insert data after snapshot 1 (t=1)${NC}"
sleep 2
psql -h localhost -p $PORT -U postgres -d postgres -c "
  INSERT INTO timeline (event) VALUES ('Data inserted at t=1');
  SELECT pg_switch_wal();
"
echo ""

# Wait for WAL archiving
sleep 3

# Create snapshot 2
echo -e "${BLUE}Step 5: Create snapshot 2 (before-test-2)${NC}"
sleep 2
pgd snapshot create $TESTBRANCH --label before-test-2
SNAPSHOT2_TIME=$(date -Iseconds)
echo -e "${GREEN}Snapshot 2 created at: $SNAPSHOT2_TIME${NC}"
echo ""

# Insert even more data
echo -e "${BLUE}Step 6: Insert data after snapshot 2 (t=2)${NC}"
sleep 2
psql -h localhost -p $PORT -U postgres -d postgres -c "
  INSERT INTO timeline (event) VALUES ('Data inserted at t=2');
  SELECT pg_switch_wal();
"
TARGET_TIME=$(date -Iseconds)
echo -e "${GREEN}PITR target time: $TARGET_TIME${NC}"
echo ""

# Wait for WAL archiving
sleep 3

# Insert final data
echo -e "${BLUE}Step 7: Insert data after target time (t=3)${NC}"
sleep 2
psql -h localhost -p $PORT -U postgres -d postgres -c "
  INSERT INTO timeline (event) VALUES ('Data inserted at t=3 (should not appear in PITR branch)');
  SELECT pg_switch_wal();
"
echo ""

# Wait for final WAL archiving
sleep 3

# Show current state
echo -e "${BLUE}Step 8: Show current timeline in main branch${NC}"
psql -h localhost -p $PORT -U postgres -d postgres -c "
  SELECT * FROM timeline ORDER BY id;
"
echo ""

# List snapshots
echo -e "${BLUE}Step 9: List snapshots${NC}"
pgd snapshot list $TESTBRANCH
echo ""

# Test PITR to target time (should use snapshot 2)
echo -e "${BLUE}Step 10: Create PITR branch to target time${NC}"
echo -e "${YELLOW}Target: $TARGET_TIME${NC}"
pgd branch create $TESTDB/pitr-test --pitr "$TARGET_TIME"
echo ""

# Wait for PITR branch to be ready
sleep 5

# Check PITR branch data
echo -e "${BLUE}Step 11: Verify PITR branch data${NC}"
PITR_PORT=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .branches[] | select(.name=="'$TESTDB'/pitr-test") | .port' ~/.local/share/pgd/state.json)
echo -e "${YELLOW}Expected: 3 rows (t=0, t=1, t=2)${NC}"
psql -h localhost -p $PITR_PORT -U postgres -d postgres -c "
  SELECT * FROM timeline ORDER BY id;
"
echo ""

# Count rows
ROW_COUNT=$(psql -h localhost -p $PITR_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM timeline;")
ROW_COUNT=$(echo $ROW_COUNT | xargs)

if [ "$ROW_COUNT" = "3" ]; then
    echo -e "${GREEN}✓ PITR recovery successful! Got $ROW_COUNT rows (expected 3)${NC}"
else
    echo -e "${RED}✗ PITR recovery failed! Got $ROW_COUNT rows (expected 3)${NC}"
    exit 1
fi
echo ""

# Test PITR to snapshot 1 time (should use snapshot 1)
echo -e "${BLUE}Step 12: Create PITR branch to snapshot 1 time${NC}"
echo -e "${YELLOW}Target: $SNAPSHOT1_TIME${NC}"
pgd branch create $TESTDB/pitr-snapshot1 --pitr "$SNAPSHOT1_TIME"
echo ""

# Wait for PITR branch to be ready
sleep 5

# Check PITR branch data
echo -e "${BLUE}Step 13: Verify PITR snapshot1 branch data${NC}"
PITR_PORT2=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .branches[] | select(.name=="'$TESTDB'/pitr-snapshot1") | .port' ~/.local/share/pgd/state.json)
echo -e "${YELLOW}Expected: 1 row (t=0 only)${NC}"
psql -h localhost -p $PITR_PORT2 -U postgres -d postgres -c "
  SELECT * FROM timeline ORDER BY id;
"
echo ""

# Count rows
ROW_COUNT2=$(psql -h localhost -p $PITR_PORT2 -U postgres -d postgres -t -c "SELECT COUNT(*) FROM timeline;")
ROW_COUNT2=$(echo $ROW_COUNT2 | xargs)

if [ "$ROW_COUNT2" = "1" ]; then
    echo -e "${GREEN}✓ PITR to snapshot 1 successful! Got $ROW_COUNT2 rows (expected 1)${NC}"
else
    echo -e "${RED}✗ PITR to snapshot 1 failed! Got $ROW_COUNT2 rows (expected 1)${NC}"
    exit 1
fi
echo ""

# Test error: PITR before any snapshot
echo -e "${BLUE}Step 14: Test PITR error (before any snapshot)${NC}"
BEFORE_TIME=$(date -Iseconds -d "1 hour ago")
if pgd branch create $TESTDB/pitr-error --pitr "$BEFORE_TIME" 2>&1 | grep -q "No snapshots found"; then
    echo -e "${GREEN}✓ Correctly rejected PITR before any snapshot${NC}"
else
    echo -e "${RED}✗ Should have rejected PITR before any snapshot${NC}"
    exit 1
fi
echo ""

# Show final status
echo -e "${BLUE}Final status:${NC}"
pgd branch list $TESTDB
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All snapshot + PITR tests passed!${NC}"
echo -e "${GREEN}========================================${NC}"
