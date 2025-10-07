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

### Phase 1: Data Model Changes ✅ COMPLETE
- [x] Update state.ts to use namespace model
  - [x] Database contains implicit "main" branch
  - [x] All branches use `<database>/<branch>` naming
  - [x] Update Branch interface to store full namespaced name
- [x] Update StateManager methods to handle namespaced names
- [x] Create utility functions for parsing `<database>/<branch>` format
- [x] Write tests for data model changes

### Phase 2: Command Structure Refactor ✅ COMPLETE
- [x] Update src/index.ts with new Commander.js structure
  - [x] Add `db` command group with subcommands
  - [x] Add `branch` command group with subcommands
  - [x] Update lifecycle commands (start/stop/restart) to require namespace
  - [x] Update `status`/`ls` commands
  - [x] Remove old flat commands (create, branch, destroy, reset)
- [x] Write tests for command parsing

### Phase 3: Database Commands ✅ COMPLETE
- [x] `bpg db create <name>`
  - [x] Creates database with implicit main branch
  - [x] Update createCommand to use namespace
  - [x] Test: Create database, verify main branch exists
- [x] `bpg db list`
  - [x] List all databases with branch counts
  - [x] Update listCommand or create new dbListCommand
  - [x] Test: List shows correct database info
- [x] `bpg db get <name>`
  - [x] Show details for specific database
  - [x] Create new dbGetCommand
  - [x] Test: Get shows correct database details
- [x] `bpg db delete <name>`
  - [x] Delete database (require --force if branches exist)
  - [x] Update destroyCommand to handle database deletion
  - [x] Test: Delete with/without branches
- [x] `bpg db rename <old> <new>`
  - [x] Rename database and all its branches
  - [x] Create new dbRenameCommand
  - [x] Test: Rename updates all branch namespaces

### Phase 4: Branch Commands ✅ COMPLETE
- [x] `bpg branch create <db>/<name> [--from <db>/<parent>]`
  - [x] Create branch with namespace
  - [x] Default parent is `<db>/main`
  - [x] Update branchCommand to parse namespace
  - [x] Test: Create branch from main, from other branch
- [x] `bpg branch list [<db>]`
  - [x] List all branches or branches for specific database
  - [x] Update listCommand or create branchListCommand
  - [x] Test: List all, list for specific database
- [x] `bpg branch get <db>/<branch>`
  - [x] Show details for specific branch
  - [x] Create new branchGetCommand
  - [x] Test: Get shows correct branch details
- [x] `bpg branch delete <db>/<branch>`
  - [x] Delete specific branch
  - [x] Update destroyCommand to handle branch deletion
  - [x] Test: Delete branch, cannot delete main
- [x] `bpg branch rename <db>/<old> <db>/<new>`
  - [x] Rename branch within database
  - [x] Create new branchRenameCommand
  - [x] Test: Rename updates state correctly
- [ ] `bpg branch sync <db>/<branch>` **TODO**
  - [ ] Sync branch with parent's current state (replaces reset)
  - [ ] Update resetCommand to syncCommand
  - [ ] Take new snapshot of parent, re-clone branch
  - [ ] Test: Sync updates branch to parent's current data

### Phase 5: Lifecycle Commands ✅ COMPLETE
- [x] `bpg start <db>/<branch>`
  - [x] Update startCommand to parse namespace
  - [x] Test: Start database main, start branch
- [x] `bpg stop <db>/<branch>`
  - [x] Update stopCommand to parse namespace
  - [x] Test: Stop database main, stop branch
- [x] `bpg restart <db>/<branch>`
  - [x] Update restartCommand to parse namespace
  - [x] Test: Restart database main, restart branch

### Phase 6: Global Commands ✅ COMPLETE
- [x] `bpg status` / `bpg ls`
  - [x] Show all databases and branches in tree format
  - [x] Update statusCommand to show hierarchy
  - [x] Test: Status shows correct tree structure
- [x] `bpg init`
  - [x] Keep as-is (no changes needed)
  - [x] Test: Init still works

### Phase 7: Integration Testing ✅ COMPLETE
- [x] Update scripts/extended-integration-test.sh
  - [x] Use new namespace syntax throughout
  - [x] Test all workflows end-to-end
- [x] Run full test suite
- [x] Verify all 21 tests pass

### Phase 8: Documentation 🚧 IN PROGRESS
- [x] Create CLAUDE.md with architecture documentation
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
