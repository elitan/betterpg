# Testing betterpg

Since betterpg requires ZFS (Linux-only), testing on macOS requires a Linux environment. This guide explains how to set up and test betterpg.

## Option 1: VPS Testing (Recommended)

### 1. Get a VPS

Choose any provider with Ubuntu 22.04 or 24.04:

- **Hetzner Cloud**: €4/month - [hetzner.com](https://www.hetzner.com/cloud)
- **DigitalOcean**: $6/month - [digitalocean.com](https://www.digitalocean.com/)
- **Vultr**: $6/month - [vultr.com](https://www.vultr.com/)
- **Linode**: $5/month - [linode.com](https://www.linode.com/)

**Requirements:**
- Ubuntu 22.04 or 24.04
- At least 2GB RAM
- At least 10GB disk space

### 2. Set Up the VPS

SSH into your VPS:

```bash
ssh root@your-vps-ip
```

Download and run the setup script:

```bash
wget https://raw.githubusercontent.com/elitan/betterpg/main/scripts/vps-setup.sh
chmod +x vps-setup.sh
./vps-setup.sh
```

This script will:
- Install ZFS
- Install Docker
- Install Bun
- Create a test ZFS pool
- Set up directories

### 3. Clone and Build

```bash
git clone https://github.com/elitan/betterpg.git
cd betterpg
bun install
bun run build
```

### 4. Run Integration Tests

```bash
./scripts/integration-test.sh
```

This will test:
- ✅ Initialization
- ✅ Database creation
- ✅ Database connectivity
- ✅ Branch creation from snapshots
- ✅ Data isolation between branches
- ✅ ZFS copy-on-write efficiency
- ✅ Resource cleanup

### 5. Manual Testing

After the automated tests pass, you can manually test:

```bash
# Initialize
sudo ./dist/bpg init

# Create a database
sudo ./dist/bpg create myapp-prod

# Connect and add data
PGPASSWORD=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].credentials.password')
PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].port')

psql -h localhost -p $PORT -U postgres <<EOF
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');
EOF

# Create a branch
sudo ./dist/bpg branch myapp-prod myapp-dev

# List everything
sudo ./dist/bpg list

# Verify branch isolation
DEV_PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].branches[0].port')
psql -h localhost -p $DEV_PORT -U postgres -c "INSERT INTO users (name) VALUES ('Dev User');"

# Check that prod still has 3 users, dev has 4
psql -h localhost -p $PORT -U postgres -c "SELECT COUNT(*) FROM users;"      # Should be 3
psql -h localhost -p $DEV_PORT -U postgres -c "SELECT COUNT(*) FROM users;"  # Should be 4

# Clean up
sudo ./dist/bpg destroy myapp-dev
sudo ./dist/bpg destroy myapp-prod
```

## Option 2: GitHub Actions (CI/CD)

For automated testing on every commit, we can set up GitHub Actions. The workflow will:
1. Spin up an Ubuntu runner
2. Install ZFS and dependencies
3. Run integration tests
4. Report results

See `.github/workflows/test.yml` for the configuration.

## Option 3: Local VM (Advanced)

If you want to test locally without a VPS, you can use:

### Multipass (Easy)

```bash
# Install Multipass
brew install multipass

# Create Ubuntu VM
multipass launch 22.04 --name betterpg-test --cpus 2 --memory 2G --disk 20G

# Mount local directory
multipass mount $(pwd) betterpg-test:/home/ubuntu/betterpg

# Shell into VM
multipass shell betterpg-test

# Run setup script
cd /home/ubuntu/betterpg
./scripts/vps-setup.sh

# Run tests
./scripts/integration-test.sh
```

### Lima (Alternative)

```bash
# Install Lima
brew install lima

# Create Ubuntu VM
limactl start --name=betterpg template://ubuntu-lts

# Shell into VM
lima betterpg

# Follow VPS setup instructions
```

## Troubleshooting

### ZFS Module Not Loaded

```bash
sudo modprobe zfs
```

### Docker Permission Denied

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### PostgreSQL Not Responding

Check container logs:
```bash
docker logs bpg-<database-name>
```

Check ZFS dataset is mounted:
```bash
zfs list
zfs get mountpoint tank/betterpg/databases/<database-name>
```

## Development Workflow

1. **Code on macOS** - Use your regular editor/IDE
2. **Push to git** - Commit and push changes
3. **Pull on VPS** - `git pull` on the VPS
4. **Rebuild** - `bun run build`
5. **Test** - Run integration tests or manual tests
6. **Iterate** - Repeat

## Performance Testing

To test with larger datasets:

```bash
# Create database
sudo ./dist/bpg create perf-test

# Load sample data (100k rows)
PGPASSWORD=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].credentials.password')
PORT=$(cat /var/lib/betterpg/state.json | jq -r '.databases[0].port')

psql -h localhost -p $PORT -U postgres <<EOF
CREATE TABLE large_table (
  id SERIAL PRIMARY KEY,
  data TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO large_table (data)
SELECT md5(random()::text)
FROM generate_series(1, 100000);
EOF

# Check size
sudo zfs list tank/betterpg/databases/perf-test

# Create branch (should be instant)
time sudo ./dist/bpg branch perf-test perf-test-branch

# Check branch size (should be minimal)
sudo zfs list tank/betterpg/databases/perf-test-branch
```

## Next Steps

Once basic testing works:
1. Add more commands (start, stop, reset, etc.)
2. Add backup/restore functionality
3. Add point-in-time recovery
4. Add performance benchmarks
5. Set up CI/CD with GitHub Actions
