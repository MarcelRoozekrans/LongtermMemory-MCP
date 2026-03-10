## [1.1.3](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/compare/v1.1.2...v1.1.3) (2026-03-07)


### Bug Fixes

* **release:** include .claude-plugin files in semantic-release versioning ([bffc579](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/bffc579c8d256226482948ba2df270580f1828e1))

## [1.2.0](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/compare/longterm-memory-mcp-v1.1.1...longterm-memory-mcp-v1.2.0) (2026-03-09)


### Features

* add BackupManager with auto-backup, JSON export, and pruning ([5c73822](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/5c73822c88eb28a9ef7ff1595912d060f0af457a))
* add Claude Code marketplace plugin with long-term-memory skill ([928b342](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/928b34291847621383116a9c97fdc3f1b9332636))
* add Claude Code marketplace plugin with long-term-memory skill ([b530582](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/b53058243bf7fcb3ee7e2e27b750a7473695b67e))
* add DecayEngine with lazy decay and reinforcement, integrate into MemoryStore ([b51e002](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/b51e002503ca3bd547fdc2336b6604db5ee7543e))
* add schema version migration to prevent startup crashes ([f8a7bb9](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/f8a7bb91699322d1285e03fe0b65d346c9d625e7))
* add schema with tags, importance, memoryType, contentHash, dedup ([cf1f909](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/cf1f909ad773dce702b7518238f94480f9c40fc4))
* add searchByType, searchByTags, searchByDateRange methods ([194a066](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/194a0663a820720e1d7b8d6c2c90809d89e45ca4))
* add update_memory, search_by_type, search_by_tags, search_by_date_range, create_backup tools ([28c963d](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/28c963dc0a5425c23b1c67ba02e35796a0c61c5a))
* initial project setup for longterm memory MCP server ([337508a](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/337508a17716b99b288d92f1817b9e7f7ee068bc))
* memory enhancements — dedup, decay, structured search, backups ([dbb5e67](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/dbb5e672a39fa5db74dc026c0a8b119e99486667))
* schema migration + migrate to release-please ([7e20bc4](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/7e20bc4f0a1caf9e6d29723297a1010a1bc6780b))


### Bug Fixes

* align skill dedup guidance with update_memory and server behavior ([2c772a8](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/2c772a83fe43b5216ee076192143e6883a87adba))
* align skill dedup guidance with update_memory and server behavior ([43e26ed](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/43e26ed443a28da8d3681fbd947612d44af015a6))
* **ci:** use SSH repositoryUrl so semantic-release pushes via deploy key ([bd07264](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/bd07264a529aa4e5076b94b34e715d21ecc713e9))
* configure npm OIDC trusted publishing for release workflow ([dbe5086](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/dbe5086db7ffffac796a465b6e4c302130c5b916))
* correct semantic-release plugin ordering and add workflow_dispatch ([dd16c1c](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/dd16c1c84efc23cbd10fa5a9eb8e75bf5efb46f2))
* **release:** include .claude-plugin files in semantic-release versioning ([bffc579](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/bffc579c8d256226482948ba2df270580f1828e1))
* restore Claude Code-specific sections in SKILL.md ([5cf48ce](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/5cf48ce1b9a81654218dc77afb3dc58ed0795b8e))
* use deploy key for semantic-release git push ([e99fe99](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/e99fe99180503122c377e3502aaceedd73465b00))

## [1.1.2](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/compare/v1.1.1...v1.1.2) (2026-03-06)


### Bug Fixes

* **ci:** use SSH repositoryUrl so semantic-release pushes via deploy key ([bd07264](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/bd07264a529aa4e5076b94b34e715d21ecc713e9))
* correct semantic-release plugin ordering and add workflow_dispatch ([dd16c1c](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/dd16c1c84efc23cbd10fa5a9eb8e75bf5efb46f2))
* restore Claude Code-specific sections in SKILL.md ([5cf48ce](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/5cf48ce1b9a81654218dc77afb3dc58ed0795b8e))
* use deploy key for semantic-release git push ([e99fe99](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/e99fe99180503122c377e3502aaceedd73465b00))

## [1.1.1](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/compare/v1.1.0...v1.1.1) (2026-02-28)


### Bug Fixes

* align skill dedup guidance with update_memory and server behavior ([43e26ed](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/43e26ed443a28da8d3681fbd947612d44af015a6))

# [1.1.0](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/compare/v1.0.0...v1.1.0) (2026-02-28)


### Features

* add Claude Code marketplace plugin with long-term-memory skill ([b530582](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/b53058243bf7fcb3ee7e2e27b750a7473695b67e))

# 1.0.0 (2026-02-28)


### Bug Fixes

* configure npm OIDC trusted publishing for release workflow ([dbe5086](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/dbe5086db7ffffac796a465b6e4c302130c5b916))


### Features

* add BackupManager with auto-backup, JSON export, and pruning ([5c73822](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/5c73822c88eb28a9ef7ff1595912d060f0af457a))
* add DecayEngine with lazy decay and reinforcement, integrate into MemoryStore ([b51e002](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/b51e002503ca3bd547fdc2336b6604db5ee7543e))
* add schema with tags, importance, memoryType, contentHash, dedup ([cf1f909](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/cf1f909ad773dce702b7518238f94480f9c40fc4))
* add searchByType, searchByTags, searchByDateRange methods ([194a066](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/194a0663a820720e1d7b8d6c2c90809d89e45ca4))
* add update_memory, search_by_type, search_by_tags, search_by_date_range, create_backup tools ([28c963d](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/28c963dc0a5425c23b1c67ba02e35796a0c61c5a))
* initial project setup for longterm memory MCP server ([337508a](https://github.com/MarcelRoozekrans/LongtermMemory-MCP/commit/337508a17716b99b288d92f1817b9e7f7ee068bc))
