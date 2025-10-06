# BetterPG

Instant PostgreSQL database branching using ZFS snapshots. Create production-safe database copies in seconds for testing migrations, debugging, and development.

## Features

- **Instant branching**: Clone 100GB database in <5 seconds
- **Production-safe**: Application-consistent snapshots with zero data loss
- **Space-efficient**: ZFS copy-on-write (branches are ~100KB until data diverges)
- **Lifecycle management**: Start, stop, restart, reset databases and branches
- **Full isolation**: Each branch is an independent PostgreSQL instance

## Quick Start

```bash
# Initialize
bpg init

# Create primary database
bpg create prod

# Create production-safe branch (uses pg_backup_start)
bpg branch prod dev

# Create fast branch (for dev/test)
bpg branch prod test --fast

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

### Create Database

```bash
bpg create myapp-prod
```

Creates:
- ZFS dataset: `tank/betterpg/databases/myapp-prod`
- PostgreSQL container on random port
- Full read-write access

### Branch Database

**Production-safe (default)**:
```bash
bpg branch prod dev
```
- Uses `pg_backup_start`/`pg_backup_stop`
- Zero data loss guaranteed
- 2-5 seconds total time

**Fast mode (dev/test)**:
```bash
bpg branch prod test --fast
```
- Skips backup mode
- <1 second
- Requires WAL replay on startup

### Lifecycle Commands

```bash
bpg list          # List all databases and branches
bpg status        # Detailed status with sizes and uptime
bpg stop dev      # Stop database/branch
bpg start dev     # Start database/branch
bpg restart dev   # Restart database/branch
bpg reset dev     # Reset branch to parent snapshot
bpg destroy dev   # Delete database/branch
```

### Connection

```bash
# Get connection details
bpg status myapp-dev

# Connect
psql -h localhost -p <port> -U postgres
```

## Use Cases

### 1. Migration Testing

```bash
# Create branch of production
bpg branch prod migration-test

# Test migration
psql -h localhost -p <port> -f migration.sql

# If successful, apply to prod. If failed, destroy and retry
bpg destroy migration-test
```

### 2. Developer Databases

```bash
# Give developers production data
bpg branch prod dev-alice

# Anonymize sensitive data
psql -h localhost -p <port> <<EOF
UPDATE users SET email = CONCAT('user', id, '@example.com');
EOF
```

### 3. Debugging Production Issues

```bash
# Create exact copy of production
bpg branch prod debug-issue-123

# Debug with real data, zero risk
psql -h localhost -p <port>

# Clean up when done
bpg destroy debug-issue-123
```

## Architecture

```
Primary Database
├── ZFS Dataset: tank/betterpg/databases/prod
├── PostgreSQL Container (port 5432)
├── Snapshot 1: 2025-01-15T10:30:00
│   └── Branch: dev (clone, port 5433)
└── Snapshot 2: 2025-01-15T14:45:00
    └── Branch: test (clone, port 5434)
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
| Reset branch | 2-3s | Destroy + re-clone |
| Destroy | <1s | Remove container + dataset |

**Space efficiency**:
- 10GB database → 100KB branch (initially)
- Storage grows only with data changes
- Example: 10GB DB, change 100MB → branch uses ~100MB

## Production Safety

### Application-Consistent Snapshots (Default)

When you run `bpg branch prod dev`:

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

Config file: `/etc/betterpg/config.yaml`

```yaml
zfs:
  pool: tank
  datasetBase: tank/betterpg/databases

postgres:
  image: postgres:16-alpine
  version: "16"
  config:
    shared_buffers: 256MB
    max_connections: "100"
```

State file: `/var/lib/betterpg/state.json`

## Testing

```bash
# Run full test suite (25 tests)
./scripts/run-extended-tests.sh
```

Tests cover:
- Database lifecycle (create, start, stop, restart)
- Branch creation (application-consistent & crash-consistent)
- Data persistence across stop/start
- Branch reset functionality
- ZFS copy-on-write efficiency
- Edge cases

## Documentation

- [Production Branching Guide](docs/PRODUCTION_BRANCHING.md) - Detailed usage, best practices, troubleshooting

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

# Lint
bun run lint
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

## Roadmap

See [TODO.md](TODO.md) for planned features:

- [ ] Snapshot management (create, list, destroy)
- [ ] WAL archiving & point-in-time recovery
- [ ] Schema diff between branches
- [ ] Branch promotion (branch → primary)
- [ ] Web UI dashboard

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
