# Production-Safe Branching

BetterPG provides production-safe database branching using application-consistent snapshots. This ensures zero data loss when creating branches from production databases.

## Overview

When branching from a running PostgreSQL database, BetterPG uses PostgreSQL's backup mode (`pg_backup_start`/`pg_backup_stop`) to ensure the ZFS snapshot is application-consistent. This guarantees:

- **Zero data loss**: All committed transactions are included
- **Consistency**: Database is in a consistent state (no torn pages)
- **Instant recovery**: Branches start immediately without crash recovery

## Snapshot Modes

### Application-Consistent (Default)

```bash
bpg branch myapp-prod myapp-dev
```

**How it works:**
1. Executes `pg_backup_start()` to put PostgreSQL in backup mode
2. Creates ZFS snapshot (instant, ~100ms)
3. Executes `pg_backup_stop()` to end backup mode
4. Clones snapshot and starts branch container

**Characteristics:**
- **Total time**: 2-5 seconds
- **Safety**: Production-safe, zero data loss
- **Use for**: Production databases, migration testing, dev with real data
- **PostgreSQL state**: Fully consistent, no recovery needed on branch startup

### Crash-Consistent (Fast Mode)

```bash
bpg branch myapp-prod myapp-test --fast
```

**How it works:**
1. Creates ZFS snapshot immediately (no backup mode)
2. Clones snapshot and starts branch container
3. PostgreSQL performs crash recovery on first startup

**Characteristics:**
- **Total time**: <1 second
- **Safety**: Requires WAL replay, may lose uncommitted transactions
- **Use for**: Dev/test environments, ephemeral branches
- **PostgreSQL state**: Requires crash recovery (2-10s startup delay)

## Production Use Cases

### 1. Migration Testing

Test database migrations safely before applying to production:

```bash
# Create application-consistent branch of production
bpg branch prod migration-test

# Apply migration to branch
PGPASSWORD=$PASSWORD psql -h localhost -p 5433 -f migration.sql

# Verify migration succeeded
bpg status migration-test

# If successful, apply to prod. If failed, destroy branch and retry
bpg destroy migration-test
```

### 2. Developer Databases with Real Data

Give developers production data for debugging:

```bash
# Create branch with production data
bpg branch prod dev-alice

# Manually anonymize sensitive data
PGPASSWORD=$PASSWORD psql -h localhost -p 5433 <<EOF
UPDATE users SET email = CONCAT('user', id, '@example.com');
UPDATE users SET phone = NULL;
EOF

# Developer uses real schema/data structure without PII
```

### 3. Multiple Branches Per Day

Create/destroy branches frequently for testing:

```bash
# Morning: Test new feature
bpg branch prod feature-test
# ... test feature ...
bpg destroy feature-test

# Afternoon: Debug production issue
bpg branch prod debug-issue-123
# ... debug with production data ...
bpg destroy debug-issue-123
```

**Impact**: 2-5 seconds per branch creation is acceptable for ad-hoc workflows.

## Performance Impact

### Application-Consistent Mode (Default)

```
Total time: 2-5 seconds
  ├─ pg_backup_start():    500-1000ms
  ├─ ZFS snapshot:         50-200ms
  ├─ pg_backup_stop():     500-1000ms
  ├─ ZFS clone:            50-100ms
  └─ Container start:      2-3 seconds
```

**Production impact:**
- Negligible on database performance
- No locking of tables
- Normal queries continue during backup mode
- Safe to run multiple times per day

### Crash-Consistent Mode (--fast)

```
Total time: <1 second
  ├─ ZFS snapshot:         50-200ms
  ├─ ZFS clone:            50-100ms
  └─ Container start:      2-3 seconds
  └─ WAL replay (async):   2-10 seconds
```

## When to Use Each Mode

### Use Application-Consistent (Default)

✅ **Production databases**
- Migration testing
- Production debugging
- Customer data analysis
- Performance testing with real data

✅ **When you need guarantees**
- Zero data loss required
- Must match exact production state
- Compliance/audit requirements

### Use Crash-Consistent (--fast)

✅ **Development/Test environments**
- Local development
- CI/CD pipelines
- Automated testing
- Throwaway branches

⚠️ **Acceptable trade-offs**
- A few seconds of WAL replay on startup is fine
- Losing last few uncommitted transactions is acceptable
- Speed > consistency guarantees

❌ **Never use for**
- Production branches
- Migration testing
- Compliance/audit scenarios

## Technical Details

### PostgreSQL Backup Mode

BetterPG uses the modern PostgreSQL 15+ backup API:

```sql
-- Start backup mode (non-exclusive)
SELECT pg_backup_start('betterpg-snapshot', false);

-- Create ZFS snapshot here (outside PostgreSQL)

-- Stop backup mode
SELECT pg_backup_stop();
```

**For PostgreSQL < 15**, automatically falls back to:
```sql
SELECT pg_start_backup('betterpg-snapshot', false, false);
-- snapshot
SELECT pg_stop_backup(false);
```

### Why Non-Exclusive Mode?

- **Concurrent backups**: Multiple tools can backup simultaneously
- **Session-independent**: Works across different psql sessions (with same-session SQL execution)
- **Modern standard**: Recommended by PostgreSQL documentation

### ZFS Copy-on-Write

Branches use ZFS clone functionality:
- **Instant creation**: Metadata-only operation
- **Space efficient**: Only stores differences (delta)
- **Example**: 10GB database → 100KB branch (until data diverges)

## Troubleshooting

### Branch creation fails with "backup is not in progress"

**Cause**: PostgreSQL backup mode is session-specific, commands ran in different sessions.

**Solution**: BetterPG automatically runs both commands in same psql session. If you see this error, it's a bug - please report.

### Branch takes longer than expected

**Cause**: Large ZFS dataset or heavy I/O load.

**Check**:
```bash
# View ZFS pool performance
zpool iostat -v tank 1

# Check dataset size
zfs list -o name,used,refer tank/betterpg/databases
```

### --fast mode branch fails to start

**Cause**: Corrupt WAL or incomplete checkpoint.

**Solution**:
1. Check PostgreSQL logs: `bpg logs <branch-name>`
2. If corruption detected, destroy and recreate:
   ```bash
   bpg destroy <branch-name>
   bpg branch <source> <branch-name>  # Use default mode
   ```

## Best Practices

### 1. Always Use Default Mode for Production

```bash
# Good: Safe production branching
bpg branch prod migration-test

# Bad: Using --fast for production
bpg branch prod migration-test --fast  # ❌ Don't do this
```

### 2. Clean Up Branches Regularly

Branches accumulate storage as they diverge from parent:

```bash
# List all branches with sizes
bpg status

# Destroy unused branches
bpg destroy old-test-branch
```

### 3. Monitor ZFS Pool Space

```bash
# Check pool utilization
zpool list tank

# Alert when >80% full
# Set up monitoring/alerting
```

### 4. Test Migrations on Branches First

```bash
# Never run migrations directly on prod
# Always test on branch first

# 1. Create branch
bpg branch prod migration-test

# 2. Test migration
psql -h localhost -p <branch-port> -f migration.sql

# 3. Verify
psql -h localhost -p <branch-port> -c "SELECT version, applied_at FROM migrations;"

# 4. If success, apply to prod. If fail, destroy and retry
```

### 5. Document Branch Purpose

Keep track of active branches:

```bash
# Name branches descriptively
bpg branch prod debug-payment-issue-1234
bpg branch prod test-migration-v2.3.0
bpg branch prod dev-alice-feature-x

# Not: test1, test2, temp, etc.
```

## FAQ

### Q: Does backup mode impact production performance?

**A:** No. PostgreSQL backup mode is non-intrusive:
- No table locking
- No query blocking
- Minimal CPU/memory overhead
- Safe to run during business hours

### Q: Can I branch from a stopped database?

**A:** Yes. Stopped databases automatically use crash-consistent snapshots (same as `--fast`):

```bash
bpg stop prod
bpg branch prod test  # Automatically uses crash-consistent
bpg start prod
```

### Q: How much disk space do branches use?

**A:** Initially ~100KB (metadata only). Space grows as data diverges:

- Hour 1: ~100KB (no changes)
- After writes: Size of changed blocks only
- Example: 10GB database, change 100MB → branch uses ~100MB

### Q: Can I branch from a branch?

**A:** Not yet. Currently only primary databases can be branched. This is a planned feature.

### Q: What happens if backup mode fails?

**A:** BetterPG automatically attempts to clean up:

1. Tries to execute `pg_backup_stop()`
2. Fails gracefully with error message
3. No orphaned backup mode
4. Safe to retry branch creation

### Q: Are branches read-write?

**A:** Yes! Branches are full PostgreSQL databases:
- Complete read-write access
- Independent from parent
- Changes don't affect parent
- No sync back to parent

## Summary

| Feature | Application-Consistent (Default) | Crash-Consistent (--fast) |
|---------|----------------------------------|---------------------------|
| **Command** | `bpg branch prod dev` | `bpg branch prod dev --fast` |
| **Time** | 2-5 seconds | <1 second |
| **Data loss** | Zero | Possible (last few transactions) |
| **Consistency** | Guaranteed | Requires WAL replay |
| **Use for** | Production, migrations, debugging | Dev, test, CI/CD |
| **PostgreSQL recovery** | None needed | 2-10 seconds on startup |
| **Safety** | ✅ Production-safe | ⚠️ Dev/test only |

**Default recommendation**: Always use application-consistent mode unless speed is critical and data loss is acceptable.
