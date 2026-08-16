# Faculty Availability & Intelligent Appointment Scheduling System

An Advanced SQL and Modern Database Features project (5th semester, SRM Institute of Science and Technology) that replaces the ad-hoc "walk to the staff room and hope they're free" process with a web-based appointment scheduling system. Students search a faculty member's real availability, request a slot with a reason, and wait for faculty approval; faculty manage availability, review requests, and track appointment history. The database is treated as a core correctness component rather than passive storage — appointment overlap prevention, availability computation, and transaction/concurrency correctness are implemented as PostgreSQL constraints, functions, and triggers, not re-implemented in application code.

## Architecture overview

```
Controller (not yet implemented)
      ↓  HTTP concerns, request/response, auth extraction, boundary validation
Service        — src/services/appointment.service.ts
      ↓            business rules, ownership, state transitions, orchestration
Repository      — src/repositories/appointment.repository.ts
      ↓            the only class that executes appointment SQL
PostgreSQL      — services/api/migrations/sql/000*.sql
                   final integrity authority: constraints, triggers, transactions,
                   exclusion constraints, stored functions
```

Database access is intentionally hybrid: ordinary CRUD can use an ORM, but exclusion constraints, CTE-heavy availability queries, window-function reporting, and stored functions are written and tested as raw SQL, since demonstrating those features directly is the point of this project.

## Technology stack

- PostgreSQL 16+ (extensions: `btree_gist`) — developed and fully verified on 16; a real run on 18 surfaced version-specific test-design bugs (see `docs/DEVELOPMENT_HANDOFF.md`), now fixed but not yet re-confirmed on 18
- Node.js + TypeScript
- `pg` (node-postgres) for direct SQL where Advanced SQL features require it
- Jest + `ts-jest` for testing, with dedicated projects for unit, integration, concurrency, security, advanced-SQL, performance, and failure-injection tests

## Current implementation status

Backend/database core: implemented and tested (schema, booking with availability enforcement, double-booking and availability-overlap protection, guarded status transitions, audit logging, views, materialized view, database session timezone pinned to `Asia/Kolkata`, 200 tests actually executed and passing with verified exit codes, fully re-verified on PostgreSQL 16). No HTTP layer, authentication, notification dispatch, or frontend exists yet. See `docs/IMPLEMENTATION_STATUS.md` for the full component-by-component table and `docs/DEVELOPMENT_HANDOFF.md` for exact test results, including the "Timezone: why this exists" section (read that before assuming this app is portable across machines without migration 0008), a real PostgreSQL-deadlock concurrency gap found and fixed through repeated stress-testing, and the current PostgreSQL 18 re-confirmation status.

## Local setup

```bash
cd services/api
npm install
cp .env.example .env   # adjust if your local PostgreSQL differs from the defaults
service postgresql start
createdb -U postgres faculty_scheduling
for f in migrations/sql/0*.sql; do psql -U postgres -d faculty_scheduling -f "$f"; done
psql -U postgres -d faculty_scheduling -f migrations/sql/seed_test_data.sql
psql -U postgres -d faculty_scheduling -f migrations/sql/seed_availability_test_data.sql
```

Full details, including the honest note that migrations are currently applied by hand (no runner script exists yet), are in `docs/DEVELOPMENT_HANDOFF.md`.

## Testing

```bash
cd services/api
npm test                          # 188 tests: unit, integration, concurrency, security, advanced-SQL
npm run test:performance          # 5 tests: real measurements against real PostgreSQL
npm run test:failure-injection    # 7 tests: run in isolation — stops/restarts real PostgreSQL
```

All database-dependent behavior (constraints, triggers, transactions, concurrency, stored functions, indexes) is tested against a real PostgreSQL 16 instance, never mocked. `test:failure-injection` has a Windows-specific note (default PostgreSQL service name, admin terminal requirement) in `docs/DEVELOPMENT_HANDOFF.md`.

## Team

| Member | Role |
|---|---|
| Sambhavi Ranjan | Project & integration owner, database/backend core owner, final technical reviewer |
| Rekha Dharavatu | Student frontend |
| Sankalp Mohan | Faculty frontend |
| Mohammed Izhaan | Admin frontend, integration testing, documentation |

Supervisor: Dr. Jaya Priya T.

## Development workflow

This repository is the single source of truth for the project — all work happens here, not in a second copy.

Recommended branch structure:

- `main` — always in a runnable, tested state.
- `develop` — integration branch; feature branches merge here first, `main` is updated from `develop` at milestones.
- `feature/student-frontend` (Rekha), `feature/faculty-frontend` (Sankalp), `feature/admin-dashboard` (Mohammed Izhaan) — one feature branch per person/area, kept reasonably isolated so parallel work doesn't collide.

Sambhavi remains responsible for integration — merging feature branches into `develop`, resolving conflicts, and promoting `develop` to `main`.

Proposed GitHub issues for each teammate's area, including scope, affected files, required API endpoints (marked dependent on backend work where the endpoint doesn't exist yet), acceptance criteria, and required tests, are in `docs/GITHUB_ISSUES.md`.

## Documentation

- `docs/DEVELOPMENT_HANDOFF.md` — install, configure, run, test; current gaps; next tasks.
- `docs/IMPLEMENTATION_STATUS.md` — component-by-component status table.
- `docs/GITHUB_ISSUES.md` — proposed issues for Rekha, Sankalp, and Mohammed Izhaan.
- `services/api/LEVEL_7_TESTING_REPORT.md` — the detailed Level 7 testing report (unit, integration, concurrency, security, advanced-SQL, failure-injection, performance).
