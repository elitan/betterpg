# pgd

**Instant branching for Postgres**

Clone 100GB database in 2-5 seconds. Production-safe. Zero data loss.

```bash
# Create project with PostgreSQL 17
pgd project create prod

# Branch in 2-5 seconds (full database copy)
pgd branch create prod/dev

# Each branch is a complete, isolated PostgreSQL instance
pgd status
```

**Git for databases:** Project = repository, Branch = complete PostgreSQL database (~100KB via ZFS copy-on-write)

## Why pgd?

| pgd | Neon | Supabase |
|-----|------|----------|
| 2-5s branch creation | <1s | Minutes-hours |
| 1-5ms latency (local) | 3-15ms (network) | 1-5ms |
| ~100KB per branch (ZFS CoW) | Page-level CoW | Full duplication |
| Full data in branches | Full data | Schema only* |
| No vendor lock-in | Proprietary storage | Supabase ecosystem |

\* Supabase requires manual seed scripts

**Use pgd if you need:** local performance, production data testing, full control, zero cloud fees
**Use cloud if you need:** multi-region, scale-to-zero, managed infrastructure

## Installation

**Requirements:** Linux + ZFS + Docker + Bun

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt install zfsutils-linux
curl -fsSL https://get.docker.com | sh
curl -fsSL https://bun.sh/install | bash

# Add user to docker group
sudo usermod -aG docker $USER && newgrp docker

# Create ZFS pool (if you don't have one)
zpool list  # Check existing pools
# For testing: sudo truncate -s 10G /tmp/zfs-pool.img && sudo zpool create tank /tmp/zfs-pool.img
# For production: sudo zpool create tank /dev/sdb

# Install pgd
git clone https://github.com/elitan/pgd.git && cd pgd
bun install && bun run build
sudo cp dist/pgd /usr/local/bin/

# Setup permissions (one-time, required before first use)
sudo ./scripts/setup-permissions.sh

# Start using (no init needed - auto-configures on first use)
pgd project create myapp
```

<details>
<summary>Detailed setup & permissions</summary>

**Permission setup** (one-time, required before first use):
```bash
sudo ./scripts/setup-permissions.sh
```

This script:
1. Auto-detects ZFS pool (or prompts if multiple exist)
2. Grants ZFS delegation permissions (90% of operations run without sudo)
3. Creates `pgd` group and adds current user
4. Installs minimal sudoers config for mount/unmount operations only
5. Validates setup with comprehensive checks

**Security model:**
- 90% of ZFS operations use delegation (no sudo)
- Only mount/unmount require sudo (Linux kernel CAP_SYS_ADMIN requirement)
- Sudo restricted to `/sbin/zfs` commands only
- See `docs/SUDO-SECURITY.md` for security analysis

**Docker permissions:**
```bash
sudo usermod -aG docker $USER
# Log out and back in, or run: newgrp docker
```

**ZFS pool options:**
```bash
# File-backed pool (testing)
sudo truncate -s 10G /tmp/zfs-pool.img
sudo zpool create tank /tmp/zfs-pool.img

# Real disk (production)
sudo zpool create tank /dev/sdb

# Multiple disks (RAID)
sudo zpool create tank mirror /dev/sdb /dev/sdc
```
</details>

## Core Concepts

**Project** = Git repository (logical grouping)
**Branch** = Complete PostgreSQL database instance (isolated, full read-write)

```
Project: prod (postgres:17-alpine)
├── prod/main        → PostgreSQL on port 32771 (primary)
├── prod/dev         → PostgreSQL on port 32772 (~100KB via ZFS CoW)
└── prod/test        → PostgreSQL on port 32773 (~100KB via ZFS CoW)

Project: vectordb (ankane/pgvector:17)
└── vectordb/main    → PostgreSQL with pgvector extension
```

**Space efficiency:** Branches share unchanged data blocks, only divergent data uses additional space

| Scenario | Storage |
|----------|---------|
| 10GB database + new branch | 10GB + 100KB |
| 10GB database + 5 branches (minimal changes) | 10GB + 500KB |

### 1. Migration Testing (Primary Use Case)

Test migrations on production data before applying to prod.

```bash
# Snapshot production before migration
pgd snapshot create prod/main --label "before-migration-v2.3"

# Create test branch (2-5 seconds)
pgd branch create prod/migration-test

# Run migration on test branch
pgd status  # Get connection details
psql -h localhost -p <port> -U postgres -d postgres -f migrations/v2.3.sql

# Verify success, then apply to production
# If it fails, delete branch and fix migration
pgd branch delete prod/migration-test

# If production migration fails, recover via PITR
pgd branch create prod/recovered --pitr "before-migration-v2.3"
```

**Benefits:** Zero risk to production, catch errors before prod, fast rollback via PITR

### 2. Dev Environments with Real Data

Give developers production data copies for realistic development.

```bash
# Create branch per developer (2-5 seconds each)
pgd branch create prod/dev-alice
pgd branch create prod/dev-bob

# Get connection info
pgd status

# Anonymize sensitive data (run once per branch)
psql -h localhost -p <port> -U postgres <<EOF
UPDATE users SET email = CONCAT('user', id, '@example.com'), phone = NULL;
UPDATE credit_cards SET number = '4111111111111111';
EOF
```

**Benefits:** Real data volumes, find edge cases, isolated environments

### 3. Debug Production Issues

```bash
# Create exact copy of production (2-5 seconds)
pgd branch create prod/debug-issue-123

# Debug with real data, zero risk
pgd status  # Get connection details
psql -h localhost -p <port> -U postgres

# Clean up when done
pgd branch delete prod/debug-issue-123
```

### 4. Point-in-Time Recovery

Recover database to specific point in time (requires regular snapshots).

```bash
# Create regular snapshots (automate via cron)
pgd snapshot create prod/main --label "daily-$(date +%Y%m%d)"

# After incident, recover to point before incident
pgd branch create prod/before-incident --pitr "2025-10-07T14:30:00Z"
# Or relative: --pitr "2 hours ago"

# Verify recovered data
pgd status  # Get connection details
psql -h localhost -p <port> -U postgres
```

**Recovery time:** Depends on WAL replay (typically minutes for hours of WAL)

## How It Works

**4-step process:**
```
Source branch (prod/main)
    ↓
1. CHECKPOINT (flush dirty buffers to disk)
    ↓
2. ZFS snapshot (atomic, ~100ms)
    ↓
3. ZFS clone (instant, copy-on-write)
    ↓
4. Docker container (new PostgreSQL instance)
    ↓
New branch (prod/dev) - fully isolated
```

**Why it's fast:** ZFS copy-on-write shares unchanged data blocks
**Why it's safe:** CHECKPOINT ensures all committed transactions are on disk (zero data loss)
**Why it's efficient:** Branches are ~100KB until data diverges

## Command Reference

<details>
<summary><strong>Project Commands</strong></summary>

```bash
# Create project (auto-creates <project>/main branch)
pgd project create myapp
pgd project create legacy --pg-version 14
pgd project create vectordb --image ankane/pgvector:17
pgd project create myapp --pool tank2  # If multiple ZFS pools

# List/view/delete
pgd project list
pgd project get myapp
pgd project delete myapp --force
```

**Docker image inheritance:** All branches inherit parent project's Docker image
</details>

<details>
<summary><strong>Branch Commands</strong></summary>

```bash
# Create branch (application-consistent, uses CHECKPOINT)
pgd branch create prod/dev
pgd branch create prod/feature --from prod/dev

# List/view/delete
pgd branch list
pgd branch list prod  # Specific project
pgd branch get prod/dev
pgd branch delete prod/dev

# Sync branch with parent's current state
pgd branch sync prod/dev
```
</details>

<details>
<summary><strong>Snapshot Commands</strong></summary>

```bash
# Create snapshot (enables PITR)
pgd snapshot create prod/main --label "before-migration"

# List/delete
pgd snapshot list
pgd snapshot list prod/main
pgd snapshot delete <snapshot-id>

# Cleanup old snapshots
pgd snapshot cleanup prod/main --days 30
pgd snapshot cleanup --all --days 30
pgd snapshot cleanup prod/main --days 30 --dry-run
```

**Best practice:** Automate snapshots via cron for PITR
</details>

<details>
<summary><strong>Point-in-Time Recovery (PITR)</strong></summary>

```bash
# Recover to specific time
pgd branch create prod/recovered --pitr "2025-10-07T14:30:00Z"
pgd branch create prod/recovered --pitr "2 hours ago"
pgd branch create prod/recovered --from prod/dev --pitr "1 hour ago"
```

**How it works:**
1. Finds closest snapshot before recovery target
2. Clones snapshot to new dataset
3. PostgreSQL replays WAL logs to target time
4. New branch available at recovered state

**Limitation:** Cannot recover before latest snapshot (create snapshots regularly)
</details>

<details>
<summary><strong>WAL Commands</strong></summary>

```bash
# View WAL archive info (file count, size, age)
pgd wal info
pgd wal info prod/main

# Cleanup old WAL files
pgd wal cleanup prod/main --days 7
pgd wal cleanup prod/main --days 7 --dry-run
```

**WAL location:** `~/.local/share/pgd/wal-archive/<dataset>/`
</details>

<details>
<summary><strong>Lifecycle Commands</strong></summary>

```bash
# View all projects and branches
pgd status

# Start/stop/restart branches
pgd start prod/dev
pgd stop prod/dev
pgd restart prod/dev
```
</details>

<details>
<summary><strong>Connection</strong></summary>

```bash
# Get connection details
pgd status

# Connect with psql
psql -h localhost -p <port> -U <username> -d <database>

# Or use connection string from status
psql postgresql://<username>:<password>@localhost:<port>/<database>
```
</details>

## Advanced Topics

<details>
<summary><strong>Performance</strong></summary>

**Operation timings:**
- Create branch: 2-5s (CHECKPOINT + ZFS snapshot + container start)
- Branch sync: 2-5s (re-snapshot parent + clone + restart)
- PITR recovery: 1-10min (depends on WAL replay)
- Delete branch: 1-2s

**Production recommendations:**
- ✅ Migration testing, dev environments, debugging
- ✅ Multiple branches per day
- ❌ Per-request branching (too slow)
- ❌ Thousands of branches (ZFS overhead)
</details>

<details>
<summary><strong>Production Safety</strong></summary>

**Application-consistent snapshots (default):**
1. `CHECKPOINT` flushes dirty buffers to disk
2. ZFS snapshot (~100ms)
3. Clone + start PostgreSQL container

**Guarantees:**
- ✅ Zero data loss (all committed transactions included)
- ✅ Crash-safe (no recovery needed)
- ✅ Consistent state (all constraints valid)

**Best practices:**
1. Create regular snapshots via cron for PITR
2. Delete branches after use to reclaim space
3. Monitor disk usage (WAL archives accumulate)
4. Test recovery regularly
5. Secure credentials (state file has plaintext passwords)
</details>

<details>
<summary><strong>Automated Snapshot Scheduling</strong></summary>

Create regular snapshots via cron for fine-grained PITR:

```bash
crontab -e

# Hourly snapshots (business hours)
0 9-17 * * 1-5 /usr/local/bin/pgd snapshot create prod/main --label "hourly-$(date +\%Y\%m\%d-\%H00)"

# Daily snapshots at 2 AM
0 2 * * * /usr/local/bin/pgd snapshot create prod/main --label "daily-$(date +\%Y\%m\%d)"

# Weekly cleanup: delete snapshots older than 30 days
0 3 * * 0 /usr/local/bin/pgd snapshot cleanup --all --days 30

# Weekly WAL cleanup: delete WAL files older than 7 days
0 4 * * 0 /usr/local/bin/pgd wal cleanup prod/main --days 7
```

**Tip:** More snapshots = finer recovery granularity but more storage
</details>

<details>
<summary><strong>Configuration & File Locations</strong></summary>

**Zero-config design** - sensible defaults:
- PostgreSQL: `postgres:17-alpine` (override with `--pg-version` or `--image`)
- ZFS compression: `lz4`
- ZFS recordsize: `8k` (PostgreSQL page size)
- ZFS pool: auto-detected
- Ports: dynamically allocated by Docker

**Auto-initialization on first `pgd project create`:**
1. Detects ZFS pool
2. Creates base dataset (`<pool>/pgd/databases`)
3. Initializes state.json
4. Creates WAL archive directory

**File locations:**
- State: `~/.local/share/pgd/state.json`
- State lock: `~/.local/share/pgd/state.json.lock`
- WAL archive: `~/.local/share/pgd/wal-archive/<dataset>/`
- ZFS datasets: `<pool>/pgd/databases/<project>-<branch>`
- Docker containers: `pgd-<project>-<branch>`
</details>

<details>
<summary><strong>Testing</strong></summary>

```bash
# Run all tests (70 tests total)
./scripts/run-extended-tests.sh     # 20 tests
./scripts/run-v1-tests.sh           # 35 tests
./scripts/run-advanced-tests.sh     # 13 tests
```

**Coverage:**
- Project/branch lifecycle, data persistence
- Snapshot management, WAL archiving, PITR
- ZFS copy-on-write efficiency
- Edge cases, error handling, state integrity

**CI/CD:** GitHub Actions runs all tests on push/PR (Ubuntu 22.04 + ZFS)
</details>

<details>
<summary><strong>Development</strong></summary>

Built with: [Bun](https://bun.sh), TypeScript, [Dockerode](https://github.com/apocas/dockerode), [ZFS](https://openzfs.org/)

```bash
bun install && bun run build
bun run dev  # Development mode
sudo cp dist/pgd /usr/local/bin/
```
</details>

## Roadmap

**v0.4.0+:** Project/branch rename, remote WAL storage (S3/B2), schema diff, branch promotion, Web UI

See [TODO.md](TODO.md) for full roadmap

## Contributing

Contributions welcome! Fork → feature branch → add tests → ensure tests pass → PR

## License

MIT - Created by [Johan Eliasson](https://github.com/elitan)

Built with [Claude Code](https://claude.com/claude-code)
