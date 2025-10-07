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

# Install globally
sudo cp dist/bpg /usr/local/bin/

# Run tests
./scripts/run-extended-tests.sh     # Full integration test suite (25 tests)
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
- `db rename <old> <new>` - Renames database

**Branch commands** (`bpg branch <command>`):
- `branch create <db>/<branch>` - Creates branch (e.g., `api/dev`)
- `branch list [db]` - Lists branches (all or for specific database)
- `branch get <db>/<branch>` - Shows branch details
- `branch delete <db>/<branch>` - Deletes branch
- `branch rename <old> <new>` - Renames branch
- `branch sync <db>/<branch>` - Syncs branch with parent's current state

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
- Contains ZFS pool, PostgreSQL image version, port range, etc.

### Snapshot Consistency Modes

**Application-consistent (default)**: Uses `pg_backup_start`/`pg_backup_stop`
- Zero data loss, all committed transactions included
- 2-5 second operation
- Safe for production, migration testing, compliance

**Crash-consistent (`--fast` flag)**: Direct ZFS snapshot
- <1 second operation
- Requires WAL replay on startup
- Only for dev/test/CI environments, NEVER production

Implementation in `src/commands/branch/create.ts`:
1. If not `--fast` and container running: call `pg_backup_start`
2. Create ZFS snapshot
3. If backup mode active: call `pg_backup_stop`
4. Clone snapshot to new dataset
5. Create and start PostgreSQL container

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
- Port allocation is sequential (no port reuse)
- Credentials stored in plain text in state.json (TODO: encrypt)

## Roadmap Context

From TODO.md, completed features:
- ✅ Database lifecycle (create, start, stop, restart, reset)
- ✅ Application-consistent snapshots (pg_backup_start/stop)
- ✅ Namespace-based CLI structure

In progress / next priorities:
- Snapshot management (create, list, destroy manual snapshots)
- WAL archiving & point-in-time recovery
- Schema diff between branches
- Branch promotion (branch → primary)
- Web UI dashboard

## Testing Philosophy

Integration tests (`scripts/extended-integration-test.sh`) verify:
- Database lifecycle (create → stop → start → restart)
- Data persistence across stop/start cycles
- Branch creation (both snapshot types)
- Branch data verification and isolation
- ZFS copy-on-write efficiency (branch << parent size)
- Reset branch to parent snapshot
- Edge cases (e.g., reset rejects primary databases)

Always run full test suite before committing changes to core managers.
