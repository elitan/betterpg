# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BetterPG provides instant PostgreSQL database branching using ZFS snapshots. It combines ZFS copy-on-write, PostgreSQL backup mode, and Docker isolation to create production-safe database copies in seconds for testing migrations, debugging, and development.

**Key capabilities:**
- Branch 100GB database in 2-5 seconds with zero data loss
- Space-efficient: branches are ~100KB initially (ZFS CoW)
- Full isolation: each branch is an independent PostgreSQL instance
- Production-safe: application-consistent snapshots via `pg_backup_start`/`pg_backup_stop`

## Build and Development Commands

```bash
# Install dependencies
bun install

# Build the CLI
bun run build

# Run directly (development)
bun run src/index.ts
# or
bun run dev

# Install globally
sudo cp dist/bpg /usr/local/bin/

# Run tests
./scripts/run-extended-tests.sh     # Extended integration tests (21 tests)
./scripts/run-v1-tests.sh           # V1 comprehensive tests (36 tests)
./scripts/run-advanced-tests.sh     # Advanced tests (13 tests)
./scripts/integration-test.sh       # Basic integration tests
./scripts/performance-test.sh       # Performance benchmarks
```

## Testing Notes

- **ZFS requirement**: Tests MUST be run on Linux with ZFS (Ubuntu 20.04+, Debian 11+)
- Development on macOS requires SSH to a VPS with ZFS installed
- VPS access: `ssh betterpg` (configured with ZFS pool `tank`)
- All tests assume a ZFS pool named `tank` exists
- Tests create temporary databases and clean up afterwards

## Architecture

### Namespace-based CLI Structure

Commands follow a hierarchical namespace pattern: `<database>/<branch>`

**Database commands** (`bpg db <command>`):
- `db create <name>` - Creates database + main branch (`<name>/main`)
- `db list` - Lists all databases
- `db get <name>` - Shows database details
- `db delete <name>` - Deletes database and all branches
- `db rename <old> <new>` - Renames database (NOT IMPLEMENTED YET)

**Branch commands** (`bpg branch <command>`):
- `branch create <db>/<branch>` - Creates branch (e.g., `api/dev`)
  - `--from <db>/<branch>` - Create from specific branch (default: main)
  - `--fast` - Use crash-consistent snapshot (skip pg_backup_start)
  - `--pitr <timestamp>` - Create branch from point-in-time
- `branch list [db]` - Lists branches (all or for specific database)
- `branch get <db>/<branch>` - Shows branch details
- `branch delete <db>/<branch>` - Deletes branch
- `branch rename <old> <new>` - Renames branch (NOT IMPLEMENTED YET)
- `branch sync <db>/<branch>` - Syncs branch with parent's current state

**Snapshot commands** (`bpg snapshot <command>`):
- `snapshot create <db>/<branch>` - Create manual snapshot
  - `--label <name>` - Optional label for snapshot
- `snapshot list [db/branch]` - List snapshots (all or for specific branch)
- `snapshot delete <snapshot-id>` - Delete snapshot

**WAL commands** (`bpg wal <command>`):
- `wal info [db/branch]` - Show WAL archive status (all or specific branch)
- `wal cleanup <db>/<branch>` - Clean up old WAL files
  - `--days <n>` - Remove WAL files older than n days

**Lifecycle commands** (database and branch level):
- `start <db>/<branch>` - Start a stopped branch
- `stop <db>/<branch>` - Stop a running branch
- `restart <db>/<branch>` - Restart a branch
- `status` - Show status of all databases and branches

### Manager Classes

**StateManager** (`src/managers/state.ts`):
- Manages JSON state file at `/var/lib/betterpg/state.json`
- Implements file locking to prevent concurrent modifications
- Validates state integrity (unique names, namespaced branches, main branch exists)
- State structure: databases[] with nested branches[]
- Branch names are always namespaced: `<database>/<branch>`

**ZFSManager** (`src/managers/zfs.ts`):
- Wraps ZFS commands using Bun's `$` shell API
- Dataset naming: `<database>-<branch>` (e.g., `api-dev`)
- All operations use `${pool}/${datasetBase}/${name}` pattern
- Key methods: `createSnapshot()`, `cloneSnapshot()`, `destroyDataset()`

**DockerManager** (`src/managers/docker.ts`):
- Uses dockerode library for Docker API
- Container naming: `bpg-<database>-<branch>` (e.g., `bpg-api-dev`)
- Implements PostgreSQL backup mode: `startBackupMode()`, `stopBackupMode()`
- Compatible with PostgreSQL 15+ (`pg_backup_*`) and <15 (`pg_start_backup`)
- Uses Bun.spawn for SQL execution to avoid dockerode stream issues

**ConfigManager** (`src/managers/config.ts`):
- Loads YAML config from `/etc/betterpg/config.yaml`
- Contains ZFS pool, PostgreSQL image version, etc.
- Note: Port allocation is handled dynamically by Docker (no port range config needed)

**WALManager** (`src/managers/wal.ts`):
- Manages Write-Ahead Log (WAL) archiving and monitoring
- WAL archive location: `/var/lib/betterpg/wal-archive/<dataset>/`
- Key methods:
  - `ensureArchiveDir()` - Creates WAL archive directory with correct permissions
  - `getArchiveInfo()` - Returns file count, total size, oldest/newest timestamps
  - `cleanupWALsBefore()` / `cleanupOldWALs()` - Remove WAL files by date
  - `verifyArchiveIntegrity()` - Check for gaps in WAL sequence
  - `setupPITRecovery()` - Configure recovery.signal and postgresql.auto.conf

### WAL Archiving & Point-in-Time Recovery (PITR)

**WAL Archiving Configuration:**
- Enabled on all PostgreSQL containers via archive_command
- WAL files archived to `/var/lib/betterpg/wal-archive/<dataset>/`
- Each branch has its own isolated WAL archive directory
- Commands: `bpg wal info [branch]`, `bpg wal cleanup <branch> --days <n>`

**Snapshot Management:**
- Manual snapshots: `bpg snapshot create <db>/<branch> --label <name>`
- List snapshots: `bpg snapshot list [branch]`
- Delete snapshots: `bpg snapshot delete <snapshot-id>`
- Snapshots stored in state.json with metadata (id, timestamp, label, size)
- Snapshots are application-consistent (use pg_backup_start/stop)

**Point-in-Time Recovery (PITR):**
- Create branch from specific time: `bpg branch create <db>/<name> --pitr <timestamp>`
- Auto-finds best snapshot BEFORE recovery target time
- Replays WAL logs from snapshot to target
- Timestamp formats: ISO 8601 ("2025-10-07T14:30:00Z") or relative ("2 hours ago")
- **Limitation:** Cannot recover to time before latest snapshot (must create snapshots regularly)

**PITR Implementation Flow:**
1. Parse recovery target timestamp
2. Find snapshots for source branch created BEFORE target
3. Select closest snapshot before target
4. Clone ZFS snapshot to new dataset
5. Write recovery.signal and postgresql.auto.conf with recovery_target_time
6. Start container - PostgreSQL replays WAL to target time
7. Database becomes available at recovered state

### Snapshot Consistency Modes

**Application-consistent (default for manual snapshots)**: Uses `pg_backup_start`/`pg_backup_stop`
- Zero data loss, all committed transactions included
- 2-5 second operation
- Safe for production, migration testing, compliance
- Used by: `bpg snapshot create`, regular branch creation

**Crash-consistent (`--fast` flag or PITR)**: Direct ZFS snapshot
- <1 second operation
- Requires WAL replay on startup
- For dev/test/CI or when WAL replay provides consistency (PITR)
- Used by: `bpg branch create --fast`, `bpg branch create --pitr`

Implementation in `src/commands/branch/create.ts`:
1. If `--pitr`: find existing snapshot, skip creating new one
2. If creating new snapshot and not `--fast`: call `pg_backup_start`
3. Create ZFS snapshot (or use existing for PITR)
4. If backup mode active: call `pg_backup_stop`
5. Clone snapshot to new dataset
6. If PITR: setup recovery configuration
7. Create and start PostgreSQL container

### State Validation Rules

The StateManager validates:
1. Every database must have exactly one main branch (`isPrimary: true`)
2. All branch names must be namespaced: `<database>/<branch>`
3. Branch `databaseName` field must match parent database `name`
4. No duplicate database or branch names
5. ZFS dataset naming follows `<database>-<branch>` pattern

### Namespace Utilities

`src/utils/namespace.ts` provides:
- `parseNamespace(name)` - Splits `<database>/<branch>` into components
- `buildNamespace(db, branch)` - Constructs `<database>/<branch>`
- `isNamespaced(name)` - Validates format
- `getMainBranch(database)` - Returns `<database>/main`

Naming validation: Only `[a-zA-Z0-9_-]+` allowed for database/branch names

## File Locations

- Config: `/etc/betterpg/config.yaml`
- State: `/var/lib/betterpg/state.json`
- State lock: `/var/lib/betterpg/state.json.lock`
- WAL archive: `/var/lib/betterpg/wal-archive/<dataset>/`
- ZFS datasets: `tank/betterpg/databases/<database>-<branch>`
- Docker containers: `bpg-<database>-<branch>`

## Common Development Patterns

**Adding a new database command:**
1. Create file in `src/commands/db/`
2. Export async function: `export async function dbFooCommand(...)`
3. Import and wire in `src/index.ts` under `dbCommand`
4. Use namespace utilities to parse/validate names
5. Load state, perform operation, save state

**Adding a new branch command:**
1. Create file in `src/commands/branch/`
2. Use `parseNamespace()` to extract database/branch from input
3. Look up database via `state.getDatabaseByName()`
4. Find branch in `database.branches[]` array
5. Perform ZFS/Docker operations using managers

**Working with ZFS:**
- Dataset names use `-` separator: `<database>-<branch>`
- Full path: `${pool}/${datasetBase}/${database}-${branch}`
- Snapshots: `${fullDatasetPath}@${timestamp}`
- Always extract dataset name from branch.zfsDataset when needed

**Working with Docker:**
- Container names use `-` separator: `bpg-<database>-<branch>`
- Always use `docker.getContainerByName()` to get container ID
- For SQL execution, use `docker.execSQL()` (not `execInContainer()`)
- Wait for health check with `docker.waitForHealthy()`

## Production Safety Requirements

When modifying branching logic:
1. Application-consistent snapshots MUST be the default
2. `--fast` flag should warn users about crash-consistency
3. Never skip backup mode for production/migration scenarios
4. Backup mode must be cleaned up even on error
5. Document LSN positions for debugging

## Known Constraints

- Linux + ZFS required (no macOS support)
- Docker must be running with socket at `/var/run/docker.sock`
- Bun runtime required (not Node.js)
- ZFS pool must exist before `bpg init`
- Port allocation is dynamic via Docker (automatically assigns available ports)
- Credentials stored in plain text in state.json (TODO: encrypt)
- Branch rename and database rename commands not yet implemented

## Roadmap Context

From TODO.md, completed features (v0.3.4):
- ✅ Database lifecycle (create, start, stop, restart)
- ✅ Application-consistent snapshots (pg_backup_start/stop)
- ✅ Namespace-based CLI structure
- ✅ Snapshot management (create, list, delete with labels)
- ✅ WAL archiving & monitoring
- ✅ Point-in-time recovery (PITR)
- ✅ Branch sync functionality
- ✅ Comprehensive test coverage (70 tests total)
- ✅ GitHub Actions CI pipeline

Next priorities (v0.4.0+):
- Automatic snapshot scheduling via cron
- Remote storage for WAL archives (S3/B2)
- CI/CD integration examples

## Testing Philosophy

**Test Suites (70 tests total):**
1. **Extended tests** (`scripts/run-extended-tests.sh`) - 21 tests
   - Database lifecycle (create → stop → start → restart)
   - Data persistence across stop/start cycles
   - Branch creation (both snapshot types)
   - Branch data verification and isolation
   - ZFS copy-on-write efficiency validation

2. **V1 tests** (`scripts/run-v1-tests.sh`) - 36 tests
   - Comprehensive coverage of all implemented features
   - Database, branch, snapshot, WAL commands
   - Edge cases and error handling

3. **Advanced tests** (`scripts/run-advanced-tests.sh`) - 13 tests
   - Branch sync functionality
   - State integrity verification
   - ZFS/Docker integration testing
   - Complete cleanup verification

**CI/CD:**
- GitHub Actions runs all 70 tests automatically
- Ubuntu 22.04 with ZFS, Docker, PostgreSQL client tools
- File-based ZFS pool for testing

Always run full test suite before committing changes to core managers.
