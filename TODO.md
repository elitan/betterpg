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
- [x] All tests passing on Ubuntu 24.04 with ZFS
- [x] VPS environment configured at `ssh betterpg`

## 🎯 Next Priority Features

### Database Lifecycle Management
- [ ] `bpg start <name>` - Start stopped database/branch
- [ ] `bpg stop <name>` - Stop running database/branch
- [ ] `bpg restart <name>` - Restart database/branch
- [ ] `bpg reset <name>` - Reset branch to parent snapshot
- [ ] `bpg status` - Show detailed status of all instances

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

### Backup & Recovery
- [ ] WAL archiving to local/S3/B2
- [ ] `bpg backup <name>` - Create base backup
- [ ] `bpg restore <name> <backup>` - Restore from backup
- [ ] Point-in-time recovery (PITR)
- [ ] Automated backup retention policies

### Branch Operations
- [ ] `bpg merge <branch> <target>` - Merge branch changes back
- [ ] `bpg diff <source> <target>` - Show schema differences
- [ ] `bpg promote <branch>` - Promote branch to primary
- [ ] Branch from specific snapshot/timestamp

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
All 10 integration tests passing:
- ✅ Init system
- ✅ Create database (9.32 MB)
- ✅ Database connectivity
- ✅ Create branch (348 KB - 27x smaller!)
- ✅ Data isolation
- ✅ ZFS copy-on-write efficiency
- ✅ List command
- ✅ Destroy operations

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
