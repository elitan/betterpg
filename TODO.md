# betterpg Development TODO

## ✅ Completed (v0.1.0)

### Core Implementation
- [x] Project structure with Bun + TypeScript
- [x] ZFSManager - dataset/snapshot/clone operations
- [x] DockerManager - PostgreSQL container lifecycle
- [x] StateManager - JSON state persistence with file locking
- [x] ConfigManager - YAML configuration

### CLI Commands
- [x] `bpg init` - Initialize system with ZFS pool
- [x] `bpg create <name>` - Create primary PostgreSQL database
- [x] `bpg branch <source> <target>` - Create instant branch from snapshot
- [x] `bpg list` - Display all databases and branches
- [x] `bpg destroy <name>` - Remove database/branch with safety checks

### Testing & Infrastructure
- [x] VPS setup script (`scripts/vps-setup.sh`)
- [x] Integration test suite (`scripts/integration-test.sh`)
- [x] Extended integration tests (`scripts/extended-integration-test.sh`)
  - 22 comprehensive tests covering all lifecycle commands
  - Tests for start, stop, restart, reset, and status
  - Edge case testing
  - Data persistence verification
  - ZFS copy-on-write efficiency validation
- [x] All tests passing on Ubuntu 24.04 with ZFS
- [x] VPS environment configured at `ssh betterpg`

## 🎯 Next Priority Features

### Production-Safe Branching (HIGH PRIORITY)
**Goal:** Enable safe production branching for migration testing and dev databases with real data

- [ ] PostgreSQL connection utilities in DockerManager
  - Add `execSQL()` method to run queries in containers
  - Handle connection errors gracefully
- [ ] Application-consistent snapshots using pg_start_backup/pg_stop_backup
  - Implement coordinated backup workflow
  - Create ZFS snapshot while Postgres is in backup mode
  - Ensures zero data loss and consistency
- [ ] Make consistent snapshots the default for `bpg branch`
  - `bpg branch prod dev` uses pg_start_backup by default
  - 5-10 second operation (acceptable for production)
- [ ] Add `--fast` flag for crash-consistent snapshots (dev/test only)
  - `bpg branch prod dev --fast` skips pg_start_backup
  - Faster but requires WAL replay on startup
  - Document when to use vs avoid
- [ ] Update integration tests to verify consistent snapshots
- [ ] Document production branching best practices
  - Migration testing workflow
  - Performance impact (2-5s)
  - When to use --fast vs default

### Database Lifecycle Management
- [x] `bpg start <name>` - Start stopped database/branch
- [x] `bpg stop <name>` - Stop running database/branch
- [x] `bpg restart <name>` - Restart database/branch
- [x] `bpg reset <name>` - Reset branch to parent snapshot
- [x] `bpg status` - Show detailed status of all instances

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
All 22 extended integration tests passing:
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
- ✅ Reset branch to parent snapshot
- ✅ Idempotent start/stop operations
- ✅ Mixed running/stopped states in status
- ✅ Create second branch
- ✅ List command
- ✅ ZFS copy-on-write efficiency verification
- ✅ Destroy operations
- ✅ Edge case: Reset rejects primary databases
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

**Last Updated:** 2025-10-05
**Version:** 0.1.0
**Status:** All core features working, integration tests passing

**Next Milestone (v0.2.0):** Production-safe branching with pg_start_backup/pg_stop_backup
