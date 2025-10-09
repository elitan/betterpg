# pgd Setup Guide

This guide walks you through the one-time setup required to run `pgd` without sudo privileges.

## Overview

`pgd` requires two types of permissions:
1. **ZFS delegation** - for creating/destroying datasets and snapshots
2. **Docker access** - for managing PostgreSQL containers

The provided setup script configures both automatically.

## Quick Setup

### 1. Prerequisites

Ensure you have ZFS and Docker installed:

```bash
# Ubuntu/Debian
sudo apt install zfsutils-linux docker.io

# Arch Linux
sudo pacman -S zfs-dkms docker

# Verify installations
zpool list
docker --version
```

### 2. Run Setup Script

Run the one-time permission setup script:

```bash
sudo ./scripts/setup-permissions.sh
```

This script will:
- ✅ Detect your ZFS pool (or prompt you to select one)
- ✅ Enable ZFS delegation on the pool
- ✅ Create base datasets: `{pool}/pgd` and `{pool}/pgd/databases`
- ✅ Grant your user ZFS permissions: `create`, `destroy`, `snapshot`, `clone`, `mount`, `promote`, etc.
- ✅ Add your user to the `docker` group

### 3. Log Out and Back In

**Important:** After running the setup script, you MUST log out and log back in for the docker group membership to take effect.

```bash
# After running setup script
exit  # or log out of your session

# Log back in and verify
groups | grep docker  # Should show 'docker'
docker ps             # Should work without sudo
```

### 4. Verify Permissions

Check that your user has the correct ZFS permissions:

```bash
# List ZFS permissions (replace 'tank' with your pool name)
zfs allow tank/pgd

# Output should show something like:
# user yourname create,destroy,snapshot,clone,mount,unmount,promote,...
```

### 5. Create Your First Project

```bash
pgd project create myapp

# If you see this error:
# "✗ Missing ZFS Permissions"
# Then you need to run the setup script and re-login.
```

## Manual Setup (Advanced)

If you prefer to configure permissions manually instead of using the script:

### ZFS Delegation

```bash
# Enable delegation on your pool
sudo zpool set delegation=on tank

# Create base datasets
sudo zfs create tank/pgd
sudo zfs create tank/pgd/databases

# Grant permissions to your user
sudo zfs allow $USER \
  create,destroy,snapshot,clone,mount,unmount,promote,send,receive,\
compression,recordsize,mountpoint,canmount,atime,relatime \
  tank/pgd

sudo zfs allow $USER \
  create,destroy,snapshot,clone,mount,unmount,promote,send,receive,\
compression,recordsize,mountpoint,canmount,atime,relatime \
  tank/pgd/databases
```

### Docker Group

```bash
# Add your user to docker group
sudo usermod -aG docker $USER

# Log out and log back in, then verify
docker ps  # Should work without sudo
```

## Troubleshooting

### "Missing ZFS Permissions" error

**Symptoms:**
```
✗ Missing ZFS Permissions

pgd requires ZFS delegation permissions to operate without sudo.

To fix this, run the one-time setup script:
  sudo ./scripts/setup-permissions.sh
```

**Solution:**
1. Run `sudo ./scripts/setup-permissions.sh`
2. Verify permissions: `zfs allow tank/pgd` (replace 'tank' with your pool)
3. Ensure your username appears in the output

### "Missing Docker Permissions" error

**Symptoms:**
```
✗ Missing Docker Permissions

pgd requires Docker access without sudo.
```

**Solution:**
1. Run `sudo ./scripts/setup-permissions.sh`
2. **Log out and log back in** (this is critical!)
3. Verify: `docker ps` should work without sudo
4. Check group membership: `groups | grep docker`

### Docker group not taking effect

**Symptoms:**
- Setup script completed successfully
- `docker ps` still requires sudo
- `groups` command doesn't show 'docker'

**Solution:**
```bash
# Completely log out of your desktop session
# Don't just close the terminal - log out and back in

# Or force a new login shell
su - $USER

# Then verify
groups | grep docker
docker ps
```

### Multiple ZFS pools detected

**Symptoms:**
```
Multiple ZFS pools found: tank, backup, storage
Please specify one using --pool <name>
```

**Solution:**
```bash
# Run setup with specific pool
sudo ./scripts/setup-permissions.sh
# When prompted, enter the pool name you want to use

# Or specify pool when creating projects
pgd project create myapp --pool tank
```

### Permission denied writing to dataset

**Symptoms:**
```
Error: Permission denied writing to /tank/pgd/databases/myapp-main/pgdata
```

**Solution:**
This usually means ZFS delegation isn't set up correctly.

```bash
# Check current permissions
zfs allow tank/pgd/databases

# If your user isn't listed, run setup again
sudo ./scripts/setup-permissions.sh

# Verify the dataset exists and has correct permissions
zfs list -r tank/pgd
```

## Security Considerations

### Why ZFS Delegation?

ZFS delegation allows specific users to perform ZFS operations **without sudo**, which is more secure than:
- ❌ Granting passwordless sudo for all zfs commands
- ❌ Running the entire CLI as root
- ✅ Least privilege: user can only manage datasets under `tank/pgd`

### Why Docker Group?

The Docker group grants access to the Docker socket (`/var/run/docker.sock`), which is equivalent to root access on the host. This is standard practice for Docker users.

**Alternative:** Use [rootless Docker](https://docs.docker.com/engine/security/rootless/) for even better security isolation.

### What Permissions Are Granted?

The setup script grants these ZFS permissions on `{pool}/pgd/**`:

| Permission | Purpose |
|------------|---------|
| `create` | Create new datasets for branches |
| `destroy` | Delete datasets when removing branches |
| `snapshot` | Create ZFS snapshots for branching |
| `clone` | Clone snapshots to create new branches |
| `mount`/`unmount` | Mount datasets for PostgreSQL access |
| `promote` | Promote clones to break snapshot dependencies |
| `compression` | Set compression on datasets |
| `recordsize` | Set recordsize for PostgreSQL optimization |

**Important:** Your user can ONLY manage datasets under `{pool}/pgd`. They cannot:
- ❌ Modify other ZFS datasets
- ❌ Destroy the pool
- ❌ Change pool-level settings
- ❌ Access other users' data

## Verifying Security

After setup, verify the security posture:

```bash
# 1. Confirm pgd works without sudo
pgd project create test
pgd branch create test/dev

# 2. Verify limited ZFS scope
zfs allow tank/pgd  # Should show your permissions
zfs allow tank      # Should NOT show your permissions (pool level)

# 3. Confirm no sudo prompts during normal operations
pgd project list
pgd branch list
pgd status

# 4. Cleanup test project
pgd project delete test --force
```

## Next Steps

Once setup is complete:
1. ✅ Read the [main README](README.md) for usage examples
2. ✅ Check [CLAUDE.md](CLAUDE.md) for architectural details
3. ✅ Review [TODO.md](TODO.md) for upcoming features
4. ✅ Create your first real project: `pgd project create myapp`

## Additional Resources

- **ZFS Delegation**: [OpenZFS Docs - Delegated Administration](https://openzfs.github.io/openzfs-docs/man/8/zfs-allow.8.html)
- **Docker Security**: [Docker Post-Installation Steps](https://docs.docker.com/engine/install/linux-postinstall/)
- **Rootless Docker**: [Docker Rootless Mode](https://docs.docker.com/engine/security/rootless/)
