# CLI Structure Implementation TODO

## Overview
Restructure CLI to use namespace-based design: `<database>/<branch>` pattern
- Database = "project" or "repo" (like Git repo)
- Branch = branch within a database (like Git branch)
- Every database starts with implicit "main" branch
- All commands require explicit namespace (no magic defaults)

## Target CLI Structure

```
bpg
├── init                                    Initialize system
├── status / ls                             Show all databases and branches
│
├── db                                      Database (repo) management
│   ├── create <name>
│   ├── list
│   ├── get <name>
│   ├── delete <name> [--force]
│   └── rename <old> <new>
│
├── branch                                  Branch management
│   ├── create <db>/<name> [--from <db>/<parent>[@time]]
│   ├── list [<db>]
│   ├── get <db>/<name>
│   ├── delete <db>/<name>
│   ├── rename <db>/<old> <db>/<new>
│   └── sync <db>/<name>
│
└── start/stop/restart <db>/<branch>        Lifecycle management
```

## Implementation Tasks

### Phase 1: Data Model Changes
- [ ] Update state.ts to use namespace model
  - [ ] Database contains implicit "main" branch
  - [ ] All branches use `<database>/<branch>` naming
  - [ ] Update Branch interface to store full namespaced name
- [ ] Update StateManager methods to handle namespaced names
- [ ] Create utility functions for parsing `<database>/<branch>` format
- [ ] Write tests for data model changes

### Phase 2: Command Structure Refactor
- [ ] Update src/index.ts with new Commander.js structure
  - [ ] Add `db` command group with subcommands
  - [ ] Add `branch` command group with subcommands
  - [ ] Update lifecycle commands (start/stop/restart) to require namespace
  - [ ] Update `status`/`ls` commands
  - [ ] Remove old flat commands (create, branch, destroy, reset)
- [ ] Write tests for command parsing

### Phase 3: Database Commands
- [ ] `bpg db create <name>`
  - [ ] Creates database with implicit main branch
  - [ ] Update createCommand to use namespace
  - [ ] Test: Create database, verify main branch exists
- [ ] `bpg db list`
  - [ ] List all databases with branch counts
  - [ ] Update listCommand or create new dbListCommand
  - [ ] Test: List shows correct database info
- [ ] `bpg db get <name>`
  - [ ] Show details for specific database
  - [ ] Create new dbGetCommand
  - [ ] Test: Get shows correct database details
- [ ] `bpg db delete <name>`
  - [ ] Delete database (require --force if branches exist)
  - [ ] Update destroyCommand to handle database deletion
  - [ ] Test: Delete with/without branches
- [ ] `bpg db rename <old> <new>`
  - [ ] Rename database and all its branches
  - [ ] Create new dbRenameCommand
  - [ ] Test: Rename updates all branch namespaces

### Phase 4: Branch Commands
- [ ] `bpg branch create <db>/<name> [--from <db>/<parent>]`
  - [ ] Create branch with namespace
  - [ ] Default parent is `<db>/main`
  - [ ] Update branchCommand to parse namespace
  - [ ] Test: Create branch from main, from other branch
- [ ] `bpg branch list [<db>]`
  - [ ] List all branches or branches for specific database
  - [ ] Update listCommand or create branchListCommand
  - [ ] Test: List all, list for specific database
- [ ] `bpg branch get <db>/<branch>`
  - [ ] Show details for specific branch
  - [ ] Create new branchGetCommand
  - [ ] Test: Get shows correct branch details
- [ ] `bpg branch delete <db>/<branch>`
  - [ ] Delete specific branch
  - [ ] Update destroyCommand to handle branch deletion
  - [ ] Test: Delete branch, cannot delete main
- [ ] `bpg branch rename <db>/<old> <db>/<new>`
  - [ ] Rename branch within database
  - [ ] Create new branchRenameCommand
  - [ ] Test: Rename updates state correctly
- [ ] `bpg branch sync <db>/<branch>`
  - [ ] Sync branch with parent's current state (replaces reset)
  - [ ] Update resetCommand to syncCommand
  - [ ] Take new snapshot of parent, re-clone branch
  - [ ] Test: Sync updates branch to parent's current data

### Phase 5: Lifecycle Commands
- [ ] `bpg start <db>/<branch>`
  - [ ] Update startCommand to parse namespace
  - [ ] Test: Start database main, start branch
- [ ] `bpg stop <db>/<branch>`
  - [ ] Update stopCommand to parse namespace
  - [ ] Test: Stop database main, stop branch
- [ ] `bpg restart <db>/<branch>`
  - [ ] Update restartCommand to parse namespace
  - [ ] Test: Restart database main, restart branch

### Phase 6: Global Commands
- [ ] `bpg status` / `bpg ls`
  - [ ] Show all databases and branches in tree format
  - [ ] Update statusCommand to show hierarchy
  - [ ] Test: Status shows correct tree structure
- [ ] `bpg init`
  - [ ] Keep as-is (no changes needed)
  - [ ] Test: Init still works

### Phase 7: Integration Testing
- [ ] Update scripts/extended-integration-test.sh
  - [ ] Use new namespace syntax throughout
  - [ ] Test all workflows end-to-end
- [ ] Run full test suite
- [ ] Verify all 25+ tests pass

### Phase 8: Documentation
- [ ] Update README.md with new CLI structure
- [ ] Add examples for each command
- [ ] Document migration guide from old CLI

## Commands NOT Implemented Yet (Future)
- [ ] `bpg branch restore <db>/<target> <db>/<source>[@time]` (PITR - not in current system)
- [ ] `bpg db backup <name>` (backup management - future)
- [ ] `bpg branch schema-diff <db>/<branch1> <db>/<branch2>` (schema comparison - future)

## Key Design Principles
1. Always explicit: `api/dev` - no magic defaults
2. Consistent naming: `<database>/<branch>` everywhere
3. Predictable verbs: `create`, `list`, `get`, `delete`, `rename`
4. Modular: Easy to add `db` or `branch` subcommands
5. Clear hierarchy: database > branches
6. Test-driven: Write tests, run tests often

## Migration Notes
- Old `bpg create <name>` → New `bpg db create <name>`
- Old `bpg branch <source> <target>` → New `bpg branch create <db>/<target> --from <db>/<source>`
- Old `bpg list` → New `bpg status` (shows everything) or `bpg branch list` (branches only)
- Old `bpg destroy <name>` → New `bpg db delete <name>` or `bpg branch delete <db>/<branch>`
- Old `bpg reset <branch>` → New `bpg branch sync <db>/<branch>` (improved semantics)
- Old `bpg start <name>` → New `bpg start <db>/<branch>`
