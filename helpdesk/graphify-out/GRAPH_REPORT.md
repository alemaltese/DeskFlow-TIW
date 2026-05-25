# Graph Report - .  (2026-05-25)

## Corpus Check
- Corpus is ~4,165 words - fits in a single context window. You may not need a graph.

## Summary
- 95 nodes · 95 edges · 9 communities (8 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Operator Route Handlers|Operator Route Handlers]]
- [[_COMMUNITY_User Ticket Routes|User Ticket Routes]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_Express Server Setup|Express Server Setup]]
- [[_COMMUNITY_Database Schema Init|Database Schema Init]]
- [[_COMMUNITY_Database Seeding|Database Seeding]]
- [[_COMMUNITY_NPM Scripts|NPM Scripts]]
- [[_COMMUNITY_Database Singleton|Database Singleton]]
- [[_COMMUNITY_Auth Middleware|Auth Middleware]]

## God Nodes (most connected - your core abstractions)
1. `scripts` - 5 edges
2. `engines` - 2 edges
3. `requireUtente()` - 2 edges
4. `requireOperatore()` - 2 edges
5. `main` - 1 edges
6. `dev` - 1 edges
7. `db:init` - 1 edges
8. `seed` - 1 edges
9. `express` - 1 edges
10. `express-handlebars` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (9 total, 1 thin omitted)

### Community 0 - "Operator Route Handlers"
Cohesion: 0.08
Nodes (23): activeTickets, avgRow, bcrypt, comments, conditions, counts, db, dbUser (+15 more)

### Community 1 - "User Ticket Routes"
Cohesion: 0.10
Nodes (19): bcrypt, CATEGORIES, comments, db, dbUser, errors, existing, express (+11 more)

### Community 2 - "Project Dependencies"
Cohesion: 0.15
Nodes (12): dependencies, bcrypt, better-sqlite3, express, express-handlebars, express-session, engines, node (+4 more)

### Community 3 - "Express Server Setup"
Cohesion: 0.18
Nodes (7): app, { engine }, express, operatoreRouter, path, session, ticketsRouter

### Community 4 - "Database Schema Init"
Cohesion: 0.29
Nodes (6): createTables, Database, dataDir, db, fs, path

### Community 5 - "Database Seeding"
Cohesion: 0.29
Nodes (5): bcrypt, Database, db, path, seed

### Community 6 - "NPM Scripts"
Cohesion: 0.40
Nodes (5): scripts, db:init, dev, seed, start

### Community 7 - "Database Singleton"
Cohesion: 0.50
Nodes (3): Database, db, path

## Knowledge Gaps
- **77 isolated node(s):** `name`, `version`, `type`, `main`, `start` (+72 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scripts` connect `NPM Scripts` to `Project Dependencies`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _77 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Operator Route Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `User Ticket Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._