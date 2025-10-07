# BetterPG

Instant PostgreSQL database branching using ZFS snapshots. Create production-safe database copies in seconds for testing migrations, debugging, and development.

**Mental Model:** Think of BetterPG like Git for databases. A **project** is like a Git repository, and **branches** are like Git branches - each branch is a full, isolated PostgreSQL database instance.

## Features

- **Instant branching**: Clone 100GB database in 2-5 seconds
- **Production-safe**: Application-consistent snapshots with zero data loss
- **Space-efficient**: ZFS copy-on-write (branches are ~100KB until data diverges)
- **Zero config**: No config files, no init command - just start creating projects
- **Custom images**: Support for PostgreSQL extensions (pgvector, TimescaleDB, PostGIS, etc.)
- **Multi-version**: Different projects can use different PostgreSQL versions
- **Lifecycle management**: Start, stop, restart, sync databases and branches
- **Full isolation**: Each branch is an independent PostgreSQL instance
- **WAL archiving**: Continuous archiving of transaction logs
- **Point-in-time recovery (PITR)**: Restore to any point in time
- **Snapshot management**: Create, list, and manage manual snapshots

## Quick Start

```bash
# Create project (auto-detects ZFS pool, uses PostgreSQL 17 by default)
bpg project create prod

# Create application-consistent branch (uses CHECKPOINT)
bpg branch create prod/dev

# Create another branch
bpg branch create prod/test

# View all projects and branches
bpg status

# Use specific PostgreSQL version
bpg project create legacy --pg-version 14

# Use custom image with extensions
bpg project create vectordb --image ankane/pgvector:17
```

## Requirements

- Linux with ZFS (Ubuntu 20.04+, Debian 11+)
- Docker
- Bun runtime
- User must have:
  - Docker group membership (`usermod -aG docker $USER`)
  - ZFS permissions (via sudo or delegated permissions)

## Installation

### 1. Install Dependencies

```bash
# Install ZFS (Ubuntu/Debian)
sudo apt update
sudo apt install zfsutils-linux

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

### 2. Configure Permissions

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
# Or run: newgrp docker

# Note: ZFS operations currently require sudo
# Future versions will support ZFS delegation
```

### 3. Setup ZFS Pool

```bash
# Check if you have a ZFS pool
zpool list

# If you don't have one, create a pool (example with a file-based pool for testing)
sudo truncate -s 10G /tmp/zfs-pool.img
sudo zpool create tank /tmp/zfs-pool.img

# For production, use real disks:
# sudo zpool create tank /dev/sdb
```

### 4. Build and Install BetterPG

```bash
# Clone repository
git clone https://github.com/elitan/betterpg.git
cd betterpg

# Build
bun install
bun run build

# Install globally
sudo cp dist/bpg /usr/local/bin/

# That's it! No init needed - just start creating projects
bpg project create myapp
```

## How It Works

BetterPG combines three technologies:

1. **ZFS snapshots**: Instant, space-efficient filesystem clones (copy-on-write)
2. **PostgreSQL CHECKPOINT**: Application-consistent snapshots by flushing all data to disk
3. **Docker**: Isolated PostgreSQL containers for each branch with automatic port allocation
4. **WAL archiving**: Continuous archiving enables point-in-time recovery (PITR)

**The branching process:**
```
Source branch (prod/main)
    ↓
1. CHECKPOINT command (flush dirty buffers)
    ↓
2. ZFS snapshot (atomic, ~100ms)
    ↓
3. ZFS clone (instant, copy-on-write)
    ↓
4. Docker container (new PostgreSQL instance)
    ↓
New branch (prod/dev) - fully isolated
```

## Usage

### Project Management

A **project** is a logical grouping of branches, similar to how a Git repository contains multiple branches. Each branch is a complete, isolated PostgreSQL database instance.

```bash
# Create a project (automatically creates <project>/main branch with PostgreSQL 17)
bpg project create myapp

# Create project with specific PostgreSQL version
bpg project create legacy --pg-version 14

# Create project with custom image (for extensions)
bpg project create vectordb --image ankane/pgvector:17
bpg project create timeseries --image timescale/timescaledb:latest-pg17

# Specify ZFS pool (only needed if you have multiple pools)
bpg project create myapp --pool tank2

# List all projects
bpg project list

# Get project details
bpg project get myapp

# Delete project and all branches (removes all PostgreSQL databases)
bpg project delete myapp --force
```

**What happens when you create a project:**
- Auto-detects ZFS pool (or uses `--pool` if specified)
- Auto-initializes on first run (creates state.json, base dataset, WAL archive directory)
- Project record: `myapp` with chosen Docker image
- Main branch: `myapp/main` (automatically created)
- PostgreSQL container: `betterpg-myapp-main` on dynamically allocated port
- ZFS dataset: `<pool>/betterpg/databases/myapp-main`
- Credentials: auto-generated (view with `bpg status`)

**Docker Image Inheritance:**
All branches in a project inherit the parent project's Docker image. If you create a project with `--image ankane/pgvector:17`, all branches will use that image with pgvector extension.

**Note:** Project and branch rename commands are not yet implemented.

### Branch Management

**Create branch (application-consistent):**
```bash
# Create branch from main (default)
bpg branch create prod/dev

# Create branch from specific parent
bpg branch create prod/feature --from prod/dev
```

**How application-consistent snapshots work:**
1. Runs `CHECKPOINT` command to flush all data to disk
2. Creates instant ZFS snapshot (~100ms)
3. Clones snapshot and starts new PostgreSQL container
4. **Result:** Zero data loss, all committed transactions included

**Branch operations:**
```bash
# List all branches
bpg branch list

# List branches for specific project
bpg branch list prod

# Get branch details (shows port, status, size)
bpg branch get prod/dev

# Sync branch with parent's current state
bpg branch sync prod/dev

# Delete branch
bpg branch delete prod/dev
```

**Note:** Branch rename is not yet implemented.

### Snapshot Management

Manual snapshots enable point-in-time recovery (PITR). Create regular snapshots to define your recovery window.

```bash
# Create snapshot with optional label
bpg snapshot create prod/main --label "before-migration"

# List all snapshots
bpg snapshot list

# List snapshots for specific branch
bpg snapshot list prod/main

# Delete snapshot by ID
bpg snapshot delete <snapshot-id>

# Clean up old snapshots (keeps last 30 days by default)
bpg snapshot cleanup prod/main --days 30
bpg snapshot cleanup --all --days 30  # Cleanup across all branches

# Dry run to preview cleanup
bpg snapshot cleanup prod/main --days 30 --dry-run
```

**Best practice:** Create snapshots regularly (e.g., via cron) to enable fine-grained PITR.

### Point-in-Time Recovery (PITR)

Recover your PostgreSQL database to any specific point in time by replaying WAL logs from the nearest snapshot.

```bash
# Recover to specific timestamp (ISO 8601)
bpg branch create prod/recovered --pitr "2025-10-07T14:30:00Z"

# Recover using relative time
bpg branch create prod/recovered --pitr "2 hours ago"

# Optionally specify source branch
bpg branch create prod/recovered --from prod/dev --pitr "1 hour ago"
```

**How PITR works:**
1. Automatically finds the closest snapshot **before** your recovery target
2. Clones that snapshot to a new ZFS dataset
3. PostgreSQL replays WAL logs from snapshot time to your target time
4. New branch becomes available at the recovered state

**Requirements:**
- Recovery target must be **after** an existing snapshot
- WAL archiving is automatic for all branches
- Create regular snapshots to enable fine-grained recovery (the more snapshots, the better)

**Limitation:** Cannot recover to a time before the latest snapshot. Solution: Create snapshots regularly via cron.

### WAL Archive Management

WAL (Write-Ahead Log) archiving is automatically enabled for all branches. Monitor and clean up WAL files to manage disk usage.

```bash
# View WAL archive info for all branches (shows file count, size, age)
bpg wal info

# View WAL archive info for specific branch
bpg wal info prod/main

# Clean up old WAL files (default: 7 days)
bpg wal cleanup prod/main --days 7

# Dry run to preview cleanup
bpg wal cleanup prod/main --days 7 --dry-run
```

**Note:** WAL files are stored at `~/.local/share/betterpg/wal-archive/<dataset>/`

### Lifecycle Commands

```bash
# View status of all projects and branches (shows port, status, size)
bpg status

# Start a stopped branch
bpg start prod/dev

# Stop a running branch
bpg stop prod/dev

# Restart a branch
bpg restart prod/dev
```

### Connection

```bash
# Get connection details from status command
bpg status

# Example output shows:
# - Host: localhost
# - Port: (dynamically allocated by Docker)
# - Database name
# - Username/password

# Connect using psql
psql -h localhost -p <port> -U <username> -d <database>

# Or use connection string from status output
psql postgresql://<username>:<password>@localhost:<port>/<database>
```

## Use Cases

### 1. Migration Testing (Most Common)

Test migrations on production data before applying to prod. This is BetterPG's primary use case.

```bash
# 1. Create snapshot of production before migration
bpg snapshot create prod/main --label "before-migration-v2.3"

# 2. Create test branch
bpg branch create prod/migration-test

# 3. Get connection details
bpg status

# 4. Run migration on test branch
psql -h localhost -p <port> -U <username> -d <database> -f migrations/v2.3.sql

# 5. Verify migration success
psql -h localhost -p <port> -U <username> -d <database> -c "SELECT * FROM schema_version;"

# 6. If successful, apply to production
# If failed, delete branch and fix migration
bpg branch delete prod/migration-test

# 7. Apply successful migration to production
psql -h localhost -p <prod-port> -U <username> -d <database> -f migrations/v2.3.sql

# 8. If production migration fails, recover using PITR
bpg branch create prod/recovered --pitr "before-migration-v2.3"
```

**Benefits:**
- Zero risk to production (test on exact copy)
- Catch migration errors before production
- Fast rollback via PITR if production migration fails
- Test with real data volume and constraints

### 2. Developer Databases with Real Data

Give developers production data copies for realistic development and debugging.

```bash
# Create snapshot once
bpg snapshot create prod/main --label "weekly-dev-refresh"

# Create branch for each developer
bpg branch create prod/dev-alice --from prod/main
bpg branch create prod/dev-bob --from prod/main

# Get connection info
bpg status

# Anonymize sensitive data (run once per branch)
psql -h localhost -p <port> -U <username> -d <database> <<EOF
UPDATE users SET
  email = CONCAT('user', id, '@example.com'),
  phone = NULL,
  ssn = NULL;
UPDATE credit_cards SET number = '4111111111111111';
EOF

# Developers work with realistic data
# When done, delete branches to reclaim space
bpg branch delete prod/dev-alice
```

**Benefits:**
- Developers test with real data volumes and distributions
- Find edge cases that don't exist in test fixtures
- Each dev has isolated environment (can't break each other's data)

### 3. Debugging Production Issues

```bash
# Create exact copy of production
bpg branch create prod/debug-issue-123

# Get connection info
bpg status

# Debug with real data, zero risk
psql -h localhost -p <port> -U postgres

# Clean up when done
bpg branch delete prod/debug-issue-123
```

### 4. Point-in-Time Recovery (Incident Response)

```bash
# 1. Create regular snapshots (ideally via cron)
bpg snapshot create prod/main --label "daily-backup-$(date +%Y%m%d)"

# 2. After incident, recover to point before incident
bpg branch create prod/before-incident --pitr "2025-10-07T14:30:00Z"

# 3. Verify recovered data
bpg status  # Get connection details
psql -h localhost -p <port> -U <username> -d <database>

# 4. Query to verify data integrity
# SELECT * FROM critical_table WHERE updated_at < '2025-10-07 14:30:00';

# 5. If data is good, can restore to production manually
# Or keep branch for investigation
```

**Recovery time:** Depends on WAL replay duration (typically minutes for hours of WAL).

## Architecture

### Data Model

Think of a **project** like a Git repository and **branches** like Git branches. Each branch contains a complete, isolated PostgreSQL database.

```
Project: prod (dockerImage: postgres:17-alpine)
├── Branch: prod/main (primary)
│   ├── PostgreSQL Database: betterpg-prod-main (Docker container with postgres:17-alpine)
│   ├── ZFS Dataset: tank/betterpg/databases/prod-main
│   ├── Docker Container: betterpg-prod-main (port: dynamic)
│   ├── WAL Archive: ~/.local/share/betterpg/wal-archive/prod-main/
│   ├── Snapshot 1: 2025-01-15T10:30:00 (label: before-migration)
│   │   └── Branch: prod/dev (inherits postgres:17-alpine)
│   └── Snapshot 2: 2025-01-15T14:45:00 (label: daily-backup)
│       └── Branch: prod/test (inherits postgres:17-alpine)

Project: vectordb (dockerImage: ankane/pgvector:17)
└── Branch: vectordb/main (primary with pgvector extension)
    └── All branches inherit ankane/pgvector:17
```

### Branch Characteristics

Each branch is a complete, isolated PostgreSQL database with:
- **Independent PostgreSQL instance** - Full isolation from other branches
- **Full read-write access** - Not read-only replicas
- **Space-efficient** - Uses ZFS copy-on-write (initially ~100KB)
- **Network isolated** - Different port per branch
- **WAL-enabled** - Continuous archiving for PITR

### Namespace Structure

All resources use `<project>/<branch>` namespace format:
- Branch names: `prod/main`, `prod/dev`, `api/staging`
- ZFS datasets: `prod-main`, `prod-dev` (using `-` separator)
- Docker containers: `betterpg-prod-main`, `betterpg-prod-dev` (PostgreSQL databases)
- WAL archives: `~/.local/share/betterpg/wal-archive/prod-main/`

## Performance

### Operation Timings

| Operation | Time | Notes |
|-----------|------|-------|
| Create database | 5-15s | First run: pull PostgreSQL image (~2GB)<br>Subsequent: 5-10s (container start + init) |
| Create branch | 2-5s | CHECKPOINT (1-3s) + ZFS snapshot (~100ms) + clone + container start |
| Branch sync | 2-5s | Re-snapshot parent + clone + restart |
| PITR recovery | 1-10min | Depends on WAL replay duration (GB of WAL) |
| Delete branch | 1-2s | Stop container + remove dataset |
| Stop/Start | 5-10s | Container lifecycle |

### Space Efficiency

ZFS copy-on-write provides extreme space efficiency:

| Scenario | Storage Used |
|----------|--------------|
| 10GB database + new branch | ~10GB + 100KB |
| 10GB database + branch with 100MB changes | ~10.1GB total |
| 10GB database + 5 branches (minimal changes) | ~10GB + 500KB |

**Key insight:** Branches share unchanged blocks with parent, only divergent data uses additional space.

## Production Safety

### Application-Consistent Snapshots (Default)

BetterPG uses **application-consistent snapshots** by default, making it safe for production use.

**How it works:**
1. Executes `CHECKPOINT` command - PostgreSQL flushes all dirty buffers to disk
2. Creates instant ZFS snapshot (~100ms)
3. Clones snapshot to new ZFS dataset
4. Starts new PostgreSQL container

**Guarantees:**
- ✅ **Zero data loss** - All committed transactions included
- ✅ **Crash-safe** - No recovery needed on startup
- ✅ **Consistent state** - All foreign keys, constraints valid
- ✅ **Production-ready** - Safe to clone production databases

**Performance impact:** 2-5 seconds total (acceptable for production workflows)

### When to Create Branches

**Safe for production:**
- ✅ Migration testing (test migration on production copy)
- ✅ Developer environments (give devs real data)
- ✅ Debugging production issues
- ✅ Pre-deployment validation
- ✅ Multiple branches per day

**Not recommended:**
- ❌ Per-request branching (too slow, use connection pooling instead)
- ❌ Thousands of branches (ZFS overhead, use traditional backups)

### Best Practices

1. **Regular snapshots for PITR:** Create daily/hourly snapshots via cron (see below)
2. **Branch cleanup:** Delete branches after use to reclaim space
3. **Monitor disk usage:** WAL archives and snapshots accumulate over time
4. **Test recovery:** Regularly verify PITR works (create test branch with `--pitr`)
5. **Secure credentials:** State file contains plaintext passwords (TODO: encryption)

### Automated Snapshot Scheduling (Recommended)

Create regular snapshots using cron to enable fine-grained PITR:

```bash
# Edit crontab
crontab -e

# Add these lines for automated snapshots:

# Hourly snapshots during business hours (9 AM - 5 PM, Mon-Fri)
0 9-17 * * 1-5 /usr/local/bin/bpg snapshot create prod/main --label "hourly-$(date +\%Y\%m\%d-\%H00)"

# Daily snapshots at 2 AM
0 2 * * * /usr/local/bin/bpg snapshot create prod/main --label "daily-$(date +\%Y\%m\%d)"

# Weekly cleanup: delete snapshots older than 30 days
0 3 * * 0 /usr/local/bin/bpg snapshot cleanup --all --days 30

# Weekly WAL cleanup: delete WAL files older than 7 days
0 4 * * 0 /usr/local/bin/bpg wal cleanup prod/main --days 7
```

**Recommendation:** Adjust snapshot frequency based on your recovery point objective (RPO). More snapshots = finer recovery granularity but more storage.

## Configuration

**Zero-config design** - No configuration file needed! BetterPG uses sensible hardcoded defaults:

- **PostgreSQL image**: `postgres:17-alpine` (override with `--pg-version` or `--image`)
- **ZFS compression**: `lz4` (fast, good for databases)
- **ZFS recordsize**: `8k` (PostgreSQL page size)
- **ZFS pool**: Auto-detected (or use `--pool` if you have multiple pools)
- **Ports**: Dynamically allocated by Docker
- **Credentials**: Auto-generated passwords (view with `bpg branch get`)

Auto-initialization happens on first `bpg project create`:
1. Detects ZFS pool (or prompts if multiple exist)
2. Creates base dataset (`<pool>/betterpg/databases`)
3. Initializes state.json with pool/dataset info
4. Creates WAL archive directory

**File locations:**
- State: `~/.local/share/betterpg/state.json` (tracks projects, branches, snapshots)
- State lock: `~/.local/share/betterpg/state.json.lock` (prevents concurrent modifications)
- WAL archive: `~/.local/share/betterpg/wal-archive/<dataset>/`
- ZFS datasets: `<pool>/betterpg/databases/<project>-<branch>`
- Docker containers: `betterpg-<project>-<branch>` (PostgreSQL databases)

## Testing

```bash
# Run all test suites (68 tests total)
./scripts/run-extended-tests.sh     # Extended tests (20 tests)
./scripts/run-v1-tests.sh           # V1 comprehensive tests (35 tests)
./scripts/run-advanced-tests.sh     # Advanced tests (13 tests)

# Individual test suites
./scripts/integration-test.sh       # Basic integration tests
./scripts/performance-test.sh       # Performance benchmarks
```

**Test Coverage (70 tests):**
- Project lifecycle (create, start, stop, restart)
- Branch creation (application-consistent & crash-consistent)
- Data persistence across stop/start
- Branch sync functionality
- ZFS copy-on-write efficiency
- Snapshot management (create, list, delete)
- WAL archiving and cleanup
- Point-in-time recovery (PITR)
- Edge cases and error handling
- State integrity verification

**CI/CD:**
- GitHub Actions runs all 70 tests automatically on push/PR
- Ubuntu 22.04 with ZFS, Docker, PostgreSQL client tools

## Development

Built with:
- [Bun](https://bun.sh) - JavaScript runtime & build tool
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Dockerode](https://github.com/apocas/dockerode) - Docker API client
- [ZFS](https://openzfs.org/) - Filesystem with snapshots/clones

```bash
# Install dependencies
bun install

# Build the CLI
bun run build

# Run in development mode
bun run dev

# Install globally
sudo cp dist/bpg /usr/local/bin/

# Run tests
./scripts/run-extended-tests.sh
```

## Requirements

- **Linux**: Ubuntu 20.04+, Debian 11+, or similar
- **ZFS**: OpenZFS 2.0+
- **Docker**: 20.10+
- **Bun**: 1.0+

### Setup ZFS (Ubuntu/Debian)

```bash
# Install ZFS
sudo apt-get install zfsutils-linux

# Create pool (example: 10GB file-backed pool for testing)
truncate -s 10G /tmp/zfs-pool.img
sudo zpool create tank /tmp/zfs-pool.img

# Or use a real disk
sudo zpool create tank /dev/sdb
```

## Why BetterPG?

### vs Neon / Supabase

| Feature | BetterPG | Neon | Supabase |
|---------|----------|------|----------|
| **Branch creation** | 2-5 seconds | <1 second | Minutes-hours |
| **Query latency** | 1-5ms (local) | 3-15ms (network) | 1-5ms |
| **Storage** | ZFS copy-on-write | Page-level CoW | Full duplication |
| **Cost (100GB + 3 branches)** | $200-500/month (hardware) | $170-190/month | $100-400/month |
| **Data in branches** | ✅ Full PostgreSQL copy | ✅ Full copy | ⚠️ Schema only* |
| **Geographic distribution** | ❌ Single server | ✅ Multi-region | ✅ Multi-region |
| **Vendor lock-in** | ✅ None | ❌ Proprietary storage | ⚠️ Supabase ecosystem |

\* Supabase requires manual seed scripts for data

**BetterPG is optimal for:**
- Single-region deployments (majority of apps)
- Performance-critical workloads (zero network latency)
- Cost-sensitive projects (no cloud fees)
- Full control over infrastructure
- Production data testing workflows

**Choose cloud alternatives if you need:**
- Multi-region failover
- Scale-to-zero compute
- Managed infrastructure

## Roadmap

**Completed (v0.3.4):**
- ✅ Snapshot management (create, list, delete with labels)
- ✅ WAL archiving & monitoring
- ✅ Point-in-time recovery (PITR)
- ✅ Project lifecycle commands (start, stop, restart)
- ✅ Namespace-based CLI structure
- ✅ Branch sync functionality
- ✅ Comprehensive test coverage (70 tests)
- ✅ GitHub Actions CI pipeline

**Planned features (v0.4.0+)** - see [TODO.md](TODO.md) for details:
- Project and branch rename commands
- Automatic snapshot scheduling via cron
- Remote storage for WAL archives (S3/B2)
- Schema diff between branches
- Branch promotion (promote branch to main)
- Web UI dashboard
- CI/CD integration examples

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request

## License

MIT

## Credits

Created by [Johan Eliasson](https://github.com/elitan)

Built with [Claude Code](https://claude.com/claude-code)
