#!/bin/bash
# Data Integrity & Correctness Tests for BetterPG
# Tests critical guarantees: no data loss, consistency, isolation, recoverability

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FAILED_TESTS=0
PASSED_TESTS=0

echo -e "${YELLOW}🔒 BetterPG Data Integrity Tests${NC}\n"

if [ ! -f "./dist/bpg" ]; then
    echo -e "${RED}✗ Binary not found. Run: bun run build${NC}"
    exit 1
fi

BPG="sudo ./dist/bpg"

# Test result tracking
test_result() {
    local test_name="$1"
    local condition="$2"

    if [ "$condition" = "0" ]; then
        echo -e "${GREEN}✓ $test_name${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗ $test_name${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

# Cleanup
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    docker ps -a | grep bpg- | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true
    zfs destroy -r tank/betterpg/databases 2>/dev/null || true
    zfs create tank/betterpg/databases 2>/dev/null || true
    rm -rf /var/lib/betterpg/* /etc/betterpg/* 2>/dev/null || true
    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

cleanup
trap cleanup EXIT

# Initialize
$BPG init > /dev/null

# Create test database
$BPG create test-db > /dev/null
PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].port')
PGPASSWORD=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].credentials.password')

echo -e "${BLUE}=== Data Integrity Tests ===${NC}\n"

# Test 1: Zero data loss during branching
echo -e "${BLUE}Test 1: Zero Data Loss During Branching${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE critical_data (
    id SERIAL PRIMARY KEY,
    checksum TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert 10,000 rows with checksums
INSERT INTO critical_data (checksum)
SELECT md5(random()::text)
FROM generate_series(1, 10000);
EOF

# Get checksum of all data
ORIGINAL_CHECKSUM=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT md5(string_agg(checksum, '' ORDER BY id)) FROM critical_data;")

# Create branch
$BPG branch test-db test-branch > /dev/null
BRANCH_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[0].port')

# Verify branch has exact same data
BRANCH_CHECKSUM=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $BRANCH_PORT -U postgres -d postgres -t -A -c \
    "SELECT md5(string_agg(checksum, '' ORDER BY id)) FROM critical_data;")

test_result "Branch data matches parent exactly" $([ "$ORIGINAL_CHECKSUM" = "$BRANCH_CHECKSUM" ] && echo 0 || echo 1)

# Test 2: Row count verification
ORIGINAL_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM critical_data;")
BRANCH_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $BRANCH_PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM critical_data;")

test_result "Branch row count matches parent ($ORIGINAL_COUNT rows)" $([ "$ORIGINAL_COUNT" = "$BRANCH_COUNT" ] && echo 0 || echo 1)

echo ""

# Test 3: Foreign key consistency
echo -e "${BLUE}Test 2: Foreign Key Consistency${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    total DECIMAL(10,2)
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    amount DECIMAL(10,2)
);

-- Insert related data
INSERT INTO orders (total) VALUES (100.00), (200.00), (300.00);
INSERT INTO order_items (order_id, amount) VALUES
    (1, 50.00), (1, 50.00),
    (2, 200.00),
    (3, 100.00), (3, 100.00), (3, 100.00);
EOF

$BPG branch test-db test-fk > /dev/null
FK_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-fk") | .port')

# Verify foreign keys are intact
FK_VIOLATIONS=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $FK_PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM order_items oi LEFT JOIN orders o ON oi.order_id = o.id WHERE o.id IS NULL;" 2>/dev/null || echo "1")

test_result "No foreign key violations in branch" $([ "$FK_VIOLATIONS" = "0" ] && echo 0 || echo 1)

# Verify computed totals match
PARENT_TOTALS=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT order_id, SUM(amount) FROM order_items GROUP BY order_id ORDER BY order_id;")
BRANCH_TOTALS=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $FK_PORT -U postgres -d postgres -t -A -c \
    "SELECT order_id, SUM(amount) FROM order_items GROUP BY order_id ORDER BY order_id;")

test_result "Aggregate calculations match parent" $([ "$PARENT_TOTALS" = "$BRANCH_TOTALS" ] && echo 0 || echo 1)

echo ""

# Test 4: Transaction consistency
echo -e "${BLUE}Test 3: Transaction Consistency${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE accounts (id SERIAL PRIMARY KEY, balance DECIMAL(10,2));
INSERT INTO accounts (balance) VALUES (1000.00), (500.00);

-- Start transaction
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
EOF

# Branch should see committed transaction
$BPG branch test-db test-txn > /dev/null
TXN_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-txn") | .port')

ACCOUNT_1=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $TXN_PORT -U postgres -d postgres -t -A -c \
    "SELECT balance FROM accounts WHERE id = 1;")
ACCOUNT_2=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $TXN_PORT -U postgres -d postgres -t -A -c \
    "SELECT balance FROM accounts WHERE id = 2;")

test_result "Transaction committed before snapshot (account 1 = 900)" $([ "$ACCOUNT_1" = "900.00" ] && echo 0 || echo 1)
test_result "Transaction committed before snapshot (account 2 = 600)" $([ "$ACCOUNT_2" = "600.00" ] && echo 0 || echo 1)

# Test uncommitted transaction is NOT in snapshot
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
BEGIN;
UPDATE accounts SET balance = 0 WHERE id = 1;
-- Don't commit, just leave transaction open
EOF

# Give transaction time to start
sleep 1

# Create branch while transaction is open
$BPG branch test-db test-uncommitted > /dev/null
UNCOMMIT_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-uncommitted") | .port')

UNCOMMIT_BALANCE=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $UNCOMMIT_PORT -U postgres -d postgres -t -A -c \
    "SELECT balance FROM accounts WHERE id = 1;")

test_result "Uncommitted transactions NOT in snapshot (balance still 900)" $([ "$UNCOMMIT_BALANCE" = "900.00" ] && echo 0 || echo 1)

# Rollback the open transaction
sudo docker exec bpg-test-db psql -U postgres -c "ROLLBACK;" 2>/dev/null || true

echo ""

# Test 5: Isolation - branches don't affect each other
echo -e "${BLUE}Test 4: Branch Isolation${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE isolation_test (id SERIAL PRIMARY KEY, value INTEGER);
INSERT INTO isolation_test (value) VALUES (1), (2), (3);
EOF

# Create two branches
$BPG branch test-db test-iso-1 > /dev/null
$BPG branch test-db test-iso-2 > /dev/null

ISO1_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-iso-1") | .port')
ISO2_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-iso-2") | .port')

# Modify branch 1
PGPASSWORD=$PGPASSWORD psql -h localhost -p $ISO1_PORT -U postgres -d postgres > /dev/null <<EOF
INSERT INTO isolation_test (value) VALUES (999);
EOF

# Verify branch 2 is unchanged
ISO2_HAS_999=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $ISO2_PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM isolation_test WHERE value = 999;")

test_result "Branch 1 changes don't affect branch 2" $([ "$ISO2_HAS_999" = "0" ] && echo 0 || echo 1)

# Verify parent is unchanged
PARENT_HAS_999=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM isolation_test WHERE value = 999;")

test_result "Branch 1 changes don't affect parent" $([ "$PARENT_HAS_999" = "0" ] && echo 0 || echo 1)

echo ""

# Test 6: Index consistency
echo -e "${BLUE}Test 5: Index Consistency${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE indexed_data (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT
);
CREATE INDEX idx_name ON indexed_data(name);

INSERT INTO indexed_data (email, name) VALUES
    ('alice@example.com', 'Alice'),
    ('bob@example.com', 'Bob'),
    ('charlie@example.com', 'Charlie');
EOF

$BPG branch test-db test-idx > /dev/null
IDX_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-idx") | .port')

# Verify unique constraint works
UNIQUE_VIOLATION=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $IDX_PORT -U postgres -d postgres 2>&1 <<EOF | grep -c "duplicate key" || echo "0"
INSERT INTO indexed_data (email, name) VALUES ('alice@example.com', 'Alice2');
EOF
)

test_result "Unique indexes enforced in branch" $([ "$UNIQUE_VIOLATION" -gt "0" ] && echo 0 || echo 1)

# Verify index is used for queries
INDEX_USED=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $IDX_PORT -U postgres -d postgres -t -A -c \
    "EXPLAIN SELECT * FROM indexed_data WHERE name = 'Alice';" | grep -c "Index Scan" || echo "0")

test_result "Indexes functional in branch" $([ "$INDEX_USED" -gt "0" ] && echo 0 || echo 1)

echo ""

# Test 7: Sequence consistency
echo -e "${BLUE}Test 6: Sequence Consistency${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE seq_test (id SERIAL PRIMARY KEY, data TEXT);
INSERT INTO seq_test (data) VALUES ('row1'), ('row2'), ('row3');
EOF

# Get current sequence value
PARENT_SEQ=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT last_value FROM seq_test_id_seq;")

$BPG branch test-db test-seq > /dev/null
SEQ_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-seq") | .port')

# Verify sequence starts at same value in branch
BRANCH_SEQ=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $SEQ_PORT -U postgres -d postgres -t -A -c \
    "SELECT last_value FROM seq_test_id_seq;")

test_result "Sequences cloned correctly (value = $PARENT_SEQ)" $([ "$PARENT_SEQ" = "$BRANCH_SEQ" ] && echo 0 || echo 1)

# Insert in both parent and branch
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null <<EOF
INSERT INTO seq_test (data) VALUES ('parent-new');
EOF

PGPASSWORD=$PGPASSWORD psql -h localhost -p $SEQ_PORT -U postgres -d postgres > /dev/null <<EOF
INSERT INTO seq_test (data) VALUES ('branch-new');
EOF

# Get new IDs
PARENT_NEW_ID=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT id FROM seq_test WHERE data = 'parent-new';")
BRANCH_NEW_ID=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $SEQ_PORT -U postgres -d postgres -t -A -c \
    "SELECT id FROM seq_test WHERE data = 'branch-new';")

test_result "Sequences diverge independently (parent=$PARENT_NEW_ID, branch=$BRANCH_NEW_ID)" \
    $([ "$PARENT_NEW_ID" = "$BRANCH_NEW_ID" ] && echo 0 || echo 1)

echo ""

# Test 8: Reset recoverability
echo -e "${BLUE}Test 7: Reset Recoverability${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE reset_test (id SERIAL PRIMARY KEY, data TEXT);
INSERT INTO reset_test (data) VALUES ('original');
EOF

$BPG branch test-db test-reset > /dev/null
RESET_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-reset") | .port')

# Modify branch
PGPASSWORD=$PGPASSWORD psql -h localhost -p $RESET_PORT -U postgres -d postgres > /dev/null <<EOF
INSERT INTO reset_test (data) VALUES ('modified'), ('corrupted');
UPDATE reset_test SET data = 'bad' WHERE data = 'original';
EOF

# Verify modifications exist
MODIFIED_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $RESET_PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM reset_test;")
test_result "Branch modified before reset (3 rows)" $([ "$MODIFIED_COUNT" = "3" ] && echo 0 || echo 1)

# Reset branch
$BPG reset test-reset > /dev/null

# Get new port (container recreated)
RESET_PORT_NEW=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-reset") | .port')

# Verify reset worked
RESET_COUNT=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $RESET_PORT_NEW -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM reset_test;")
RESET_DATA=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $RESET_PORT_NEW -U postgres -d postgres -t -A -c \
    "SELECT data FROM reset_test;")

test_result "Reset restores original data (1 row)" $([ "$RESET_COUNT" = "1" ] && echo 0 || echo 1)
test_result "Reset restores original values (data='original')" $([ "$RESET_DATA" = "original" ] && echo 0 || echo 1)

echo ""

# Test 9: Data corruption detection
echo -e "${BLUE}Test 8: Data Corruption Detection${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE checksummed (
    id SERIAL PRIMARY KEY,
    data TEXT,
    data_checksum TEXT
);

INSERT INTO checksummed (data, data_checksum)
SELECT
    repeat('x', 1000),
    md5(repeat('x', 1000))
FROM generate_series(1, 1000);
EOF

$BPG branch test-db test-corrupt > /dev/null
CORRUPT_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-corrupt") | .port')

# Verify all checksums match
CHECKSUM_FAILURES=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $CORRUPT_PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM checksummed WHERE md5(data) != data_checksum;")

test_result "No data corruption detected (0 checksum failures)" $([ "$CHECKSUM_FAILURES" = "0" ] && echo 0 || echo 1)

echo ""

# Test 10: Concurrent branching safety
echo -e "${BLUE}Test 9: Concurrent Branching Safety${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE concurrent_test (id SERIAL PRIMARY KEY, value INTEGER);
INSERT INTO concurrent_test (value) SELECT i FROM generate_series(1, 1000) i;
EOF

# Get checksum
CONCURRENT_CHECKSUM=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres -t -A -c \
    "SELECT md5(string_agg(value::text, '' ORDER BY id)) FROM concurrent_test;")

# Create 5 branches concurrently
for i in {1..5}; do
    $BPG branch test-db test-concurrent-$i > /dev/null &
done
wait

# Verify all branches have same checksum
CONCURRENT_FAILURES=0
for i in {1..5}; do
    CONC_PORT=$(cat /var/lib/betterpg/state.json | jq -r ".databases[0].branches[] | select(.name==\"test-concurrent-$i\") | .port")
    CONC_CHECKSUM=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $CONC_PORT -U postgres -d postgres -t -A -c \
        "SELECT md5(string_agg(value::text, '' ORDER BY id)) FROM concurrent_test;")

    if [ "$CONC_CHECKSUM" != "$CONCURRENT_CHECKSUM" ]; then
        CONCURRENT_FAILURES=$((CONCURRENT_FAILURES + 1))
    fi
done

test_result "All concurrent branches identical (0 failures)" $([ "$CONCURRENT_FAILURES" = "0" ] && echo 0 || echo 1)

echo ""

# Test 11: Large object (BYTEA/TEXT) integrity
echo -e "${BLUE}Test 10: Large Object Integrity${NC}"
PGPASSWORD=$PGPASSWORD psql -h localhost -p $PORT -U postgres -d postgres > /dev/null 2>&1 <<EOF
CREATE TABLE large_objects (
    id SERIAL PRIMARY KEY,
    data BYTEA,
    data_hash TEXT
);

-- Insert 100 rows with 1MB binary data each
INSERT INTO large_objects (data, data_hash)
SELECT
    decode(repeat('DEADBEEF', 262144), 'hex'),
    md5(decode(repeat('DEADBEEF', 262144), 'hex')::text)
FROM generate_series(1, 100);
EOF

$BPG branch test-db test-blob > /dev/null
BLOB_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[] | select(.name=="test-blob") | .port')

# Verify large objects are intact
BLOB_FAILURES=$(PGPASSWORD=$PGPASSWORD psql -h localhost -p $BLOB_PORT -U postgres -d postgres -t -A -c \
    "SELECT COUNT(*) FROM large_objects WHERE md5(data::text) != data_hash;")

test_result "Large objects preserved (0 hash mismatches)" $([ "$BLOB_FAILURES" = "0" ] && echo 0 || echo 1)

# Summary
echo ""
echo -e "${YELLOW}=== Test Summary ===${NC}\n"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}🎉 All data integrity tests passed!${NC}\n"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Data integrity may be compromised.${NC}\n"
    exit 1
fi
