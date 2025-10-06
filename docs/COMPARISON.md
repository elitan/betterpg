# BetterPG vs Neon vs Supabase: Database Branching Comparison

## Overview

| Feature | BetterPG | Neon | Supabase |
|---------|----------|------|----------|
| **Architecture** | ZFS + Docker (single server) | Separated storage/compute (cloud) | Full Postgres instances (cloud) |
| **Branching Type** | Full schema + data (ZFS CoW) | Full schema + data (page-level CoW) | Schema only (requires seed scripts) |
| **Branch Creation** | 2-5 seconds | Instant (<1s) | Minutes to hours (depends on migrations/seeds) |
| **Storage Efficiency** | Copy-on-write (ZFS) | Copy-on-write (page-level) | Full duplication per branch |
| **Cost Model** | Self-hosted (hardware only) | Usage-based ($5/month minimum) | Instance-based (per branch) |
| **Network Dependency** | None (local) | Yes (storage network) | Standard Postgres |
| **Scale-to-Zero** | No (containers run) | Yes | No |
| **Geographic Distribution** | Single server | Global (multi-region) | Multi-region |

## Detailed Comparison

### 1. Architecture

#### BetterPG (ZFS + Docker)
```
┌─────────────────────────────────────┐
│         Single Server               │
│  ┌──────────────────────────────┐   │
│  │  PostgreSQL Containers       │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐    │   │
│  │  │Prod │ │Dev  │ │Test │    │   │
│  │  └──┬──┘ └──┬──┘ └──┬──┘    │   │
│  └─────┼──────┼──────┼──────────┘   │
│        │      │      │               │
│  ┌─────▼──────▼──────▼──────────┐   │
│  │     ZFS Filesystem            │   │
│  │  ┌─────────────────────────┐ │   │
│  │  │ Parent Dataset          │ │   │
│  │  │ └─ Snapshot 1 → Clone 1 │ │   │
│  │  │ └─ Snapshot 2 → Clone 2 │ │   │
│  │  └─────────────────────────┘ │   │
│  └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

**How it works:**
- ZFS copy-on-write snapshots at filesystem level
- Instant snapshot creation (metadata-only, ~100ms)
- Each branch is a Docker container with cloned ZFS dataset
- All data local, no network latency

**Advantages:**
- ✅ Zero network latency
- ✅ Predictable performance
- ✅ Full control over infrastructure
- ✅ No cloud costs
- ✅ True filesystem-level CoW (extremely efficient)

**Limitations:**
- ❌ Single server only (no geographic distribution)
- ❌ Manual hardware scaling
- ❌ No built-in high availability
- ❌ Server resources are ceiling

#### Neon (Separated Storage/Compute)
```
┌─────────────────────────────────────────────┐
│           Compute Layer (Stateless)          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Prod    │ │ Dev     │ │ Test    │        │
│  │ Compute │ │ Compute │ │ Compute │        │
│  └────┬────┘ └────┬────┘ └────┬────┘        │
│       │           │           │              │
│       └───────────┼───────────┘              │
│                   │                          │
├───────────────────┼──────────────────────────┤
│                   ▼                          │
│           WAL Safekeepers                    │
│           (Consensus Layer)                  │
├──────────────────────────────────────────────┤
│                   ▼                          │
│           Storage Layer                      │
│  ┌────────────────────────────────────────┐ │
│  │  Page Server (Hot Cache)               │ │
│  │  ┌──────────────────────────────────┐  │ │
│  │  │ Timeline 1 (Prod)                │  │ │
│  │  │  └─ Branch at LSN 1000 (Dev)     │  │ │
│  │  │  └─ Branch at LSN 2000 (Test)    │  │ │
│  │  └──────────────────────────────────┘  │ │
│  └────────────────────────────────────────┘ │
│                   ▼                          │
│           S3 Object Storage                  │
│           (Cold Storage)                     │
└──────────────────────────────────────────────┘
```

**How it works:**
- Compute instances stream WAL to Safekeepers
- Page server indexes WAL into immutable files
- Branches share storage, diverge at page level
- Cold data moved to S3, hot data in page server cache

**Advantages:**
- ✅ Instant branches (truly <1 second)
- ✅ Scale-to-zero (pause unused computes)
- ✅ Global distribution possible
- ✅ Unlimited storage (S3-backed)
- ✅ Point-in-time recovery to any moment

**Limitations:**
- ❌ Network hop latency (compute → storage)
- ❌ Higher tail latency (P99 can spike)
- ❌ Complex architecture (more failure points)
- ❌ Cost accumulation (compute + storage + branches)
- ❌ Vendor lock-in

#### Supabase (Full Postgres Instances)
```
┌─────────────────────────────────────┐
│     Production Project              │
│  ┌─────────────────────────────┐    │
│  │  Full Postgres Instance     │    │
│  │  + Auth + Storage + APIs    │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
                │
                │ Branch (create new instance)
                ▼
┌─────────────────────────────────────┐
│     Preview Branch                  │
│  ┌─────────────────────────────┐    │
│  │  Full Postgres Instance     │    │
│  │  (run migrations + seeds)   │    │
│  │  + Auth + Storage + APIs    │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**How it works:**
- Creates entirely new Postgres instance
- Runs migrations to replicate schema
- Executes seed scripts to populate data (optional)
- Each branch = full isolated infrastructure

**Advantages:**
- ✅ Complete isolation (true separate instances)
- ✅ No architectural complexity
- ✅ Standard Postgres behavior
- ✅ Predictable performance
- ✅ Full Supabase stack (Auth, Storage, etc.)

**Limitations:**
- ❌ Slow branch creation (minutes to hours)
- ❌ Schema-only by default (manual data seeding)
- ❌ High resource overhead (full instances)
- ❌ Expensive (pay per instance)
- ❌ Not true copy-on-write

### 2. Performance Comparison

| Operation | BetterPG | Neon | Supabase |
|-----------|----------|------|----------|
| **Branch Creation** |
| 10GB database | 2-5s | <1s | 2-30 min* |
| 100GB database | 2-5s | <1s | 20-120 min* |
| 1TB database | 3-8s | <1s | Hours* |
| **Query Latency** |
| Local query | 1-5ms | 3-15ms | 1-5ms |
| P99 latency | 10-20ms | 20-100ms | 10-20ms |
| **Disk I/O** |
| Random reads | Local NVMe | Network + cache | Local disk |
| Sequential reads | Local NVMe | Cached/S3 | Local disk |

\* Depends on migration complexity and seed script size

### 3. Storage Efficiency

#### BetterPG (ZFS Copy-on-Write)
```
Primary: 100GB
├─ Branch 1: 150KB initially
│  └─ After 10% changes: ~10GB
├─ Branch 2: 150KB initially
│  └─ After 5% changes: ~5GB
└─ Branch 3: 150KB initially
   └─ After 50% changes: ~50GB

Total storage: 100GB + 65GB = 165GB
```

**Characteristics:**
- Filesystem-level CoW (block granularity: 4KB-128KB)
- Storage grows only with actual data changes
- Shared blocks at ZFS layer
- Extremely efficient for read-heavy branches

#### Neon (Page-Level Copy-on-Write)
```
Timeline (Primary): 100GB in S3
├─ Branch 1: Only delta pages stored
│  └─ After 10% changes: ~10GB delta
├─ Branch 2: Only delta pages stored
│  └─ After 5% changes: ~5GB delta
└─ Branch 3: Only delta pages stored
   └─ After 50% changes: ~50GB delta

Total storage: 100GB + 65GB delta = 165GB
But charged for data changes during retention window
```

**Characteristics:**
- Page-level CoW (8KB PostgreSQL pages)
- Immutable timeline-based storage
- Delta pages stored separately
- Point-in-time recovery built-in

#### Supabase (Full Duplication)
```
Primary: 100GB
├─ Branch 1: 100GB (full copy)
├─ Branch 2: 100GB (full copy)
└─ Branch 3: 100GB (full copy)

Total storage: 400GB
```

**Characteristics:**
- Each branch is full Postgres instance
- No storage sharing
- Simple but inefficient
- Predictable resource usage

### 4. Cost Comparison (Example: 100GB Database, 3 Branches)

#### BetterPG
```
Hardware:
  Server: $200-500/month (dedicated or VPS)
  Storage: Included (local NVMe)

Total: $200-500/month (fixed)

Scaling cost: New server required
```

#### Neon (Estimated)
```
Compute (3 branches × 0.25 CU × 720h): ~$130/month
Storage (100GB + 20GB deltas): ~$15/month
Branches (3 branches × 720h): ~$22/month
Data transfer: ~$5-20/month

Total: ~$170-190/month (variable)

Note: Can scale-to-zero unused branches
Cost can drop to $50-80/month if branches sleep
```

#### Supabase
```
Primary instance: ~$25-100/month
Branch 1 (persistent): ~$25-100/month
Branch 2 (persistent): ~$25-100/month
Branch 3 (persistent): ~$25-100/month

Total: ~$100-400/month

Note: Preview branches may have different pricing
Schema-only branches are cheaper
```

### 5. Use Case Fit

#### When to Choose BetterPG

✅ **Perfect for:**
- Single-server deployments
- Cost-sensitive projects (no cloud fees)
- Predictable performance requirements
- Full data in branches (not schema-only)
- Local development environments
- Testing with production data copies
- Migration testing workflows
- Geographic distribution not needed

❌ **Not ideal for:**
- Multi-region deployments
- Scale-to-zero requirements
- Serverless architecture
- Global CDN-backed databases
- Teams without Linux/ZFS expertise

#### When to Choose Neon

✅ **Perfect for:**
- Serverless applications
- Variable workloads (scale-to-zero)
- Global distribution needs
- Instant branch requirements
- Point-in-time recovery
- CI/CD with ephemeral databases
- Cost optimization (pay-per-use)

❌ **Not ideal for:**
- Latency-sensitive applications (P99 <10ms)
- Predictable billing requirements
- Air-gapped/on-premise deployments
- Cost ceiling requirements

#### When to Choose Supabase

✅ **Perfect for:**
- Full Supabase ecosystem users (Auth, Storage, etc.)
- Schema-focused branching
- Standard Postgres behavior required
- Complete isolation between environments
- Simple architecture preference

❌ **Not ideal for:**
- Fast branch creation (<1 minute)
- Frequent branching workflows
- Cost-sensitive projects (expensive at scale)
- Data-heavy branches

### 6. Technical Trade-offs

#### BetterPG Trade-offs

**Advantages:**
- ✅ Zero network latency (local filesystem)
- ✅ True copy-on-write at filesystem level
- ✅ Production-safe with pg_backup_start/stop
- ✅ No vendor lock-in
- ✅ Predictable costs (hardware only)
- ✅ Full PostgreSQL compatibility
- ✅ Simple architecture (easier to debug)

**Disadvantages:**
- ❌ **Single server limitation** (biggest constraint)
- ❌ Manual scaling (add more servers)
- ❌ No built-in HA (need to build yourself)
- ❌ Server resources are ceiling
- ❌ No automatic geographic distribution
- ❌ No scale-to-zero
- ❌ Requires ZFS knowledge
- ❌ Linux-only (ZFS limitation)

#### Neon Trade-offs

**Advantages:**
- ✅ Truly instant branching (<1s)
- ✅ Scale-to-zero (huge cost savings)
- ✅ Unlimited storage (S3-backed)
- ✅ Point-in-time recovery built-in
- ✅ Global distribution possible
- ✅ No server management

**Disadvantages:**
- ❌ **Network hop latency** (compute → storage)
- ❌ Higher tail latency (P99 can spike 5-10x)
- ❌ Complex architecture (more failure modes)
- ❌ Vendor lock-in (proprietary storage layer)
- ❌ Cost unpredictability (usage-based billing)
- ❌ Cold start latency (when scaling from zero)
- ❌ No control over infrastructure

#### Supabase Trade-offs

**Advantages:**
- ✅ Complete isolation (true separate instances)
- ✅ Standard Postgres (no custom storage layer)
- ✅ Full Supabase stack per branch
- ✅ Predictable performance
- ✅ Simple architecture

**Disadvantages:**
- ❌ **Slow branch creation** (minutes to hours)
- ❌ **Schema-only by default** (no data copy)
- ❌ High resource overhead (full instances)
- ❌ Expensive at scale (per-instance pricing)
- ❌ Manual data seeding required
- ❌ Not true copy-on-write

### 7. Real-World Scenarios

#### Scenario 1: Migration Testing (100GB Production DB)

**BetterPG:**
```bash
# 3 seconds to create branch
bpg branch prod migration-test

# Test migration
psql -p <port> -f migration.sql

# 1 second to destroy
bpg destroy migration-test

Cost: $0 (included in server)
Total time: ~5 minutes (including migration)
```

**Neon:**
```bash
# <1 second to create branch
neon branches create --name migration-test

# Test migration
psql connection_string -f migration.sql

# Instant destroy
neon branches delete migration-test

Cost: ~$0.50 (0.25 CU × 0.5h + storage)
Total time: ~4 minutes
```

**Supabase:**
```bash
# 10-30 minutes to create branch (migrations)
supabase branches create migration-test

# Manual seed script (10-60 minutes)
supabase db seed migration-test

# Test migration
psql connection_string -f migration.sql

# Destroy
supabase branches delete migration-test

Cost: ~$3-5 (instance hours)
Total time: 30-90 minutes
```

**Winner: Neon** (fastest, instant)
**Runner-up: BetterPG** (fast, free, full data)

#### Scenario 2: 20 Developer Branches (10GB Each)

**BetterPG:**
```
Storage: 10GB + (20 × 100KB) = 10.002GB
Cost: $0 (server handles it)
Performance: Local NVMe (excellent)
Limitation: All on one server

If developers modify 10% each:
Storage: 10GB + (20 × 1GB) = 30GB
```

**Neon:**
```
Storage: 10GB + deltas (~5GB if 10% divergence)
Cost: ~$80/month
  Compute: 20 × 0.25 CU × 40h/month = $80
  Storage: 15GB = ~$2
  Branches: 20 branches × 40h = ~$30
Performance: Network latency present
Scale-to-zero: Can drop to $20 if unused
```

**Supabase:**
```
Storage: 20 × 10GB = 200GB (full copies)
Cost: ~$400-800/month
  Primary: $25/month
  Each branch: $20-40/month
Performance: Standard Postgres
Issue: Expensive, slow creation
```

**Winner: BetterPG** (cost, if single-server acceptable)
**Runner-up: Neon** (if scale-to-zero used)

#### Scenario 3: CI/CD Pipeline (100 PR branches/day)

**BetterPG:**
```
Create: 3s each = 5 minutes total
Storage: Minimal (branches destroyed quickly)
Cost: $0
Limitation: Server CPU/memory limit
```

**Neon:**
```
Create: <1s each = <2 minutes total
Cost: ~$50-100/month
  Ephemeral branches (1h lifetime each)
  Storage minimal (destroyed quickly)
Performance: Excellent for this use case
```

**Supabase:**
```
Create: 10-30 min each = 1000-3000 min total
Cost: Prohibitive ($500-1000/month)
Not practical for high-frequency branching
```

**Winner: Neon** (purpose-built for this)
**Runner-up: BetterPG** (fast enough, free)

### 8. Key Insights

#### The Single Server "Limitation" is Often a Feature

**Why it's actually good:**
- Zero network latency
- No cloud costs
- Full control
- Predictable performance
- Simple architecture

**When it becomes a problem:**
- Team distributed globally
- Need multi-region failover
- Dataset too large for one server
- Compliance requires geographic distribution

#### Storage Efficiency Reality Check

All three use copy-on-write, but at different levels:

1. **BetterPG (Filesystem CoW)**: Most efficient for OS-level operations
2. **Neon (Page-level CoW)**: Efficient for database operations
3. **Supabase (Instance CoW)**: Least efficient, but simplest

**Practical difference**: For typical workloads (10-20% divergence), all are reasonable.

#### Cost Structure Matters

**BetterPG**: Fixed cost (hardware), predictable
**Neon**: Variable cost (usage), can optimize
**Supabase**: Instance-based, scales linearly (expensive)

### 9. Decision Matrix

| Requirement | Best Choice |
|-------------|-------------|
| **Fastest branch creation** | Neon (<1s) |
| **Lowest cost (small scale)** | BetterPG ($0 cloud) |
| **Lowest cost (large scale)** | Neon (scale-to-zero) |
| **Lowest latency** | BetterPG (local) |
| **Global distribution** | Neon |
| **Full data in branches** | BetterPG or Neon |
| **No vendor lock-in** | BetterPG |
| **Simplest architecture** | Supabase |
| **Production-safe** | All (with caveats) |
| **CI/CD integration** | Neon |

### 10. Hybrid Approach

**Best of Both Worlds:**

```
Development: BetterPG
  - Local, fast, free
  - Full data for testing
  - No network dependency

Staging: BetterPG or Neon
  - BetterPG if single region
  - Neon if multi-region

Production: Neon or managed Postgres
  - Neon for serverless
  - Managed Postgres for traditional

CI/CD: Neon
  - Purpose-built for ephemeral branches
  - Cost-effective with scale-to-zero
```

## Conclusion

**BetterPG's "limitations" are trade-offs**, not dealbreakers:

### What BetterPG Sacrifices
- ❌ Multi-region distribution
- ❌ Scale-to-zero
- ❌ Unlimited scaling
- ❌ Cloud-managed infrastructure

### What BetterPG Gains
- ✅ **Zero network latency** (local filesystem)
- ✅ **No cloud costs** (self-hosted)
- ✅ **Full control** (no vendor lock-in)
- ✅ **Predictable performance** (no network variance)
- ✅ **Simple architecture** (easier to debug)
- ✅ **Production-safe** (pg_backup_start/stop)

### The Real Question

**Not "which is better?"** but **"which fits your constraints?"**

- **Need global distribution?** → Neon
- **Need lowest cost at scale?** → Neon (with scale-to-zero)
- **Need full Supabase ecosystem?** → Supabase
- **Need local, fast, predictable, free?** → BetterPG

**For single-server deployments** (which covers most use cases):
- Development/staging environments
- Testing with production data
- Migration testing
- Single-region applications
- Cost-sensitive projects
- Performance-critical applications

**BetterPG is the optimal choice.**

The "single server limitation" only matters if you need geographic distribution or have datasets larger than one server can handle. For everything else, it's a feature.
