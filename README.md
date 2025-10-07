# BetterPG

Instant PostgreSQL database branching using ZFS snapshots. Create production-safe database copies in seconds for testing migrations, debugging, and development.

## Features

- **Instant branching**: Clone 100GB database in <5 seconds
- **Production-safe**: Application-consistent snapshots with zero data loss
- **Space-efficient**: ZFS copy-on-write (branches are ~100KB until data diverges)
- **Lifecycle management**: Start, stop, restart, sync databases and branches
- **Full isolation**: Each branch is an independent PostgreSQL instance

## Quick Start

```bash
# Initialize
bpg init

# Create database (creates database with main branch)
bpg db create prod

# Create production-safe branch (uses pg_backup_start)
bpg branch create prod/dev

# Create fast branch (for dev/test)
bpg branch create prod/test --fast

# View all databases
bpg status
```

## Requirements

- Linux with ZFS
- Docker
- Bun runtime

## Installation

```bash
# Clone repository
git clone https://github.com/elitan/betterpg.git
cd betterpg

# Build
bun install
bun run build

# Install globally
sudo cp dist/bpg /usr/local/bin/
```

## How It Works

BetterPG combines three technologies:

1. **ZFS snapshots**: Instant, space-efficient filesystem clones
2. **PostgreSQL backup mode**: Application-consistent snapshots via `pg_backup_start`/`pg_backup_stop`
3. **Docker**: Isolated PostgreSQL containers for each branch

## Usage

### Database Management

```bash
# Create a database (automatically creates <database>/main branch)
bpg db create myapp

# List all databases
bpg db list

# Get database details
bpg db get myapp

# Rename database
bpg db rename myapp myapp-v2

# Delete database and all branches
bpg db delete myapp --force
```

Creates:
- Database: `myapp`
- Main branch: `myapp/main`
- ZFS dataset: `tank/betterpg/databases/myapp-main`
- PostgreSQL container on allocated port

### Branch Management

**Production-safe (default)**:
```bash
bpg branch create prod/dev
```
- Uses `pg_backup_start`/`pg_backup_stop`
- Zero data loss guaranteed
- 2-5 seconds total time
- Safe for production data

**Fast mode (dev/test)**:
```bash
bpg branch create prod/test --fast
```
- Skips backup mode
- <1 second
- Requires WAL replay on startup
- Only for dev/test environments

**Branch from another branch**:
```bash
bpg branch create prod/feature --from prod/dev
```

**Other branch operations**:
```bash
# List all branches
bpg branch list

# List branches for specific database
bpg branch list prod

# Get branch details
bpg branch get prod/dev

# Rename branch
bpg branch rename prod/dev prod/development

# Sync branch with parent's current state
bpg branch sync prod/dev

# Delete branch
bpg branch delete prod/dev
```

### Lifecycle Commands

```bash
# Start a branch
bpg start prod/main
bpg start prod/dev

# Stop a branch
bpg stop prod/dev

# Restart a branch
bpg restart prod/dev

# View status of all databases and branches
bpg status
```

### Connection

```bash
# Get connection details from status
bpg status

# Connect to a branch
psql -h localhost -p <port> -U postgres
```

## Use Cases

### 1. Migration Testing

```bash
# Create branch of production
bpg branch create prod/migration-test

# Get port from status
bpg status

# Test migration
psql -h localhost -p <port> -f migration.sql

# If successful, apply to prod. If failed, destroy and retry
bpg branch delete prod/migration-test
```

### 2. Developer Databases

```bash
# Give developers production data
bpg branch create prod/dev-alice

# Anonymize sensitive data
psql -h localhost -p <port> <<EOF
UPDATE users SET email = CONCAT('user', id, '@example.com');
EOF
```

### 3. Debugging Production Issues

```bash
# Create exact copy of production
bpg branch create prod/debug-issue-123

# Debug with real data, zero risk
psql -h localhost -p <port>

# Clean up when done
bpg branch delete prod/debug-issue-123
```

## Architecture

```
Database: prod
├── Branch: prod/main (primary)
│   ├── ZFS Dataset: tank/betterpg/databases/prod-main
│   ├── PostgreSQL Container (port 5432)
│   ├── Snapshot 1: 2025-01-15T10:30:00
│   │   └── Branch: prod/dev (clone, port 5433)
│   └── Snapshot 2: 2025-01-15T14:45:00
│       └── Branch: prod/test (clone, port 5434)
```

Each branch:
- Independent PostgreSQL instance
- Full read-write access
- Isolated from parent
- Uses only delta storage (ZFS copy-on-write)

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Create database | 5-10s | Pull image + container start |
| Application-consistent branch | 2-5s | Uses pg_backup_start |
| Fast branch (--fast) | <1s | No backup mode |
| Sync branch | 2-3s | Re-clone from parent |
| Delete branch | <1s | Remove container + dataset |

**Space efficiency**:
- 10GB database → 100KB branch (initially)
- Storage grows only with data changes
- Example: 10GB DB, change 100MB → branch uses ~100MB

## Production Safety

### Application-Consistent Snapshots (Default)

When you run `bpg branch create prod/dev`:

1. Executes `pg_backup_start()` - puts PostgreSQL in backup mode
2. Creates ZFS snapshot (~100ms)
3. Executes `pg_backup_stop()` - ends backup mode
4. Clones snapshot and starts container

**Guarantees**:
- Zero data loss
- All committed transactions included
- Database in consistent state
- No crash recovery needed

### When to Use --fast

✅ **Use for**:
- Dev/test environments
- CI/CD pipelines
- Ephemeral branches
- When speed > consistency

❌ **Never use for**:
- Production branches
- Migration testing
- Compliance scenarios

## Configuration

Config file: `~/.config/betterpg/config.yaml`

```yaml
zfs:
  pool: tank
  datasetBase: betterpg/databases

postgres:
  image: postgres:16-alpine
  version: "16"
  config:
    shared_buffers: 256MB
    max_connections: "100"
```

State file: `~/.local/share/betterpg/state.json`

## Testing

```bash
# Run full test suite (21 tests)
./scripts/run-extended-tests.sh
```

Tests cover:
- Database lifecycle (create, start, stop, restart)
- Branch creation (application-consistent & crash-consistent)
- Data persistence across stop/start
- Branch sync functionality
- ZFS copy-on-write efficiency
- Edge cases

## Development

Built with:
- [Bun](https://bun.sh) - JavaScript runtime & build tool
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Dockerode](https://github.com/apocas/dockerode) - Docker API client
- [ZFS](https://openzfs.org/) - Filesystem with snapshots/clones

```bash
# Development
bun install
bun run build

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
| **Data in branches** | ✅ Full copy | ✅ Full copy | ⚠️ Schema only* |
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

Planned features (see [TODO.md](TODO.md) for details):

- Snapshot management (create, list, destroy manual snapshots)
- WAL archiving & point-in-time recovery
- Schema diff between branches
- Branch promotion (promote branch to main)
- Web UI dashboard

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
