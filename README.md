<div align="center">
  <h1>pgd</h1>
  <h3>Instant PostgreSQL branching using ZFS snapshots</h3>
  <p>Clone your database in 0.1 seconds. Each branch is a complete, isolated PostgreSQL instance.</p>
  <a href="https://github.com/elitan/pgd/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/elitan/pgd" />
  </a>
  <a href="https://github.com/elitan/pgd/stargazers">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/elitan/pgd?style=social" />
  </a>
  <a href="https://discord.gg/PtePt2wx7R">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?logo=discord&logoColor=white" />
  </a>
  <br />
  <a href="https://x.com/elitasson">
    <img alt="Twitter Follow" src="https://img.shields.io/twitter/follow/elitasson?style=social" />
  </a>
</div>

<br />

## See it in action

```bash
# Create project with PostgreSQL 17 (auto-creates demo/main branch)
$ pgd project create demo

Creating project demo...
  ▸ Detect ZFS pool                         0.0s
  ▸ Validate permissions                    0.0s
  ▸ Create dataset demo-main                0.0s
  ▸ Mount dataset                           0.0s
  ▸ PostgreSQL ready                        6.2s

Connection ready:
  postgresql://postgres:***@localhost:32835/postgres
```

**Notice:** Created `demo/main` branch automatically. Every project starts with a main branch.

```bash
# Add data to main branch
$ psql -h localhost -p 32835 -U postgres << EOF
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');
SELECT * FROM users;
EOF

 id |  name
----+---------
  1 | Alice
  2 | Bob
  3 | Charlie
(3 rows)
```

```bash
# Create branch in 0.1s (copies entire database via ZFS snapshot)
$ pgd branch create demo/dev

Creating demo/dev from demo/main...
  ▸ Checkpoint                              0.1s
  ▸ Snapshot 2025-10-09T18-40-21            0.0s
  ▸ Clone dataset                           0.0s
  ▸ Mount dataset                           0.0s
  ▸ PostgreSQL ready                        6.3s

Connection ready:
  postgresql://postgres:***@localhost:32836/postgres
```

**Notice:** Branch created in **0.1s** (Checkpoint + Snapshot + Clone + Mount). PostgreSQL container startup (6.3s) happens in parallel.

```bash
# Check status - two isolated databases running
$ pgd status

pgd Status

ZFS Pool
┌──────┬────────┬─────────┬─────────────────┬─────────┐
│ Pool │ Health │ Size    │ Used            │ Free    │
├──────┼────────┼─────────┼─────────────────┼─────────┤
│ tank │ ONLINE │ 9.50 GB │ 22.41 MB (0.2%) │ 9.48 GB │
└──────┴────────┴─────────┴─────────────────┴─────────┘

Projects (1)
┌───┬───────────────┬───────────────┬────────────────────┬───────────┬─────────────────────┐
│   │ Name          │ Type          │ Image              │ Branches  │ Created             │
├───┼───────────────┼───────────────┼────────────────────┼───────────┼─────────────────────┤
│ ● │ demo          │ project       │ postgres:17-alpine │ 2         │ 2025-10-09 18:40:21 │
├───┼───────────────┼───────────────┼────────────────────┼───────────┼─────────────────────┤
│ ● │   ↳ demo/main │ running | 13s │ Port 32835         │ 9.25 MB   │ 2025-10-09 18:40:21 │
├───┼───────────────┼───────────────┼────────────────────┼───────────┼─────────────────────┤
│ ● │   ↳ demo/dev  │ running | 6s  │ Port 32836         │ 127.50 KB │ 2025-10-09 18:40:28 │
└───┴───────────────┴───────────────┴────────────────────┴───────────┴─────────────────────┘
```

**Notice:** `demo/dev` is **127.50 KB** (not 9.25 MB). ZFS copy-on-write shares unchanged data blocks.

```bash
# Make changes in dev branch
$ psql -h localhost -p 32836 -U postgres << EOF
INSERT INTO users (name) VALUES ('Dave'), ('Eve');
DELETE FROM users WHERE name = 'Bob';
SELECT * FROM users;
EOF

 id |  name
----+---------
  1 | Alice
  3 | Charlie
  4 | Dave
  5 | Eve
(4 rows)
```

```bash
# Compare both branches - complete isolation
$ psql -h localhost -p 32835 -U postgres -c "SELECT * FROM users;"  # Main
$ psql -h localhost -p 32836 -U postgres -c "SELECT * FROM users;"  # Dev

--- Main branch (Port 32835) ---
 id |  name
----+---------
  1 | Alice
  2 | Bob      ← Still here
  3 | Charlie
(3 rows)

--- Dev branch (Port 32836) ---
 id |  name
----+---------
  1 | Alice
  3 | Charlie  ← Bob deleted
  4 | Dave     ← New rows
  5 | Eve
(4 rows)
```

```bash
# Reset dev back to main's current state
$ pgd branch reset demo/dev

Resetting demo/dev to demo/main...
  ▸ Stop container                          0.2s
  ▸ Checkpoint demo/main                    0.1s
  ▸ Create snapshot                         0.0s
  ▸ Destroy old dataset                     0.1s
  ▸ Clone new snapshot                      0.0s
  ▸ Mount dataset                           0.0s
  ▸ Start container                         6.2s
  ▸ PostgreSQL ready                        0.0s
```

```bash
# Dev now matches main (Bob is back, Dave/Eve gone)
$ psql -h localhost -p 32836 -U postgres -c "SELECT * FROM users;"

 id |  name
----+---------
  1 | Alice
  2 | Bob      ← Back from main
  3 | Charlie
(3 rows)
```

---

## What just happened?

- [✓] Created full database copy in 0.1s (Checkpoint + ZFS snapshot + clone + mount)
- [✓] Each branch is isolated (changes don't leak between branches)
- [✓] Branches are 127 KB via ZFS copy-on-write (not full copies)
- [✓] Reset resets branch to parent (like `git reset --hard origin/main`)

**Think of it like Git for databases:**
- `pgd project create` = `git init`
- `pgd branch create` = `git branch` (complete database instance)
- `pgd branch reset` = `git reset --hard origin/main`

## Why pgd?

**Perfect for:**
- Testing migrations on production data before applying
- Developer environments with real data volumes
- Debugging production issues without risk
- Point-in-time recovery via snapshots + WAL archiving

**How it works:**
ZFS copy-on-write + PostgreSQL CHECKPOINT = instant, space-efficient, application-consistent clones

**Requirements:** Linux + ZFS + Docker + Bun

> **⚠ Security Notice:** Beta software (v0.3.5). Credentials stored in plaintext. Designed for dev/test environments.

## Installation

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt install zfsutils-linux
curl -fsSL https://get.docker.com | sh
curl -fsSL https://bun.sh/install | bash

# Install pgd
git clone https://github.com/elitan/pgd.git && cd pgd
bun install && bun run build
sudo cp dist/pgd /usr/local/bin/
```

### One-Time Setup (Required per server)

Run these commands **once per server**:

```bash
# 1. Create ZFS pool (if you don't have one)
zpool list  # Check existing pools
# For testing: sudo truncate -s 10G /tmp/zfs-pool.img && sudo zpool create tank /tmp/zfs-pool.img
# For production: sudo zpool create tank /dev/sdb

# 2. Run pgd setup (grants permissions, configures Docker)
sudo pgd setup

# 3. Log out and log back in (required for group membership to take effect)

# 4. Verify setup and start using pgd:
pgd doctor              # Check if everything is configured correctly
pgd project create myapp
```

**What `pgd setup` does:**
- Auto-detects ZFS pool (or prompts if multiple exist)
- Grants ZFS delegation permissions (90% of operations run without sudo)
- Adds user to docker group
- Creates `pgd` group and adds current user
- Installs minimal sudoers config for mount/unmount operations only

**Security:** Only mount/unmount require sudo (Linux kernel limitation). All other operations use ZFS delegation.

**Troubleshooting:** Run `pgd doctor` to diagnose configuration issues. The command checks:
- System requirements (OS, Bun, Docker, ZFS)
- Permissions (ZFS delegation, Docker group)
- pgd state (projects, branches, containers)
- File permissions and directory structure

<details>
<summary>Detailed setup & permissions</summary>

**Permission setup** (one-time, required before first use):
```bash
sudo pgd setup
```

The setup command:
1. Auto-detects ZFS pool (or prompts if multiple exist)
2. Grants ZFS delegation permissions (90% of operations run without sudo)
3. Adds user to docker group
4. Creates `pgd` group and adds current user
5. Installs minimal sudoers config for mount/unmount operations only

**Security model:**
- 90% of ZFS operations use delegation (no sudo)
- Only mount/unmount require sudo (Linux kernel CAP_SYS_ADMIN requirement)
- Sudo restricted to `/sbin/zfs mount` and `/sbin/zfs unmount` only

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

## Command Reference

<details>
<summary><strong>Project Commands</strong></summary>

```bash
# Create project (auto-creates <project>/main branch)
pgd project create myapp
pgd proj create legacy --pg-version 14
pgd proj create vectordb --image ankane/pgvector:17
pgd proj create myapp --pool tank2  # If multiple ZFS pools

# List/view/delete
pgd project list     # or: pgd proj ls
pgd project get myapp
pgd project delete myapp --force     # or: pgd proj rm myapp --force
```

**Docker image inheritance:** All branches inherit parent project's Docker image

**Aliases:** `project` can be shortened to `proj`, `list` to `ls`, `delete` to `rm`
</details>

<details>
<summary><strong>Branch Commands</strong></summary>

```bash
# Create branch (application-consistent, uses CHECKPOINT)
pgd branch create prod/dev
pgd br create prod/feature --parent prod/dev

# List/view/delete
pgd branch list              # or: pgd br ls
pgd branch list prod         # Specific project
pgd branch get prod/dev
pgd branch delete prod/dev   # or: pgd br rm prod/dev

# Reset branch to parent's current state
pgd branch reset prod/dev

# Show connection details and password
pgd branch password prod/dev   # or: pgd br pass prod/dev

# Start/stop/restart branches
pgd branch start prod/dev      # or: pgd br start prod/dev
pgd branch stop prod/dev       # or: pgd br stop prod/dev
pgd branch restart prod/dev    # or: pgd br restart prod/dev
```

**Aliases:** `branch` can be shortened to `br`, `list` to `ls`, `delete` to `rm`, `password` to `pass`
</details>

<details>
<summary><strong>Snapshot Commands</strong></summary>

```bash
# Create snapshot (application-consistent, uses CHECKPOINT)
pgd snapshot create prod/main --label "before-migration"
# or: pgd snap create prod/main --label "before-migration"

# List/delete
pgd snapshot list                      # or: pgd snap ls
pgd snapshot list prod/main            # or: pgd snap ls prod/main
pgd snapshot delete <snapshot-id>      # or: pgd snap rm <snapshot-id>

# Cleanup old snapshots
pgd snapshot cleanup prod/main --days 30
pgd snapshot cleanup --all --days 30
pgd snapshot cleanup prod/main --days 30 --dry-run
```

**Best practice:** Automate snapshots via cron for PITR

**Aliases:** `snapshot` can be shortened to `snap`, `list` to `ls`, `delete` to `rm`
</details>

<details>
<summary><strong>Point-in-Time Recovery (PITR)</strong></summary>

```bash
# Recover to specific time
pgd branch create prod/recovered --pitr "2025-10-07T14:30:00Z"
pgd branch create prod/recovered --pitr "2 hours ago"
pgd branch create prod/recovered --parent prod/dev --pitr "1 hour ago"
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

**WAL location:** `~/.pgd/wal-archive/<dataset>/`
</details>

<details>
<summary><strong>Status & Overview</strong></summary>

```bash
# View all projects and branches
pgd status     # or: pgd ls
```

**Aliases:** `status` can be shortened to `ls`
</details>

<details>
<summary><strong>Connection</strong></summary>

```bash
# Get connection details
pgd status                      # Overview of all projects and branches
pgd branch password prod/dev    # Show full connection string with password

# Connect with psql
psql -h localhost -p <port> -U <username> -d <database>

# Or use connection string
psql postgresql://<username>:<password>@localhost:<port>/<database>
```
</details>

<details>
<summary><strong>Diagnostics</strong></summary>

```bash
# Run comprehensive health checks
pgd doctor
```

**Checks performed:**
- System requirements (OS, Bun, Docker, ZFS)
- ZFS configuration (pool, permissions, datasets)
- Docker configuration (daemon, permissions, images)
- pgd state (projects, branches, containers)
- File permissions and directory structure

**Use cases:**
- Verify setup after installation
- Troubleshoot configuration issues
- Generate diagnostic info for GitHub issues
- Check system health before major operations

**Example output:**
```
pgd Health Check
════════════════════════════════════════════════════════════

System Information
────────────────────────────────────────────────────────────
✓ Operating System
  Ubuntu 24.04.3 LTS
✓ Bun Runtime
  v1.2.23
ℹ pgd Version
  v0.3.4

ZFS Configuration
────────────────────────────────────────────────────────────
✓ ZFS Installation
  zfs-2.2.2-0ubuntu9.4
✓ ZFS Pool
  Using pool: tank
✓ ZFS Permissions
  Delegation configured for tank/pgd/databases

Summary: ✓ All checks passed! pgd is ready to use.
```
</details>

## Advanced Topics

<details>
<summary><strong>Performance</strong></summary>

**Operation timings:**
- Database branching: ~100ms (CHECKPOINT + ZFS snapshot + clone + mount)
- PostgreSQL startup: ~6s (container initialization, not part of branching)
- Branch reset: ~100ms branching + ~6s container restart
- PITR recovery: ~100ms branching + 1-10min WAL replay + ~6s container startup
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
- State: `~/.pgd/state.json`
- State lock: `~/.pgd/state.json.lock`
- WAL archive: `~/.pgd/wal-archive/<dataset>/`
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

## Community

Like this tool? Join the community:
- Follow on X: [@elitasson](https://x.com/elitasson)
- Join Discord: [https://discord.gg/PtePt2wx7R](https://discord.gg/PtePt2wx7R)

## Contributing

Contributions welcome! Fork → feature branch → add tests → ensure tests pass → PR

## License

MIT - Created by [Johan Eliasson](https://github.com/elitan)

Built with [Claude Code](https://claude.com/claude-code)
