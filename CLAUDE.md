# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BetterPG provides instant PostgreSQL database branching using ZFS snapshots. It combines ZFS copy-on-write, PostgreSQL backup mode, and Docker isolation to create production-safe database copies in seconds for testing migrations, debugging, and development.

**Mental Model:** Think of BetterPG like Git for databases:
- **Project** = Git repository (logical grouping of branches)
- **Branch** = Git branch (complete, isolated PostgreSQL database instance)

**Key capabilities:**
- Branch 100GB PostgreSQL database in 2-5 seconds with zero data loss
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
- Tests create temporary projects and clean up afterwards

## Architecture

### Namespace-based CLI Structure

Commands follow a hierarchical namespace pattern: `<project>/<branch>`

A **project** is a logical grouping of branches (like a Git repo), and each **branch** is a complete, isolated PostgreSQL database instance.

**Project commands** (`bpg project <command>`):
- `project create <name>` - Creates project + main branch (`<name>/main`) with PostgreSQL database
  - `--pg-version <version>` - PostgreSQL version (e.g., 17, 16) - uses `postgres:{version}-alpine`
  - `--image <image>` - Custom Docker image (e.g., `ankane/pgvector:17`, `timescale/timescaledb:latest-pg17`)
  - `--pool <name>` - ZFS pool to use (auto-detected if only one pool exists)
- `project list` - Lists all projects
- `project get <name>` - Shows project details
- `project delete <name>` - Deletes project and all branches (removes all PostgreSQL databases)

**Branch commands** (`bpg branch <command>`):
- `branch create <project>/<branch>` - Creates branch (e.g., `api/dev`) with new PostgreSQL database
  - `--from <project>/<branch>` - Create from specific branch (default: main)
  - `--pitr <timestamp>` - Create branch from point-in-time
- `branch list [project]` - Lists branches (all or for specific project)
- `branch get <project>/<branch>` - Shows branch details (port, credentials, etc.)
- `branch delete <project>/<branch>` - Deletes branch (removes PostgreSQL database)
- `branch sync <project>/<branch>` - Syncs branch with parent's current state

**Snapshot commands** (`bpg snapshot <command>`):
- `snapshot create <project>/<branch>` - Create manual snapshot
  - `--label <name>` - Optional label for snapshot
- `snapshot list [project/branch]` - List snapshots (all or for specific branch)
- `snapshot delete <snapshot-id>` - Delete snapshot
- `snapshot cleanup [project/branch]` - Clean up old snapshots
  - `--days <n>` - Retention period in days (default: 30)
  - `--dry-run` - Preview without deleting
  - `--all` - Cleanup across all branches

**WAL commands** (`bpg wal <command>`):
- `wal info [project/branch]` - Show WAL archive status (all or specific branch)
- `wal cleanup <project>/<branch>` - Clean up old WAL files
  - `--days <n>` - Remove WAL files older than n days

**Lifecycle commands** (project and branch level):
- `start <project>/<branch>` - Start a stopped branch (starts PostgreSQL container)
- `stop <project>/<branch>` - Stop a running branch (stops PostgreSQL container)
- `restart <project>/<branch>` - Restart a branch (restarts PostgreSQL container)
- `status` - Show status of all projects and branches

### Manager Classes

**StateManager** (`src/managers/state.ts`):
- Manages JSON state file at `/var/lib/betterpg/state.json`
- Implements file locking to prevent concurrent modifications
- Validates state integrity (unique names, namespaced branches, main branch exists)
- State structure: projects[] with nested branches[]
- Branch names are always namespaced: `<project>/<branch>`
- Each branch represents a complete PostgreSQL database instance

**ZFSManager** (`src/managers/zfs.ts`):
- Wraps ZFS commands using Bun's `$` shell API
- Dataset naming: `<project>-<branch>` (e.g., `api-dev`)
- All operations use `${pool}/${datasetBase}/${name}` pattern
- Key methods: `createSnapshot()`, `cloneSnapshot()`, `destroyDataset()`

**DockerManager** (`src/managers/docker.ts`):
- Uses dockerode library for Docker API
- Container naming: `bpg-<project>-<branch>` (e.g., `bpg-api-dev`)
- Each container is a complete PostgreSQL database instance
- Implements PostgreSQL backup mode: `startBackupMode()`, `stopBackupMode()`
- Compatible with PostgreSQL 15+ (`pg_backup_*`) and <15 (`pg_start_backup`)
- Uses Bun.spawn for SQL execution to avoid dockerode stream issues

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
- Manual snapshots: `bpg snapshot create <project>/<branch> --label <name>`
- List snapshots: `bpg snapshot list [branch]`
- Delete snapshots: `bpg snapshot delete <snapshot-id>`
- Snapshots stored in state.json with metadata (id, timestamp, label, size)
- Snapshots are application-consistent (use pg_backup_start/stop)

**Point-in-Time Recovery (PITR):**
- Create branch from specific time: `bpg branch create <project>/<name> --pitr <timestamp>`
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

### Snapshot Consistency

**Application-consistent snapshots (default)**: Uses CHECKPOINT
- Zero data loss, all committed transactions included
- 2-5 second operation
- Safe for production, migration testing, compliance
- Uses PostgreSQL CHECKPOINT to flush all data to disk before snapshot
- Used by: `bpg snapshot create`, `bpg branch create`

**PITR recovery**: Uses existing snapshots + WAL replay
- Recovers PostgreSQL database to specific point in time
- Uses crash-consistent snapshots (WAL replay provides consistency)
- Replays WAL logs from snapshot to target time
- Used by: `bpg branch create --pitr <timestamp>`

Implementation in `src/commands/branch/create.ts`:
1. If `--pitr`: find existing snapshot before recovery target, skip creating new one
2. If creating new snapshot and PostgreSQL container is running: call `CHECKPOINT`
3. Create ZFS snapshot (or use existing for PITR)
4. Clone snapshot to new dataset
5. If PITR: setup recovery configuration (recovery.signal + postgresql.auto.conf)
6. Create and start PostgreSQL container (WAL replay happens automatically for PITR)

### State Validation Rules

The StateManager validates:
1. Every project must have exactly one main branch (`isPrimary: true`)
2. All branch names must be namespaced: `<project>/<branch>`
3. Branch `projectName` field must match parent project `name`
4. No duplicate project or branch names
5. ZFS dataset naming follows `<project>-<branch>` pattern

### Namespace Utilities

`src/utils/namespace.ts` provides:
- `parseNamespace(name)` - Splits `<project>/<branch>` into components
- `buildNamespace(project, branch)` - Constructs `<project>/<branch>`
- `isNamespaced(name)` - Validates format
- `getMainBranch(project)` - Returns `<project>/main`

Naming validation: Only `[a-zA-Z0-9_-]+` allowed for project/branch names

## Configuration & Initialization

**No configuration file needed!** BetterPG uses sensible hardcoded defaults:
- Default PostgreSQL image: `postgres:17-alpine`
- ZFS compression: `lz4` (fast, good for databases)
- ZFS recordsize: `8k` (PostgreSQL page size)
- ZFS base dataset: `betterpg/databases`

**No init command needed!** Auto-initialization happens on first `project create`:
1. Auto-detects ZFS pool (or use `--pool` if multiple pools exist)
2. Creates base dataset and WAL archive directory
3. Initializes state.json with pool/dataset info

**Defaults location:** `src/config/defaults.ts`

## File Locations

- State: `/var/lib/betterpg/state.json` (stores pool, dataset base, projects, branches, snapshots)
- State lock: `/var/lib/betterpg/state.json.lock`
- WAL archive: `/var/lib/betterpg/wal-archive/<dataset>/`
- ZFS datasets: `<pool>/betterpg/databases/<project>-<branch>` (pool auto-detected)
- Docker containers: `bpg-<project>-<branch>` (PostgreSQL databases)

## Common Development Patterns

**Adding a new project command:**
1. Create file in `src/commands/project/`
2. Export async function: `export async function projectFooCommand(...)`
3. Import and wire in `src/index.ts` under `projectCommand`
4. Use namespace utilities to parse/validate names
5. Load state with `StateManager`, get ZFS config from `state.getState()`
6. Initialize managers: `new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase)`
7. Perform operation, save state

**Adding a new branch command:**
1. Create file in `src/commands/branch/`
2. Use `parseNamespace()` to extract project/branch from input
3. Look up project via `state.getProjectByName()`
4. Find branch in `project.branches[]` array
5. Use `project.dockerImage` when creating Docker containers
6. Perform ZFS/Docker operations using managers

**Working with ZFS:**
- Dataset names use `-` separator: `<project>-<branch>`
- Full path: `${pool}/${datasetBase}/${project}-${branch}`
- Snapshots: `${fullDatasetPath}@${timestamp}`
- Always extract dataset name from branch.zfsDataset when needed

**Working with Docker:**
- Container names use `-` separator: `bpg-<project>-<branch>`
- Each container is a complete PostgreSQL database instance
- Use `project.dockerImage` when creating containers (branches inherit from parent project)
- Always use `docker.getContainerByName()` to get container ID
- For SQL execution, use `docker.execSQL()` (not `execInContainer()`)
- Wait for health check with `docker.waitForHealthy()`
- `DockerManager.createContainer()` accepts `image` parameter (not `version`)

## Production Safety Requirements

When modifying branching logic:
1. Application-consistent snapshots (via CHECKPOINT) are always used
2. Never skip CHECKPOINT for running PostgreSQL containers
3. All snapshots are safe for production use
4. Document snapshot creation timestamps for debugging

## Known Constraints

- Linux + ZFS required (no macOS support)
- Docker must be running with socket at `/var/run/docker.sock`
- Bun runtime required (not Node.js)
- ZFS pool must exist before first `bpg project create` (auto-detected)
- Port allocation is dynamic via Docker (automatically assigns available ports)
- Credentials stored in plain text in state.json (TODO: encrypt)

## Roadmap Context

From TODO.md, completed features (v0.3.5):
- ✅ Project lifecycle (create, start, stop, restart)
- ✅ Application-consistent snapshots (CHECKPOINT)
- ✅ Namespace-based CLI structure
- ✅ Snapshot management (create, list, delete with labels)
- ✅ WAL archiving & monitoring
- ✅ Point-in-time recovery (PITR)
- ✅ Branch sync functionality
- ✅ Comprehensive test coverage (70 tests total)
- ✅ GitHub Actions CI pipeline
- ✅ **Zero-config design** - no config file, no init command, auto-detects ZFS pool
- ✅ **Custom Docker images** - support for PostgreSQL extensions (pgvector, TimescaleDB, etc.)
- ✅ **Per-project PostgreSQL versions** - projects can use different PG versions

Next priorities (v0.4.0+):
- Project and branch rename commands
- Automatic snapshot scheduling via cron
- Remote storage for WAL archives (S3/B2)
- CI/CD integration examples

## Testing Philosophy

**Test Suites (70 tests total):**
1. **Extended tests** (`scripts/run-extended-tests.sh`) - 21 tests
   - Project lifecycle (create → stop → start → restart)
   - Data persistence across stop/start cycles
   - Branch creation (both snapshot types)
   - Branch data verification and isolation
   - ZFS copy-on-write efficiency validation

2. **V1 tests** (`scripts/run-v1-tests.sh`) - 36 tests
   - Comprehensive coverage of all implemented features
   - Project, branch, snapshot, WAL commands
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
- we do not need to consider backward compaiblity