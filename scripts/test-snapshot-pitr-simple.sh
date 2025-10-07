#!/bin/bash

set -e

TESTDB="snappitr"
TESTBRANCH="$TESTDB/main"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Simplified Snapshot + PITR Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    pgd db delete $TESTDB -f 2>/dev/null || true
    sleep 2
}

trap cleanup EXIT

# Start fresh
cleanup

echo -e "${BLUE}Step 1: Create database${NC}"
pgd db create $TESTDB
echo ""

# Wait for PostgreSQL to be ready
sleep 3

# Get connection info
PGPASSWORD=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .credentials.password' ~/.local/share/pgd/state.json)
PORT=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .branches[] | select(.isPrimary==true) | .port' ~/.local/share/pgd/state.json)
export PGPASSWORD

echo -e "${BLUE}Step 2: Create table and insert initial data${NC}"
psql -h localhost -p $PORT -U postgres -d postgres -c "
  CREATE TABLE test_data (
    id SERIAL PRIMARY KEY,
    value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  INSERT INTO test_data (value) VALUES ('row1'), ('row2'), ('row3');
  SELECT pg_switch_wal();
"
echo ""

echo "Waiting for WAL archiving..."
sleep 3

echo -e "${BLUE}Step 3: Create snapshot${NC}"
pgd snapshot create $TESTBRANCH --label test-snapshot
echo ""

echo -e "${BLUE}Step 4: Insert more data AFTER snapshot${NC}"
psql -h localhost -p $PORT -U postgres -d postgres -c "
  INSERT INTO test_data (value) VALUES ('row4'), ('row5'), ('row6');
  SELECT pg_switch_wal();
"
echo ""

echo "Waiting for WAL archiving..."
sleep 3

echo -e "${BLUE}Step 5: Show current data in main branch${NC}"
psql -h localhost -p $PORT -U postgres -d postgres -c "
  SELECT COUNT(*) as row_count FROM test_data;
  SELECT * FROM test_data ORDER BY id;
"
echo ""

echo -e "${BLUE}Step 6: Create branch from snapshot (WITHOUT PITR - should have 3 rows)${NC}"
pgd branch create $TESTDB/test-snapshot-only --from $TESTBRANCH
echo ""

sleep 3

SNAP_PORT=$(jq -r '.databases[] | select(.name=="'$TESTDB'") | .branches[] | select(.name=="'$TESTDB'/test-snapshot-only") | .port' ~/.local/share/pgd/state.json)
echo -e "${YELLOW}Snapshot-only branch (expected: 3 rows)${NC}"
psql -h localhost -p $SNAP_PORT -U postgres -d postgres -c "
  SELECT COUNT(*) as row_count FROM test_data;
"
echo ""

SNAP_COUNT=$(psql -h localhost -p $SNAP_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_data;" | xargs)

if [ "$SNAP_COUNT" = "3" ]; then
    echo -e "${GREEN}✓ Snapshot-only branch correct! Got $SNAP_COUNT rows (expected 3)${NC}"
else
    echo -e "${RED}✗ Snapshot-only branch failed! Got $SNAP_COUNT rows (expected 3)${NC}"
    exit 1
fi
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}All tests passed!${NC}"
echo -e "${BLUE}========================================${NC}"
