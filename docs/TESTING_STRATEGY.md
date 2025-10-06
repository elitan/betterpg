# Testing Strategy

## Testing Philosophy

BetterPG manages **critical business data**. Our testing strategy is built on these principles:

1. **Zero tolerance for data loss** - Every test must verify data integrity
2. **Prove correctness, don't assume it** - Test actual data, not just success messages
3. **Test failure modes** - Edge cases and error conditions matter most
4. **Production-realistic scenarios** - Test with real workloads and sizes

## Test Suites

### 1. Integration Tests (`scripts/extended-integration-test.sh`)

**Purpose**: Verify all features work end-to-end

**Coverage** (25 tests):
- System initialization
- Database creation and configuration
- All lifecycle commands (start, stop, restart, reset, status)
- **Snapshot modes**: Application-consistent vs crash-consistent
- Data persistence across restarts
- Branch isolation
- ZFS copy-on-write efficiency
- Edge cases (reset primary, start non-existent, etc.)

**Run**: `./scripts/run-extended-tests.sh`

**Expected**: All 25 tests pass in ~60 seconds

### 2. Data Integrity Tests (`scripts/data-integrity-test.sh`)

**Purpose**: Prove data correctness and consistency

**Critical Tests** (11 test categories):

#### Data Preservation
- **Checksum verification**: 10,000 rows with MD5 checksums must match exactly
- **Row count verification**: Every row preserved during branching
- **Large objects**: 100MB+ binary data integrity

#### Database Consistency
- **Foreign keys**: Referential integrity maintained
- **Indexes**: Unique constraints and indexes functional
- **Sequences**: AUTO_INCREMENT values correct

#### Transaction Correctness
- **Committed transactions**: All committed data in snapshot
- **Uncommitted transactions**: NOT in snapshot (ACID compliance)
- **Aggregate calculations**: SUM/COUNT/AVG match parent

#### Isolation & Independence
- **Branch isolation**: Changes in branch A don't affect branch B
- **Parent isolation**: Branch changes don't affect parent
- **Concurrent branching**: 5 simultaneous branches all identical

#### Recoverability
- **Reset correctness**: Branch reset to exact parent state
- **Corruption detection**: Checksum verification post-reset

**Run**: `sudo ./scripts/data-integrity-test.sh`

**Expected**: All tests pass with 0 data loss

### 3. Performance Tests (`scripts/performance-test.sh`)

**Purpose**: Verify performance scales with size

**Test Sizes**:
- Small: 100MB database
- Medium: 5GB database
- Large: 20GB+ database (optional, time-intensive)

**Metrics Tested**:
1. **Branching time vs size**
   - Application-consistent: Should stay <5s regardless of size
   - Crash-consistent: Should stay <1s

2. **Copy-on-write efficiency**
   - Initial branch: ~100KB
   - After 1% changes: ~1% of parent size
   - After 10% changes: ~10% of parent size

3. **Concurrent branching**
   - 5 simultaneous branches
   - Time should be <2x single branch (some lock contention)

4. **High write load**
   - Branch during active writes
   - Time should increase <50%

**Run**: `sudo ./scripts/performance-test.sh`

**Expected**: All benchmarks within acceptable ranges

## Test Matrix

| Scenario | Integration | Data Integrity | Performance |
|----------|-------------|----------------|-------------|
| **Data Loss Prevention** |
| All rows preserved | ✓ | ✓✓✓ | - |
| Checksums match | - | ✓✓✓ | - |
| Large objects intact | - | ✓✓✓ | - |
| **Consistency** |
| Foreign keys valid | ✓ | ✓✓✓ | - |
| Indexes functional | ✓ | ✓✓✓ | - |
| Sequences correct | - | ✓✓✓ | - |
| **Transaction Correctness** |
| Committed data included | ✓ | ✓✓✓ | - |
| Uncommitted data excluded | - | ✓✓✓ | - |
| **Isolation** |
| Branch independence | ✓ | ✓✓✓ | - |
| Parent unchanged | ✓ | ✓✓✓ | - |
| **Performance** |
| Branching time <5s | ✓ | - | ✓✓✓ |
| Size independence | - | - | ✓✓✓ |
| CoW efficiency | ✓ | - | ✓✓✓ |
| **Recoverability** |
| Reset works | ✓ | ✓✓✓ | - |
| Data restored | ✓ | ✓✓✓ | - |
| **Snapshot Modes** |
| App-consistent safe | ✓ | ✓ | ✓ |
| Crash-consistent fast | ✓ | ✓ | ✓ |
| **Edge Cases** |
| Error handling | ✓ | - | - |
| Invalid operations | ✓ | - | - |
| Concurrent ops | ✓ | ✓ | ✓ |

Legend: ✓ = tested, ✓✓✓ = primary focus, - = not applicable

## Critical Guarantees Verified

### 1. Zero Data Loss ✅

**What we test**:
```bash
# Before branching
CHECKSUM=$(psql -c "SELECT md5(string_agg(data)) FROM table")

# After branching
BRANCH_CHECKSUM=$(psql -p branch_port -c "SELECT md5(string_agg(data)) FROM table")

# Must be identical
assert [ "$CHECKSUM" = "$BRANCH_CHECKSUM" ]
```

**Why it matters**: Guarantees every byte is preserved

### 2. Transaction Consistency ✅

**What we test**:
```sql
-- Start transaction
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;  -- Committed = in snapshot

-- Branch now
BEGIN;
UPDATE accounts SET balance = 0 WHERE id = 1;
-- NOT committed = NOT in snapshot
```

**Why it matters**: ACID compliance verification

### 3. Referential Integrity ✅

**What we test**:
```sql
-- In parent
CREATE TABLE orders (id PRIMARY KEY);
CREATE TABLE items (order_id REFERENCES orders(id));

-- Branch

-- In branch, verify no orphans
SELECT COUNT(*) FROM items
LEFT JOIN orders ON items.order_id = orders.id
WHERE orders.id IS NULL;  -- Must be 0
```

**Why it matters**: Prevents broken relationships

### 4. Branch Isolation ✅

**What we test**:
```bash
# Modify branch 1
psql -p branch1 -c "INSERT INTO table VALUES (999)"

# Verify branch 2 unchanged
COUNT=$(psql -p branch2 -c "SELECT COUNT(*) FROM table WHERE value = 999")
assert [ "$COUNT" = "0" ]

# Verify parent unchanged
COUNT=$(psql -p parent -c "SELECT COUNT(*) FROM table WHERE value = 999")
assert [ "$COUNT" = "0" ]
```

**Why it matters**: Prevents cross-contamination

### 5. Reset Correctness ✅

**What we test**:
```bash
# Branch and modify
bpg branch prod dev
psql -p dev -c "INSERT INTO table VALUES ('corrupted')"

# Reset
bpg reset dev

# Verify exactly matches parent
PARENT_CHECKSUM=$(psql -p prod -c "SELECT md5(string_agg(data))")
DEV_CHECKSUM=$(psql -p dev -c "SELECT md5(string_agg(data))")
assert [ "$PARENT_CHECKSUM" = "$DEV_CHECKSUM" ]
```

**Why it matters**: Recoverability guarantee

## Running the Full Test Suite

```bash
# 1. Build
bun run build

# 2. Run all tests
./scripts/run-extended-tests.sh          # 25 tests, ~60s
sudo ./scripts/data-integrity-test.sh    # 11 test categories, ~90s
sudo ./scripts/performance-test.sh       # 5 scenarios, ~5-10min

# 3. Check results
# All tests must pass for release
```

## Continuous Testing

### Pre-commit
```bash
# Quick smoke test
./scripts/run-extended-tests.sh
```

### Pre-release
```bash
# Full suite
./scripts/run-extended-tests.sh
sudo ./scripts/data-integrity-test.sh
sudo ./scripts/performance-test.sh

# All must pass
```

### Production Monitoring
```bash
# Daily integrity check
bpg branch prod integrity-check
# Run queries to verify data
# Destroy when done
bpg destroy integrity-check
```

## Test Data Strategies

### Small Data (Integration Tests)
- **Size**: 10MB - 100MB
- **Purpose**: Fast feedback, all features
- **Data**: Synthetic, predictable

### Medium Data (Performance Tests)
- **Size**: 1GB - 10GB
- **Purpose**: Realistic performance
- **Data**: Generated at scale

### Large Data (Manual/Optional)
- **Size**: 100GB - 1TB
- **Purpose**: Prove scalability
- **Data**: Production-like dumps

## Test Environment

### Requirements
- Linux with ZFS
- Docker
- PostgreSQL client tools (psql)
- At least 20GB free space
- jq (JSON parsing)

### Setup
```bash
# Install dependencies
sudo apt-get install zfsutils-linux docker.io postgresql-client jq

# Create test pool
truncate -s 20G /tmp/test-pool.img
sudo zpool create tank /tmp/test-pool.img
```

## Failure Analysis

### When Tests Fail

1. **Data integrity failure** → CRITICAL
   - Do NOT release
   - Investigate root cause
   - Add regression test

2. **Performance regression** → Investigate
   - Check system resources
   - Compare with baseline
   - May be acceptable if <20% slower

3. **Edge case failure** → Fix required
   - May indicate real bug
   - Add to test matrix

## Future Test Additions

### Planned
- [ ] Multi-TB database tests (100GB, 500GB, 1TB)
- [ ] Network failure scenarios
- [ ] Disk full scenarios
- [ ] PostgreSQL version compatibility (11, 12, 13, 14, 15, 16)
- [ ] Parallel branch/destroy operations
- [ ] Memory pressure tests
- [ ] Long-running transaction tests
- [ ] Replication compatibility

### Nice to Have
- [ ] Chaos testing (random failures)
- [ ] Fuzz testing (invalid inputs)
- [ ] Load testing (1000s of branches)
- [ ] Upgrade/downgrade testing

## Test Metrics

### Coverage Goals
- **Data integrity**: 100% (zero tolerance)
- **Feature coverage**: 100% (all commands)
- **Edge cases**: 90%+ (known failure modes)
- **Performance**: Key metrics only

### Quality Bar
- All data integrity tests must pass
- All integration tests must pass
- Performance within 20% of baseline
- Zero known data loss scenarios

## Conclusion

**Our testing ensures**:
1. Zero data loss
2. Transaction consistency
3. Branch isolation
4. Recoverability
5. Performance scalability

**We prove correctness by**:
- Checksum verification
- Row-by-row comparison
- Constraint validation
- Concurrent operation testing

**Bottom line**: If tests pass, your data is safe.
