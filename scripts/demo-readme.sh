#!/bin/bash
# Demo script for README - captures real pgd output
# Run this on a Linux machine with pgd installed

set -e

echo "=== Creating project ==="
pgd project create demo

# Get credentials from state file
STATE_FILE="$HOME/.local/share/pgd/state.json"
PASSWORD=$(cat "$STATE_FILE" | grep -A 5 '"name": "demo"' | grep '"password"' | cut -d'"' -f4)

echo ""
echo "=== Getting connection info ==="
pgd status

echo ""
echo "=== Adding data to main branch ==="
MAIN_PORT=$(pgd status | grep "demo/main" | grep -o 'Port [0-9]*' | grep -o '[0-9]*')

echo "Using main port: $MAIN_PORT"
export PGPASSWORD="$PASSWORD"
psql -h localhost -p "$MAIN_PORT" -U postgres << EOF
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');
SELECT * FROM users;
EOF

echo ""
echo "=== Creating branch (watch the timing) ==="
pgd branch create demo/dev

echo ""
echo "=== Getting updated status ==="
pgd status

echo ""
echo "=== Making changes in dev branch ==="
DEV_PORT=$(pgd status | grep "demo/dev" | grep -o 'Port [0-9]*' | grep -o '[0-9]*')

echo "Using dev port: $DEV_PORT"
psql -h localhost -p "$DEV_PORT" -U postgres << EOF
INSERT INTO users (name) VALUES ('Dave'), ('Eve');
DELETE FROM users WHERE name = 'Bob';
SELECT * FROM users;
EOF

echo ""
echo "=== Comparing main vs dev (isolation proof) ==="
echo "--- Main branch (demo/main on port $MAIN_PORT) ---"
psql -h localhost -p "$MAIN_PORT" -U postgres -c "SELECT * FROM users;"

echo ""
echo "--- Dev branch (demo/dev on port $DEV_PORT) ---"
psql -h localhost -p "$DEV_PORT" -U postgres -c "SELECT * FROM users;"

echo ""
echo "=== Syncing dev branch back to main ==="
pgd branch sync demo/dev

echo ""
echo "=== After sync - dev matches main again ==="
# Re-fetch dev port in case container was recreated
DEV_PORT=$(pgd status | grep "demo/dev" | grep -o 'Port [0-9]*' | grep -o '[0-9]*')
psql -h localhost -p "$DEV_PORT" -U postgres -c "SELECT * FROM users;"

echo ""
echo "=== Cleanup ==="
pgd project delete demo --force

echo ""
echo "=== Demo complete! ==="
