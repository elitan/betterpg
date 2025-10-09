# Mount Alternatives Research

This document explores all possible alternatives to avoid sudo for mounting ZFS datasets.

## The Problem

pgd requires mounting ZFS datasets so Docker containers can access PostgreSQL data directories. On Linux, the `mount(2)` system call requires `CAP_SYS_ADMIN` capability, which effectively means root/sudo access.

**Current sudo usage in pgd:**
- `project create` - mounts dataset once
- `branch create` - mounts dataset once
- `branch sync` - mounts dataset once

These are one-time operations per resource, not frequent operations.

## Alternative 1: ZFS-FUSE (Userspace ZFS)

**What:** Run ZFS in userspace via FUSE instead of kernel module.

**Status:** ❌ **Not viable**
- `zfs-fuse` is **deprecated** and unmaintained since ~2012
- Built on old Solaris ZFS code, not modern OpenZFS
- Poor performance compared to kernel module
- Ubuntu removed it from repositories
- Current OpenZFS is kernel-only, no FUSE implementation

**Verdict:** Dead end, don't pursue.

## Alternative 2: bindfs (FUSE Mount Alternative)

**What:** Use bindfs (FUSE) to mount directories without root.

**Status:** ❌ **Not applicable**
- bindfs requires source directory to already exist
- Can't create initial mount point without root
- Works for remounting/rebinding, not initial mounting
- Doesn't solve our fundamental problem

**Verdict:** Doesn't help - still need initial mount.

## Alternative 3: Docker ZFS Volume Plugin

**What:** Use Docker volume plugin that manages ZFS datasets natively.

**Examples:**
- `TrilliumIT/docker-zfs-plugin`
- `ZentriaMC/docker-zfs-plugin`

**How it works:**
```bash
# Plugin creates ZFS dataset AND makes it available to Docker
docker volume create -d zfs -o compression=lz4 --name=tank/pgd/mydb

# Docker automatically mounts it (plugin handles mounting)
docker run -v mydb:/var/lib/postgresql/data postgres:17
```

**Status:** ⚠️ **Possible but has tradeoffs**

**Pros:**
- ✅ Plugin runs as daemon (one sudo to start daemon)
- ✅ User commands don't need sudo
- ✅ Docker handles mounting internally
- ✅ Cleaner integration with Docker ecosystem

**Cons:**
- ❌ Plugin daemon must run as root (systemd service)
- ❌ Still requires elevated privileges (just moved to daemon)
- ❌ Additional dependency (plugin must be installed)
- ❌ Less control over ZFS operations
- ❌ Doesn't support all pgd operations (snapshots, clones, PITR)
- ❌ Plugin may not support CHECKPOINT workflow
- ❌ Architecture change required

**Verdict:** Moves sudo from CLI to daemon, but doesn't eliminate it.

## Alternative 4: setuid Helper Binary

**What:** Create small C binary with setuid bit that only mounts ZFS datasets.

```c
// mount-helper (setuid root)
int main(int argc, char **argv) {
    // 1. Verify user has ZFS permissions via zfs_get_fsacl()
    // 2. Verify dataset path is valid
    // 3. Call mount() with root privileges
    // 4. Drop privileges
}
```

**Status:** ⚠️ **Possible but dangerous**

**Pros:**
- ✅ No sudo prompts for users
- ✅ Targeted privilege escalation

**Cons:**
- ❌ **Major security risk** (setuid binaries are attack vectors)
- ❌ Complex to implement securely
- ❌ Must validate all inputs carefully
- ❌ Harder to audit than sudoers
- ❌ Requires C code (not TypeScript)

**Verdict:** Security nightmare, avoid.

## Alternative 5: Mount Daemon with Socket API

**What:** Root daemon listens on socket, validates permissions, performs mounts.

```bash
# Daemon runs as root
sudo systemctl start pgd-mount-daemon

# pgd sends mount request via socket
pgd project create myapp
  → socket → daemon validates → daemon mounts → returns success
```

**Status:** ⚠️ **Possible but complex**

**Pros:**
- ✅ No sudo prompts
- ✅ Centralized permission checking
- ✅ Better logging/auditing

**Cons:**
- ❌ Complex architecture (daemon + IPC)
- ❌ Daemon must run as root
- ❌ Service management complexity
- ❌ Still privileged code running
- ❌ Overkill for our use case

**Verdict:** Over-engineered for pgd's needs.

## Alternative 6: User Namespace + CAP_SYS_ADMIN

**What:** Use user namespaces to grant CAP_SYS_ADMIN without full root.

**Status:** ❌ **Not viable**
- CAP_SYS_ADMIN in user namespace is still very powerful
- ZFS kernel module may not respect user namespace capabilities
- Extremely complex to set up correctly
- Not well-documented for ZFS

**Verdict:** Theoretical, impractical.

## Alternative 7: Pre-mount Everything

**What:** Admin pre-mounts all possible datasets, pgd just uses them.

```bash
# Admin creates and mounts ahead of time
sudo zfs create tank/pgd/databases/myapp-main
sudo zfs mount tank/pgd/databases/myapp-main

# pgd just verifies mount exists
pgd project create myapp --assume-mounted
```

**Status:** ⚠️ **Possible for specific workflows**

**Pros:**
- ✅ Zero sudo in pgd
- ✅ Admin has full control
- ✅ Works for pre-planned infrastructure

**Cons:**
- ❌ Can't create branches dynamically
- ❌ Poor UX (two-step process)
- ❌ Doesn't work for ad-hoc development
- ❌ Defeats purpose of instant branching

**Verdict:** Only viable for very controlled environments.

## Alternative 8: mountpoint=legacy + /etc/fstab

**What:** Create datasets with `mountpoint=legacy`, mount via /etc/fstab.

```bash
# Create with legacy mountpoint
zfs create -o mountpoint=legacy tank/pgd/databases/myapp-main

# Add to /etc/fstab
tank/pgd/databases/myapp-main /mnt/pgd/myapp-main zfs defaults 0 0

# User can mount if allowed in fstab
mount /mnt/pgd/myapp-main
```

**Status:** ❌ **Not viable**
- Requires editing /etc/fstab for every branch (needs root)
- Can't dynamically create branches
- Defeats purpose of instant branching
- More complex than current solution

**Verdict:** Worse than current approach.

## Research Summary

After exhaustive research, **there is NO way to completely avoid privileged operations** for mounting ZFS datasets on Linux. Every alternative either:

1. Moves sudo from CLI to daemon (still requires root)
2. Uses dangerous security patterns (setuid binaries)
3. Is deprecated/unmaintained (zfs-fuse)
4. Doesn't actually solve the problem (bindfs, user namespaces)
5. Breaks the instant branching workflow (pre-mounting, fstab)

## Current Solution is Optimal

**Our current approach is the best available:**

```bash
# One-time setup
sudo ./scripts/setup-permissions.sh

# Regular usage - sudo only for mount
pgd project create myapp  # Internally: sudo zfs mount ...
```

**Why it's the best:**
1. ✅ **Minimal sudo scope** - restricted to `/sbin/zfs` only
2. ✅ **Transparent** - sudoers config is auditable
3. ✅ **Standard Linux security** - uses sudoers, not custom daemons
4. ✅ **90% sudo-free** - only mount/unmount need it
5. ✅ **Simple** - no daemons, no setuid binaries, no plugins
6. ✅ **Instant branching** - dynamic dataset creation works

## Recommendation

**Keep the current approach.** It's the most secure, maintainable, and practical solution given Linux kernel limitations.

### Future Consideration

If the Linux kernel ever adds support for unprivileged mounting of ZFS datasets (unlikely), we can remove sudo entirely. Until then, targeted sudoers is the industry standard approach.

### Alternative for Paranoid Environments

For environments that absolutely cannot allow sudo:

1. **Use FreeBSD/illumos** - ZFS delegation works for mount
2. **Pre-provision everything** - Admin creates all branches ahead of time
3. **Use cloud databases** - Neon, Supabase, RDS (no ZFS)

---

**Conclusion:** There is no better alternative. Our current sudo model (delegation + targeted sudoers) is the optimal solution for Linux + ZFS.
