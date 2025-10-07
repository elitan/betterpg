#!/bin/bash
# Test stale lock detection and recovery

set -e

BPG="./dist/bpg"
LOCK_FILE="/var/lib/betterpg/state.json.lock"

echo "🧪 Testing stale lock detection and recovery"
echo ""

# Test 1: Create a stale lock with a dead PID
echo "Test 1: Creating stale lock with non-existent PID..."

# Find a PID that doesn't exist (use a very high number)
FAKE_PID=999999
while kill -0 $FAKE_PID 2>/dev/null; do
    FAKE_PID=$((FAKE_PID + 1))
done

echo "  Using fake PID: $FAKE_PID"
echo "$FAKE_PID" | sudo tee $LOCK_FILE > /dev/null

if [ -f "$LOCK_FILE" ]; then
    echo "  ✓ Stale lock file created"
else
    echo "  ✗ Failed to create lock file"
    exit 1
fi

# Test 2: Run a command that requires state lock
echo ""
echo "Test 2: Running command with stale lock present..."
echo "  (Should automatically detect and remove stale lock)"

# This should succeed by removing the stale lock
$BPG status > /dev/null 2>&1

if [ ! -f "$LOCK_FILE" ]; then
    echo "  ✓ Stale lock was automatically removed"
else
    echo "  ✗ Stale lock still exists"
    sudo rm -f $LOCK_FILE
    exit 1
fi

echo "  ✓ Command completed successfully"

# Test 3: Verify lock is properly created and released
echo ""
echo "Test 3: Verifying normal lock behavior..."

# Start a command in background that will hold lock briefly
$BPG status > /dev/null 2>&1 &
CMD_PID=$!

# Give it a moment to acquire lock
sleep 0.2

# Check if lock exists while command is running
if [ -f "$LOCK_FILE" ]; then
    LOCK_PID=$(cat $LOCK_FILE)
    echo "  ✓ Lock created with PID: $LOCK_PID"
else
    echo "  ⚠  Lock file not found (command may have completed too quickly)"
fi

# Wait for command to complete
wait $CMD_PID

# Verify lock is released
sleep 0.1
if [ ! -f "$LOCK_FILE" ]; then
    echo "  ✓ Lock properly released after command completion"
else
    echo "  ✗ Lock not released"
    sudo rm -f $LOCK_FILE
    exit 1
fi

echo ""
echo "✅ All stale lock tests passed!"
echo "   - Stale locks are automatically detected"
echo "   - Dead process locks are removed"
echo "   - Normal lock acquisition/release works"
