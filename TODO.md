# betterpg Development TODO

## ✅ Completed (v0.1.0)

### Core Implementation
- [x] Project structure with Bun + TypeScript
- [x] ZFSManager - dataset/snapshot/clone operations
- [x] DockerManager - PostgreSQL container lifecycle
- [x] StateManager - JSON state persistence with file locking
- [x] ConfigManager - YAML configuration

### CLI Commands (Namespace-based v0.2.0)
- [x] `bpg init` - Initialize system with ZFS pool
- [x] `bpg db create <name>` - Create database with main branch
- [x] `bpg db list` - List all databases
- [x] `bpg db get <name>` - Get database details
- [x] `bpg db delete <name>` - Delete database and branches
- [x] `bpg db rename <old> <new>` - Rename database
- [x] `bpg branch create <db>/<name>` - Create branch with namespace
- [x] `bpg branch list [db]` - List branches
- [x] `bpg branch get <db>/<branch>` - Get branch details
- [x] `bpg branch delete <db>/<branch>` - Delete branch
- [x] `bpg branch rename <old> <new>` - Rename branch
- [x] `bpg start/stop/restart <db>/<branch>` - Lifecycle management
- [x] `bpg status` - Show all databases and branches
- [x] `bpg branch sync <db>/<branch>` - Sync branch with parent's current state

### Testing & Infrastructure
- [x] VPS setup script (`scripts/vps-setup.sh`)
- [x] Integration test suite (`scripts/integration-test.sh`)
- [x] Extended integration tests (`scripts/extended-integration-test.sh`)
  - 21 comprehensive tests covering all lifecycle commands
  - Tests for start, stop, restart, and status
  - Application-consistent and crash-consistent snapshot testing
  - Edge case testing
  - Data persistence verification
  - ZFS copy-on-write efficiency validation
- [x] All tests passing on Ubuntu 24.04 with ZFS
- [x] VPS environment configured at `ssh betterpg`

## 🎯 Next Priority Features

### Production-Safe Branching ✅ COMPLETE
**Goal:** Enable safe production branching for migration testing and dev databases with real data

- [x] PostgreSQL connection utilities in DockerManager
  - Added `execSQL()` method to run queries in containers
  - Handles connection errors gracefully using Bun.spawn
- [x] Application-consistent snapshots using pg_backup_start/pg_backup_stop
  - Implemented coordinated backup workflow
  - Creates ZFS snapshot while Postgres is in backup mode
  - Ensures zero data loss and consistency
  - Compatible with PostgreSQL 15+ (pg_backup_*) and < 15 (pg_start_backup)
- [x] Make consistent snapshots the default for `bpg branch`
  - `bpg branch prod dev` uses pg_backup_start by default
  - ~2-5 second operation (acceptable for production)
- [x] Add `--fast` flag for crash-consistent snapshots (dev/test only)
  - `bpg branch prod dev --fast` skips pg_backup_start
  - Faster but requires WAL replay on startup
  - Documented when to use vs avoid
- [x] Update integration tests to verify consistent snapshots
  - Added tests 8, 8a, 8b to verify both snapshot types
  - All 25 tests passing
- [ ] Document production branching best practices
  - Migration testing workflow
  - Performance impact (2-5s)
  - When to use --fast vs default

### Namespace-based CLI (v0.2.0) ✅ COMPLETE
**Goal:** Restructure CLI to use `<database>/<branch>` namespace pattern for clarity

- [x] Update data model to use namespace structure
- [x] Implement `bpg db` command group (create, list, get, delete, rename)
- [x] Implement `bpg branch` command group (create, list, get, delete, rename, sync)
- [x] Update lifecycle commands to use namespaces (start, stop, restart)
- [x] Update integration tests for namespace syntax
- [x] Create CLAUDE.md documentation
- [x] Delete old unused command files (cleanup)
- [ ] Update README.md with namespace examples

### Snapshot Management
- [ ] `bpg snapshot <name>` - Create manual snapshot
- [ ] `bpg snapshots <name>` - List all snapshots for database
- [ ] `bpg snapshot-destroy <snapshot>` - Delete snapshot
- [ ] Automatic snapshot scheduling (configurable)

### Connection & Access
- [ ] `bpg connect <name>` - Auto-connect to database with psql
- [ ] `bpg info <name>` - Show connection details
- [ ] `bpg logs <name>` - Show PostgreSQL logs
- [ ] Store credentials securely (not in state.json)

### Backup & Recovery (MEDIUM PRIORITY - For PITR)
- [ ] WAL archiving to local/S3/B2
- [ ] `bpg backup <name>` - Create base backup
- [ ] `bpg restore <name> <backup>` - Restore from backup
- [ ] Point-in-time recovery (PITR)
- [ ] Automated backup retention policies
- [ ] Branch from specific timestamp using PITR

### Branch Operations
- [ ] `bpg diff <source> <target>` - Show schema differences
- [ ] `bpg promote <branch>` - Promote branch to primary

## 🔧 Improvements & Refactoring

### Code Quality
- [ ] Add unit tests for managers
- [ ] Add error handling for edge cases
- [ ] Improve logging with proper log levels
- [ ] Add --verbose and --quiet flags
- [ ] Better error messages with suggestions

### Performance
- [ ] Parallel operations where possible
- [ ] Progress bars for long operations
- [ ] Optimize Docker image pulls (cache)
- [ ] ZFS dataset size monitoring/alerts

### Configuration
- [ ] Per-database PostgreSQL config overrides
- [ ] Custom PostgreSQL extensions support
- [ ] Template databases for new instances
- [ ] Environment-based config profiles

### Security
- [ ] Encrypt credentials at rest
- [ ] Support for external secret managers
- [ ] SSL/TLS for PostgreSQL connections
- [ ] Access control/permissions system

## 📚 Documentation

- [ ] Complete README.md with examples
- [ ] API documentation for managers
- [ ] Architecture diagram
- [ ] Tutorial: Development workflow with branches
- [ ] Tutorial: CI/CD integration
- [ ] Troubleshooting guide
- [ ] Performance tuning guide

## 🚀 Advanced Features

### Web UI
- [ ] Dashboard showing all databases/branches
- [ ] Visual branch tree
- [ ] One-click operations
- [ ] Metrics and monitoring
- [ ] SQL query interface

### CI/CD Integration
- [ ] GitHub Actions workflow examples
- [ ] GitLab CI examples
- [ ] Pre-commit hooks
- [ ] Automated testing with ephemeral branches

### Multi-node Support
- [ ] Remote ZFS pool support
- [ ] Database replication between nodes
- [ ] Load balancing
- [ ] High availability setup

### Monitoring & Observability
- [ ] Prometheus metrics export
- [ ] Grafana dashboard templates
- [ ] Alert rules for disk space/performance
- [ ] Query performance tracking

## 🐛 Known Issues

- None currently tracked

## 📝 Notes

### Testing on macOS
Since ZFS is Linux-only, development requires VPS:
1. SSH to VPS: `ssh betterpg`
2. Pull changes: `cd ~/betterpg && git pull`
3. Build: `~/.bun/bin/bun run build`
4. Test: `./scripts/integration-test.sh`

### VPS Details
- Provider: Hetzner/DigitalOcean
- OS: Ubuntu 24.04
- ZFS pool: `tank` (10GB file-backed)
- Access: `ssh betterpg`

### Current Test Results
All 21 extended integration tests passing:
- ✅ Init system
- ✅ Create database (9.32 MB)
- ✅ Database connectivity and test data
- ✅ Status command
- ✅ Stop database
- ✅ Start database with data persistence
- ✅ Restart database
- ✅ Create branch (150 KB - 63x smaller!)
- ✅ Branch data verification
- ✅ Branch data isolation
- ✅ Stop branch
- ✅ Start branch
- ✅ Idempotent start/stop operations
- ✅ Mixed running/stopped states in status
- ✅ Create second branch
- ✅ List command
- ✅ ZFS copy-on-write efficiency verification
- ✅ Destroy operations
- ✅ Edge case: Start rejects non-existent databases
- ✅ Final status check

Run tests with: `./scripts/run-extended-tests.sh`

### Production Use Cases
**Primary workflows:**
1. **Migration Testing** - Branch prod → test migration → if success apply to prod, if fail destroy and retry
2. **Dev Databases with Real Data** - Give developers prod branches, manually anonymize sensitive data after branching
3. **Multiple branches per day** - 2-5 second impact acceptable

**Key Requirements:**
- Application-consistent snapshots (pg_start_backup/pg_stop_backup)
- Full read-write branches
- Manual branch cleanup only (no auto-deletion)

### Architecture Overview
```
User → CLI (src/index.ts)
  ├─→ Commands (src/commands/)
  │    ├─→ init.ts
  │    ├─→ create.ts
  │    ├─→ branch.ts
  │    ├─→ list.ts
  │    └─→ destroy.ts
  │
  └─→ Managers (src/managers/)
       ├─→ ZFSManager (dataset/snapshot/clone ops)
       ├─→ DockerManager (PostgreSQL containers)
       ├─→ StateManager (JSON state with locking)
       └─→ ConfigManager (YAML config)
```

### File Locations
- Config: `/etc/betterpg/config.yaml`
- State: `/var/lib/betterpg/state.json`
- WAL Archive: `/var/lib/betterpg/wal-archive/`
- ZFS Base: `tank/betterpg/databases/`

---

**Last Updated:** 2025-10-06
**Version:** 0.2.0
**Status:** Namespace-based CLI complete, all 21 integration tests passing

**Next Milestone (v0.3.0):** Documentation updates and branch sync command
