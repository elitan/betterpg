#!/bin/bash
# Integration test script for betterpg
# Run this on a Linux system with ZFS installed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Running betterpg integration tests${NC}\n"

# Build the binary
echo -e "${YELLOW}📦 Building betterpg...${NC}"
~/.bun/bin/bun run build

BPG="sudo ./dist/bpg"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"

    # Stop and remove containers
    docker ps -a | grep betterpg- | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true

    # Clean up ZFS datasets
    sudo zfs destroy -r tank/betterpg/databases 2>/dev/null || true
    sudo zfs create tank/betterpg/databases 2>/dev/null || true

    # Remove state and config
    sudo rm -rf /var/lib/betterpg/* /etc/betterpg/* 2>/dev/null || true

    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Run cleanup on exit
trap cleanup EXIT

# Test 1: Initialize
echo -e "\n${YELLOW}Test 1: Initialize betterpg${NC}"
$BPG init
if [ -f /var/lib/betterpg/state.json ] && [ -f /etc/betterpg/config.yaml ]; then
    echo -e "${GREEN}✓ Init successful${NC}"
else
    echo -e "${RED}✗ Init failed${NC}"
    exit 1
fi

# Test 2: Create project
echo -e "\n${YELLOW}Test 2: Create primary project${NC}"
$BPG create test-prod
if sudo zfs list tank/betterpg/databases/test-prod >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Project created${NC}"
else
    echo -e "${RED}✗ Project creation failed${NC}"
    exit 1
fi

# Verify container is running
if docker ps | grep -q betterpg-test-prod; then
    echo -e "${GREEN}✓ Container is running${NC}"
else
    echo -e "${RED}✗ Container not running${NC}"
    exit 1
fi

# Test 3: Connect to PostgreSQL database
echo -e "\n${YELLOW}Test 3: Verify PostgreSQL database connection${NC}"
sleep 3  # Give PostgreSQL a moment
PGPASSWORD=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].credentials.password')
PGPORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].port')

if PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL database connection successful${NC}"
else
    echo -e "${RED}✗ PostgreSQL database connection failed${NC}"
    exit 1
fi

# Test 4: Create some test data
echo -e "\n${YELLOW}Test 4: Create test data${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres <<EOF
CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);
INSERT INTO test_table (name) VALUES ('test-data-1'), ('test-data-2'), ('test-data-3');
EOF

if PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -c "SELECT COUNT(*) FROM test_table;" | grep -q "3"; then
    echo -e "${GREEN}✓ Test data created${NC}"
else
    echo -e "${RED}✗ Test data creation failed${NC}"
    exit 1
fi

# Test 5: Create branch
echo -e "\n${YELLOW}Test 5: Create branch from primary${NC}"
$BPG branch test-prod test-dev

if sudo zfs list tank/betterpg/databases/test-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Branch created${NC}"
else
    echo -e "${RED}✗ Branch creation failed${NC}"
    exit 1
fi

# Verify snapshot was created
if sudo zfs list -t snapshot | grep -q "tank/betterpg/databases/test-prod@"; then
    echo -e "${GREEN}✓ Snapshot created${NC}"
else
    echo -e "${RED}✗ Snapshot not found${NC}"
    exit 1
fi

# Test 6: Verify branch has same data
echo -e "\n${YELLOW}Test 6: Verify branch has copied data${NC}"
sleep 3
DEV_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[0].port')

if PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -c "SELECT COUNT(*) FROM test_table;" | grep -q "3"; then
    echo -e "${GREEN}✓ Branch has same data as primary${NC}"
else
    echo -e "${RED}✗ Branch data verification failed${NC}"
    exit 1
fi

# Test 7: Modify branch data (should not affect primary)
echo -e "\n${YELLOW}Test 7: Modify branch data${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -c "INSERT INTO test_table (name) VALUES ('dev-only-data');"

PROD_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PGPORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;")
DEV_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $DEV_PORT -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;")

if [ "$PROD_COUNT" -eq 3 ] && [ "$DEV_COUNT" -eq 4 ]; then
    echo -e "${GREEN}✓ Branch isolation working correctly${NC}"
else
    echo -e "${RED}✗ Branch isolation failed (prod: $PROD_COUNT, dev: $DEV_COUNT)${NC}"
    exit 1
fi

# Test 8: List projects and branches
echo -e "\n${YELLOW}Test 8: List projects and branches${NC}"
$BPG list

# Test 9: Check ZFS space efficiency
echo -e "\n${YELLOW}Test 9: Verify ZFS space efficiency${NC}"
PROD_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod)
DEV_SIZE=$(sudo zfs get -H -p -o value used tank/betterpg/databases/test-dev)

echo "Primary size: $PROD_SIZE bytes"
echo "Branch size: $DEV_SIZE bytes"

# Branch should be significantly smaller (just the delta)
if [ "$DEV_SIZE" -lt "$PROD_SIZE" ]; then
    echo -e "${GREEN}✓ Branch uses less space than primary (copy-on-write working)${NC}"
else
    echo -e "${YELLOW}⚠ Branch size similar to primary (might be expected for small datasets)${NC}"
fi

# Test 10: Destroy branch
echo -e "\n${YELLOW}Test 10: Destroy branch${NC}"
$BPG destroy test-dev

if ! sudo zfs list tank/betterpg/databases/test-dev >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Branch destroyed${NC}"
else
    echo -e "${RED}✗ Branch destroy failed${NC}"
    exit 1
fi

if ! docker ps -a | grep -q betterpg-test-dev; then
    echo -e "${GREEN}✓ Branch container removed${NC}"
else
    echo -e "${RED}✗ Branch container still exists${NC}"
    exit 1
fi

echo -e "\n${GREEN}🎉 All tests passed!${NC}\n"
