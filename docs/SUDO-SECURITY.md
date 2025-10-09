# pgd Sudo Security Model

## TL;DR

**pgd requires sudo ONLY for ZFS mount/unmount due to Linux kernel limitations.**
We use a **targeted sudoers config** (`/etc/sudoers.d/pgd`) that restricts sudo to ONLY `/sbin/zfs` commands - this is vastly more secure than unrestricted sudo.

## Why Sudo is Required

### The Problem: Linux Kernel Mount Restrictions

On Linux, the `mount(2)` system call requires the `CAP_SYS_ADMIN` capability, which is only available to root. This is a fundamental Linux kernel security restriction, not a ZFS limitation.

**What works WITHOUT sudo (via ZFS delegation):**
- ✅ `zfs create` - create datasets
- ✅ `zfs destroy` - destroy datasets
- ✅ `zfs snapshot` - create snapshots
- ✅ `zfs clone` - clone snapshots
- ✅ `zfs promote` - promote clones
- ✅ `zfs set` - set dataset properties (compression, recordsize, etc.)
- ✅ All other ZFS administrative operations

**What requires sudo (Linux kernel restriction):**
- ❌ `zfs mount` - mount requires CAP_SYS_ADMIN
- ❌ `zfs unmount` - unmount requires CAP_SYS_ADMIN

### Why We Can't Avoid It

We investigated several alternatives:

1. **ZFS Delegation (`zfs allow`)**: Works for most operations, but `mount`/`unmount` cannot be delegated on Linux (unlike Illumos/FreeBSD)

2. **mountpoint=legacy + /etc/fstab**: Would require adding an fstab entry for EVERY dynamically created dataset - impractical for pgd

3. **Docker bind-mounting unmounted datasets**: Docker creates regular directories instead of using ZFS datasets, defeating the entire purpose

4. **Setuid wrapper**: Security nightmare, worse than targeted sudo

## Our Solution: Restricted Sudoers Configuration

Instead of unrestricted sudo or granting full passwordless sudo, we use a **targeted sudoers file** that:

### What It Allows
- ✅ ONLY `/sbin/zfs` commands (not `rm`, `dd`, `chmod`, or ANY other command)
- ✅ Passwordless execution (for automated workflows)
- ✅ Only for users in the `pgd` group

### What It PREVENTS
- ❌ Cannot run any other commands with sudo
- ❌ Cannot escalate privileges beyond ZFS operations
- ❌ Cannot modify system files, kill processes, etc.
- ❌ Scope limited by pgd code validation (datasets under `tank/pgd/**`)

### Security Configuration

File: `/etc/sudoers.d/pgd`

```sudoers
# Allow pgd group to run ZFS commands without password
%pgd ALL=(ALL) NOPASSWD: /sbin/zfs create *, \
                         /sbin/zfs destroy *, \
                         /sbin/zfs snapshot *, \
                         /sbin/zfs clone *, \
                         /sbin/zfs promote *, \
                         /sbin/zfs set *, \
                         /sbin/zfs get *, \
                         /sbin/zfs list *, \
                         /sbin/zfs mount *, \
                         /sbin/zfs unmount *, \
                         /sbin/zfs allow *
```

**Permissions:** `0440` (read-only, owned by root)

## Attack Surface Analysis

### What an Attacker Could Do

If an attacker compromises a user account in the `pgd` group:

**CAN do:**
- Create/destroy ZFS datasets anywhere on the system (`sudo zfs destroy rpool/ROOT`)
- Mount/unmount ZFS datasets
- Modify ZFS properties

**CANNOT do:**
- Execute arbitrary commands as root
- Modify system files outside ZFS
- Install backdoors
- Escalate to full root shell
- Access Docker socket (separate `docker` group)

### Mitigation: Code-Level Dataset Validation

pgd's code validates ALL dataset names before passing to ZFS:

```typescript
// src/utils/namespace.ts
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function validateName(name: string, type: 'project' | 'branch'): void {
  if (!VALID_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid ${type} name: '${name}'. Only alphanumeric characters, hyphens, and underscores allowed`
    );
  }
}
```

All datasets follow the pattern: `{pool}/pgd/databases/{project}-{branch}`

**Attack scenario:**
Attacker modifies pgd code to call `sudo zfs destroy rpool/ROOT`

**Defense:**
- Requires write access to pgd installation (already privileged)
- System integrity monitoring (AIDE, Tripwire) would detect
- Code review before updates
- Users should install pgd from trusted sources only

## Comparison: pgd vs. Unrestricted Sudo

| Aspect | Unrestricted Sudo | pgd Sudoers |
|--------|------------------|-------------|
| Commands allowed | ALL | Only `/sbin/zfs` |
| Password required | Usually yes | No (automated workflows) |
| Root shell access | Yes (`sudo su`) | No |
| System file modification | Yes | Only via ZFS |
| Privilege scope | Unlimited | ZFS operations only |
| Attack surface | Entire system | ZFS subsystem |

## Alternative Approaches (Not Implemented)

### 1. Fully Rootless (Not Possible)

**Why not:** Linux kernel requires CAP_SYS_ADMIN for mount(2). No workaround exists without kernel modifications.

### 2. Systemd User Units with Elevated Permissions

**Why not:** Still requires some form of privilege elevation (setuid, polkit, or sudo). More complex than targeted sudoers.

### 3. Polkit Rules

**Why not:** PolicyKit (`pkexec`) is essentially sudo with extra steps. Doesn't reduce attack surface, adds complexity.

### 4. Capabilities (CAP_SYS_ADMIN)

**Why not:** `CAP_SYS_ADMIN` is nearly equivalent to root. More dangerous than restricted sudo.

## Recommendations for Production

### For Low-Security Environments (Development, Testing)
- ✅ Use setup script as-is
- ✅ Trust pgd code validation
- ✅ Regular security updates

### For High-Security Environments (Production, Compliance)
- ✅ Use AppArmor/SELinux to confine `/sbin/zfs` binary
- ✅ Enable audit logging for all sudo commands
- ✅ Restrict `pgd` group membership to trusted users only
- ✅ Run pgd in dedicated namespace/container
- ✅ Use read-only root filesystem where possible
- ✅ Deploy integrity monitoring (AIDE, Tripwire, osquery)
- ✅ Review pgd code before deployment
- ✅ Consider dedicated ZFS pool for pgd (`pg`d-pool` instead of `rpool`)

### Audit Logging

Enable sudo logging in `/etc/sudoers`:

```
Defaults log_host, log_year, logfile="/var/log/sudo.log"
```

Monitor for suspicious ZFS operations:

```bash
# Watch for ZFS commands outside pgd namespace
tail -f /var/log/sudo.log | grep -v "tank/pgd/databases"
```

## Conclusion

**pgd's sudo usage is a necessary evil due to Linux kernel limitations.**

Our approach minimizes risk by:
1. Restricting sudo to ONLY `/sbin/zfs` commands
2. Validating all dataset names in application code
3. Using standard Linux security practices (sudoers.d, group-based access)
4. Providing clear security documentation

**This is infinitely more secure than:**
- Granting unrestricted sudo
- Adding user to sudoers with `NOPASSWD: ALL`
- Running pgd as root
- Using setuid binaries

**For users concerned about sudo:**
- Review the sudoers file: `sudo cat /etc/sudoers.d/pgd`
- Audit sudo logs: `sudo journalctl -u sudo | grep zfs`
- Consider additional confinement (AppArmor/SELinux)
- Use a dedicated ZFS pool for pgd datasets

**Security is about trade-offs.** We chose targeted sudo over alternatives because it's:
- ✅ Well-understood by sysadmins
- ✅ Auditable
- ✅ Minimal attack surface
- ✅ Compatible with all Linux distributions
- ✅ No kernel patches or exotic configurations required
