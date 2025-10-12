# Test Infrastructure Improvements

Quality-of-life enhancements to make tests more robust, comprehensive, easy, and simple.

## ✅ Completed

### #1: Smart Wait Strategies (DONE)
**Status:** Completed - Commit 6996cd5

Replaced ~50 hardcoded `Bun.sleep()` calls with intelligent polling-based wait helpers.

**Results:**
- ⚡ Tests 70% faster (2-3 min vs 10 min)
- 🎯 More reliable - actually verify readiness instead of hoping
- 🔧 Created `tests/helpers/wait.ts` with hybrid approach:
  - High-level: `waitForProjectReady()`, `waitForBranchReady()`
  - Low-level: `waitForContainer()`, `waitForContainerStopped()`, `waitForDataset()`

**Example:**
```typescript
// Before
await branchCreateCommand('test/dev', {});
await Bun.sleep(3000); // Hope it's ready? 🤷

// After
await branchCreateCommand('test/dev', {});
await waitForBranchReady('test', 'dev'); // Actually verify! ✅
```

---

## 🔴 High Priority (Do Next)

### #2: Create Test Fixtures/Factories ⭐
**Impact:** High - Eliminates repetitive setup code across all test files

**Problem:** Every test manually creates projects/branches with lots of boilerplate
```typescript
// Current - repeated 50+ times across tests
await projectCreateCommand('test', {});
await waitForProjectReady('test');
const creds = await getProjectCredentials('test');
const port = await getBranchPort('test/main');
```

**Solution:**
```typescript
// tests/fixtures/project.ts
export async function createTestProject(name: string, options = {}) {
  await projectCreateCommand(name, options);
  await waitForProjectReady(name);
  const creds = await getProjectCredentials(name);
  const port = await getBranchPort(`${name}/main`);
  return { name, creds, port };
}

export async function createTestBranch(projectName: string, branchName: string) {
  const fullName = `${projectName}/${branchName}`;
  await branchCreateCommand(fullName, {});
  await waitForBranchReady(projectName, branchName);
  const port = await getBranchPort(fullName);
  return { name: fullName, port };
}

// Usage - clean and DRY!
const project = await createTestProject('test-api');
const branch = await createTestBranch('test-api', 'dev');
```

**Files to Update:** All 11 test files would benefit

---

### #3: Add Custom Matchers for Domain Assertions ⭐
**Impact:** High - Makes tests more readable and domain-specific

**Problem:** Generic expect assertions don't express domain concepts clearly
```typescript
// Current - what does this really test?
expect(await isContainerRunning('test-dev')).toBe(true);
```

**Solution:**
```typescript
// tests/helpers/matchers.ts
import { expect } from 'bun:test';

expect.extend({
  async toHaveRunningContainer(name: string) {
    const running = await isContainerRunning(name);
    return {
      pass: running,
      message: () => `Expected container ${name} to be ${running ? 'stopped' : 'running'}`,
    };
  },

  async toHaveDataset(name: string) {
    const exists = await datasetExists(name);
    return {
      pass: exists,
      message: () => `Expected dataset ${name} to ${exists ? 'not exist' : 'exist'}`,
    };
  },

  async toHaveBranchInState(projectName: string, branchName: string) {
    const state = await getState();
    const project = state.projects?.find(p => p.name === projectName);
    const branch = project?.branches?.find(b => b.name === `${projectName}/${branchName}`);
    return {
      pass: !!branch,
      message: () => `Expected branch ${projectName}/${branchName} in state`,
    };
  },
});

// Usage - reads like English!
await expect('test-dev').toHaveRunningContainer();
await expect('test-dev').toHaveDataset();
await expect('test-api').toHaveBranchInState('dev');
```

---

### #4: Centralize Timeout Configuration
**Impact:** Medium - Makes timeout tuning easier, more consistent

**Problem:** Timeouts scattered across test files, hard to adjust globally

**Solution:**
```typescript
// tests/helpers/timeouts.ts
export const TEST_TIMEOUTS = {
  // Container operations
  CONTAINER_START: 30_000,
  CONTAINER_STOP: 10_000,

  // PostgreSQL operations
  POSTGRES_READY: 60_000,

  // Branch operations
  BRANCH_CREATE: 30_000,
  BRANCH_DELETE: 15_000,
  BRANCH_RESET: 60_000,

  // Advanced operations
  PITR_RECOVERY: 180_000,
  SNAPSHOT_CREATE: 15_000,
  WAL_ARCHIVE: 60_000,
} as const;

// Usage in test definitions
test('should create branch', async () => {
  await branchCreateCommand('test/dev', {});
  await waitForBranchReady('test', 'dev');
}, { timeout: TEST_TIMEOUTS.BRANCH_CREATE });
```

**Note:** Partially done in `wait.ts` - extend to test-level timeouts

---

### #5: Test Data Builders for Complex Scenarios
**Impact:** Medium - Simplifies complex database setup

**Problem:** Complex data setup is verbose and hard to read
```typescript
// Current - messy inline setup
await query(port, password, 'CREATE TABLE users (id SERIAL, name TEXT)');
await query(port, password, "INSERT INTO users VALUES (1, 'Alice')");
await query(port, password, "INSERT INTO users VALUES (2, 'Bob')");
await query(port, password, 'CREATE TABLE posts (id SERIAL, user_id INT, title TEXT)');
// ... 20 more lines
```

**Solution:**
```typescript
// tests/builders/database.ts
export class DatabaseBuilder {
  private tables: Array<{ name: string; schema: string }> = [];
  private data: Array<{ table: string; rows: any[] }> = [];

  withTable(name: string, schema: string) {
    this.tables.push({ name, schema });
    return this;
  }

  withData(table: string, rows: any[]) {
    this.data.push({ table, rows });
    return this;
  }

  async build(port: string, password: string) {
    // Execute all DDL
    for (const { name, schema } of this.tables) {
      await query(port, password, schema);
    }
    // Execute all DML
    for (const { table, rows } of this.data) {
      for (const row of rows) {
        const cols = Object.keys(row).join(', ');
        const vals = Object.values(row).map(v => `'${v}'`).join(', ');
        await query(port, password, `INSERT INTO ${table} (${cols}) VALUES (${vals})`);
      }
    }
  }
}

// Usage - fluent, readable!
await new DatabaseBuilder()
  .withTable('users', 'CREATE TABLE users (id SERIAL, name TEXT)')
  .withTable('posts', 'CREATE TABLE posts (id SERIAL, user_id INT, title TEXT)')
  .withData('users', [{ name: 'Alice' }, { name: 'Bob' }])
  .withData('posts', [{ user_id: 1, title: 'Hello' }])
  .build(port, password);
```

---

### #6: Replace Global State with Test Context
**Impact:** Medium - Less magic, more explicit

**Problem:** Tests use `globalThis` for state passing - hard to track
```typescript
// Current - in tests/pitr.test.ts
globalThis.recoveryTimestamp = timestamp; // Magic! Where does this go?
```

**Solution:**
```typescript
// tests/helpers/context.ts
export class TestContext {
  private data = new Map<string, any>();

  set(key: string, value: any) {
    this.data.set(key, value);
  }

  get<T>(key: string): T {
    return this.data.get(key);
  }

  clear() {
    this.data.clear();
  }

  has(key: string): boolean {
    return this.data.has(key);
  }
}

// Usage in tests
const ctx = new TestContext();
ctx.set('recoveryTimestamp', timestamp);
// Later:
const timestamp = ctx.get<string>('recoveryTimestamp');
```

---

## 🟡 Medium Priority

### #7: Add Test Coverage Reporting
**Impact:** Medium - Visibility into test coverage gaps

```typescript
// bunfig.toml
[test]
coverage = true
coverageThreshold = 80
coverageDir = "./coverage"

// package.json
"scripts": {
  "test:coverage": "./scripts/test.sh && bun test --coverage",
  "test:coverage:html": "bun test --coverage --coverage-reporter=html"
}
```

---

### #8: Test Categorization with Tags
**Impact:** Medium - Faster feedback loop for unit vs integration tests

```typescript
// Fast tests (unit-style, no real containers)
test.only.if(process.env.FAST_TESTS)('should parse namespace', async () => {
  expect(parseNamespace('api/dev')).toEqual({ project: 'api', branch: 'dev' });
});

// Integration tests (requires Docker, ZFS)
test.skipIf(process.env.FAST_TESTS)('should create branch', async () => {
  await branchCreateCommand('test/dev', {});
});

// Usage:
// FAST_TESTS=1 bun test  // Run only fast tests (~10 seconds)
// bun test               // Run all tests (~3 minutes)
```

---

### #9: Snapshot Testing for State Validation
**Impact:** Low-Medium - Easier state validation

```typescript
// Instead of manual assertions:
const state = await getState();
expect(state.projects[0].name).toBe('test');
expect(state.projects[0].branches.length).toBe(2);
expect(state.projects[0].branches[0].name).toBe('test/main');

// Use snapshots:
const state = await getState();
expect(state).toMatchSnapshot();
```

---

### #10: Better Cleanup with Guaranteed Teardown
**Impact:** Medium - Prevents test pollution

```typescript
// tests/helpers/cleanup.ts
export class TestResource {
  private cleanupFns: Array<() => Promise<void>> = [];

  async add(cleanup: () => Promise<void>) {
    this.cleanupFns.push(cleanup);
  }

  async cleanupAll() {
    // Run in reverse order (LIFO)
    for (const fn of this.cleanupFns.reverse()) {
      try {
        await fn();
      } catch (e) {
        console.warn('Cleanup failed:', e);
      }
    }
  }
}

// Usage:
const resources = new TestResource();
afterAll(() => resources.cleanupAll());

test('test', async () => {
  const project = await createTestProject('test');
  resources.add(async () => projectDeleteCommand('test', {}));

  const branch = await createTestBranch('test', 'dev');
  resources.add(async () => branchDeleteCommand('test/dev'));

  // Test code - cleanup happens automatically even if test fails
});
```

---

## 🟢 Nice-to-Have

### #11: Test Performance Tracking
Track slow tests automatically:

```typescript
// tests/helpers/performance.ts
export function trackPerformance() {
  const timings: Record<string, number> = {};

  return {
    start(name: string) {
      timings[name] = Date.now();
    },

    end(name: string) {
      const duration = Date.now() - timings[name];
      if (duration > 5000) {
        console.warn(`⚠️  ${name} took ${duration}ms`);
      }
      return duration;
    },
  };
}
```

---

### #12: Test Retry Mechanism for Flaky Tests
```typescript
// tests/helpers/retry.ts
export async function retryTest<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1000
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === attempts - 1) throw e;
      await Bun.sleep(delayMs);
    }
  }
  throw new Error('Unreachable');
}

// Usage:
await retryTest(async () => {
  await ensureWALArchived(port, password, dataset);
});
```

---

### #13: Docker Health Check Helper
```typescript
// tests/helpers/docker.ts
export async function waitForHealthy(containerName: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const proc = spawn(['docker', 'inspect', containerName, '--format={{.State.Health.Status}}']);
    const output = await new Response(proc.stdout).text();
    if (output.trim() === 'healthy') return;
    await Bun.sleep(1000);
  }
  throw new Error(`Container ${containerName} not healthy after ${timeoutMs}ms`);
}
```

---

### #14: Test Documentation
Create `tests/README.md` with guidelines:
- How to run tests
- How to write new tests
- Best practices
- Common patterns

---

### #15: Parallel Test Execution Within Suites
Some tests can run concurrently if they use different project names:

```typescript
// tests/parallel.test.ts
describe('Parallel safe tests', () => {
  test.concurrent('create project 1', async () => {
    await createTestProject('parallel-1');
  });

  test.concurrent('create project 2', async () => {
    await createTestProject('parallel-2');
  });

  test.concurrent('create project 3', async () => {
    await createTestProject('parallel-3');
  });
});
```

---

## 📋 Implementation Priority

**Week 1:** Fixtures (#2), Custom Matchers (#3), Timeout Config (#4)
**Week 2:** Data Builders (#5), Test Context (#6), Better Cleanup (#10)
**Week 3:** Coverage (#7), Test Tags (#8), Snapshot Testing (#9)
**Week 4:** Performance Tracking (#11), Retry Mechanism (#12), Docs (#14)

---

## Summary

These improvements would dramatically:
- ✅ Reduce test flakiness
- ✅ Improve maintainability
- ✅ Make tests easier to write
- ✅ Provide better debugging information
- ✅ Speed up development feedback loops

**Current Status:** 71/71 tests passing, ~3 minutes runtime (70% faster than before!)
