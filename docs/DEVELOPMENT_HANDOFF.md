# Development Handoff — Faculty Availability & Intelligent Appointment Scheduling System

SRM Institute of Science and Technology — Advanced SQL and Modern Database Features, 5th semester.
Supervisor: Dr. Jaya Priya T.

Team: Sambhavi Ranjan (project/integration owner), Rekha Dharavatu (Student frontend), Sankalp Mohan (Faculty frontend), Mohammed Izhaan (Admin frontend + integration testing).

This document exists so a developer can clone the repository and run the project without asking basic questions. It describes what is genuinely implemented as of this handoff — nothing here is aspirational.

## Project

A web-based appointment scheduling system connecting students and faculty at SRM. The database (PostgreSQL) is a core correctness component, not passive storage: appointment overlap prevention, faculty availability computation, and transaction/concurrency correctness are implemented as PostgreSQL constraints, functions, and triggers, not re-implemented in application code. See the project's Level 1–5 design documents for the full rationale; this file only covers what exists and how to run it.

## Current state

Implemented and tested:

- PostgreSQL schema (migrations 0001–0007): users/students/faculty, `faculty_availability`, `faculty_schedule`, `faculty_schedule_exceptions`, `batch_schedule`, `appointments`, `notifications`, `audit_log`.
- `book_appointment()` stored function: atomically validates faculty availability (teaching schedule, leave, blocked periods) and books a PENDING appointment, protected by a GiST exclusion constraint against double-booking (migrations 0002, 0006).
- `faculty_availability` overlap protection: a second GiST exclusion constraint (migration 0007) prevents two contradictory declared availability windows for the same faculty member/day from coexisting.
- **Database session timezone pinned to `Asia/Kolkata`** (migration 0008). See **Timezone: why this exists** below — this is not cosmetic, it fixes a real correctness bug that only shows up when the same code runs on PostgreSQL installs with different host-default timezones.
- `get_available_slots()`, `is_faculty_available()`: availability computation, reconciling declared availability, teaching schedule, leave/blocked exceptions, and existing appointments.
- `enforce_appointment_transition` trigger: guards every status transition against the documented state machine, independent of any application code path.
- `trg_audit_appointment` trigger: automatic audit logging on every appointment insert/update.
- Views: `faculty_pending_requests`, `student_upcoming_appointments`, `faculty_current_status`. Materialized view: `faculty_appointment_stats`.
- `AppointmentRepository` (`src/repositories/appointment.repository.ts`): the only class permitted to execute appointment SQL. Handles booking, idempotent retries, guarded status transitions (approve/reject/cancel/complete/markMissed), and error mapping (SlotConflictError, FacultyUnavailableError, etc.).
- `AppointmentService` (`src/services/appointment.service.ts`): workflow/policy layer — ownership checks, idempotent no-ops, state-machine validation ahead of the database round trip. Exposes `requestAppointment`, `approve`, `reject`, `cancel`, `complete`, `markMissed`.
- `AppointmentStateMachine` (`src/domain/appointment-state-machine.ts`): pure domain object mirroring the database trigger's transition rules.

Not implemented yet (see **Current gaps** below): HTTP/controller layer, authentication/authorization, NotificationService (dispatch — the `notifications` table exists but nothing writes to it or sends anything), and all three frontends.

## How to install

```bash
cd services/api
npm install
```

Requires Node.js (developed against Node 24) and a running PostgreSQL 16 instance reachable from this machine.

## How to configure environment variables

Copy the example file and adjust if your local PostgreSQL differs from the defaults:

```bash
cp .env.example .env
```

`.env.example` contents (safe placeholders — never commit real credentials):

```
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=faculty_scheduling
```

`src/db/client.ts` reads these via `process.env`, falling back to the same defaults if `.env` is absent.

**If your local PostgreSQL `postgres` role has its own password** (not the `postgres` placeholder above — e.g. you changed it during installation), put your real value only in your local `.env`, never in a tracked file. `.env` is already listed in `.gitignore` and will never be committed. Every place in this codebase that opens a database connection reads the password from `process.env.PGPASSWORD`, including the failure-injection tests, so changing `.env` is the only place you need to change it.

## How to start PostgreSQL

Any local PostgreSQL 16 instance works. On a Debian/Ubuntu-style dev container:

```bash
service postgresql start
pg_isready   # confirm it's accepting connections
```

Create the database once:

```bash
createdb -U postgres faculty_scheduling
# or: psql -U postgres -c "CREATE DATABASE faculty_scheduling;"
```

## How to run migrations

**Honest note:** there is no automated migration runner script yet — this is real, documented technical debt (see **Current gaps**). Migrations are plain, numbered `.sql` files under `services/api/migrations/sql/` and must currently be applied by hand, in order, with `psql`:

```bash
cd services/api
for f in migrations/sql/0*.sql; do
  PGPASSWORD=$PGPASSWORD psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f "$f"
done
```

Then load the test fixture data (used by the automated test suite; skip if you only want a clean schema):

```bash
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f migrations/sql/seed_test_data.sql
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f migrations/sql/seed_availability_test_data.sql
```

Migration order matters — each file assumes the previous ones already ran (0001 creates the `btree_gist` extension and core tables; 0002 adds the appointments exclusion constraint; 0003 adds functions/triggers; 0004 adds views; 0005 adds `get_available_slots()` and the materialized view; 0006 adds booking-time availability enforcement; 0007 adds the `faculty_availability` overlap constraint; 0008 pins the database session timezone to `Asia/Kolkata`).

## Timezone: why this exists

`is_faculty_available()`, `book_appointment()`, and `get_available_slots()` all combine a `DATE` with a `TIME` column to produce a `TIMESTAMPTZ`, and convert `TIMESTAMPTZ` values back to local `TIME`/`DATE` via `::time`/`::date` casts. Both directions of that conversion depend on PostgreSQL's session `timezone` setting — which defaults to whatever timezone the host machine was in at `initdb` time, unless overridden. This was flagged as a known simplification in the Level 5 design doc and left open. It became a real, observed bug: the exact same schema, functions, and test data produced different, contradictory availability results depending on whether the PostgreSQL install's host default was `Etc/UTC` or `Asia/Kolkata` — a slot that was correctly inside a teaching block under one host's default was reported bookable under the other's.

Migration 0008 (`ALTER DATABASE faculty_scheduling SET timezone TO 'Asia/Kolkata'`) fixes this by pinning the database's session timezone explicitly, so every developer's machine — regardless of its own OS timezone — gets identical, correct behavior. `Asia/Kolkata` was chosen (not UTC) because this is a single-campus system for a college in India: faculty teaching hours and availability windows are always meant to represent real IST wall-clock time.

**If you already applied migrations 0001–0007 before this fix landed, you must apply 0008 too** (`psql -f migrations/sql/0008_pin_database_timezone.sql`) and restart your test runner / application afterward — `ALTER DATABASE ... SET` only affects new connections made after it runs, not connections already open in an existing pool.

Every test-file timestamp literal that represents a specific real-world hour (business hours, teaching-block boundaries, etc.) uses an explicit `+05:30` offset rather than `Z` (UTC), so the intended local hour is unambiguous and independent of any session default. A small number of assertions compare against `Date.prototype.toISOString()` output from the JS side, which always renders in UTC regardless of the database's session timezone — those specific expected values are the correct UTC-equivalent of the intended IST time, with a comment explaining the offset at each occurrence.

## How to run tests

```bash
cd services/api
npm test                              # unit, integration, concurrency, security, advanced-sql — 188 tests
npm run test:performance              # real measurements against real PostgreSQL — 5 tests
npx jest --selectProjects failure-injection --runInBand   # run in isolation — it stops/restarts real PostgreSQL
```

The failure-injection project must be run by itself, never combined with the others in one `jest` invocation — it deliberately stops the real PostgreSQL server as part of one test, which would fail other projects' in-flight queries collaterally.

## Expected test result

As actually observed after the timezone fix (migration 0008) and all corrections below, verified against real PostgreSQL 16 with the database session pinned to `Asia/Kolkata`, checking the actual process exit code each time (not just the printed pass count):

- `npm test`: **188/188 passing**, exit code 0, confirmed stable across 3 consecutive runs.
- `npm run test:performance`: **5/5 passing**, exit code 0, real measurements written to `services/api/performance-results.json`.
- `npm run test:failure-injection`: **7/7 passing**, exit code 0 (run in isolation, per the note above).
- Total: **200/200 tests passing**, all with a genuinely successful exit code.

**PostgreSQL 18 status — independently re-confirmed:** the index-choice test-design bug, the deadlock/40P01 concurrency gap, and the Jest timeout gap were all found from an actual failing test run on PostgreSQL 18/Windows, then fixed and verified on PostgreSQL 16 in this project's own environment. They have since been independently re-run on the original PostgreSQL 18/Windows machine that surfaced them: `npm test` **188/188** and `npm run test:performance` **5/5**, both clean. `npm run test:failure-injection` on that same machine still has one unresolved item — not a code bug, see the Windows-specific note below.

**Correcting an earlier claim in this same document:** an earlier version of this handoff reported "186/186, stable across 3 runs" based on a run in a PostgreSQL install that happened to default to UTC. The same code, run against a PostgreSQL install defaulting to `Asia/Kolkata` (the realistic case for anyone setting this up in India without special configuration), failed 27 tests in `npm test`, 1 in `test:performance`, and 4 in `test:failure-injection` — this is what led to migration 0008 and the fixes below.

**A second, independent bug was also found and fixed while re-verifying:** `npm run test:performance` and the failure-injection run were previously exiting with process exit code 1 even though all individual tests passed — Jest's global 100% coverage threshold (meant for the Service/Repository/domain layer, exercised by `npm test`) was being evaluated against the performance/failure-injection runs too, which never touch that layer (they query the database directly), so coverage always read 0% for those runs and Jest treated the whole run as failed. Both scripts now pass `--coverage=false` in `package.json`, since coverage enforcement belongs on the run that actually exercises the app layer.

**A real index-choice test-design bug, found from an actual failure on PostgreSQL 18, not guessed at:** `advanced-sql-features.test.ts`'s bulk index-verification seed originally fixed `student_id=100, faculty_id=200` for all 5000 synthetic rows. That made `appointments_student_status_idx (student_id, status)` and `appointments_faculty_status_idx (faculty_id, status)` statistically IDENTICAL for this data — every row matched both single-column predicates at once — so the planner had no real cost basis to prefer one over the other, and which one it picked was an implementation-detail tie-break that differed between PostgreSQL versions (consistently one index on 16, consistently the other on 18). Fixed by decorrelating student_id/faculty_id across all 4 real seeded (student, faculty) pairs, so each index is now genuinely the more selective choice for its own matching query, on any PostgreSQL version.

**A genuine concurrency-correctness gap, found by deliberately stress-testing the flagship double-booking test 15+ times in a row rather than trusting a single clean run:** roughly 1 run in 7–10, two truly concurrent `book_appointment()` calls for the same/overlapping slot resolved via PostgreSQL's own deadlock detector (SQLSTATE `40P01`, "deadlock detected") instead of the exclusion constraint's `23P01` (exclusion_violation) — both transactions' inserts occasionally lock the same GiST index page in opposite order, and Postgres kills one to break the cycle. This is not corruption; it's a second, equally legitimate mechanism by which "this attempt lost the race for the slot" can occur. `AppointmentRepository.bookAppointment()` previously only mapped `23P01`/`23505` to `SlotConflictError`, so a `40P01` outcome reached the caller as a raw, unmapped `DatabaseError` — this is almost certainly the root cause of the intermittent `double-booking.test.ts` failure flagged as "pre-existing flakiness" earlier in this project's own history, now actually fixed rather than left as an assumed timing quirk. `40P01` is now mapped to `SlotConflictError` in both the plain-conflict path and the idempotent-replay-lookup path (a genuinely concurrent duplicate request carrying the same `clientRequestId` can also resolve via a deadlock, and needs to be recognized as a duplicate the same way a `23P01`/`23505` duplicate already was). Verified with 25 consecutive full concurrency-suite runs, 0 failures, after the fix (was previously flaky roughly every 7–10 runs).

**A related, unrelated-to-timezone test-infrastructure fix found during that same stress-testing:** the two ten-concurrent-caller tests (`double-booking.test.ts`, `extended-concurrency-and-idempotency.test.ts`) occasionally exceeded Jest's 5000ms default test timeout under real load, despite `jest.config.js` declaring `testTimeout: 20000` for the `concurrency` project — that project-level setting was empirically observed not to take effect (the actual timeout error reported "5000 ms"). Both tests now set an explicit `20000` timeout directly, which Jest does reliably honor.

**Windows-specific note for `npm run test:failure-injection`:** this project stops and restarts the real PostgreSQL server as part of one test. On Windows this uses `net stop`/`net start postgresql-x64-16` by default, which (a) requires an elevated (Run as Administrator) terminal, and (b) assumes your PostgreSQL Windows service is literally named `postgresql-x64-16` — confirm your actual service name with `Get-Service -Name postgresql*` in PowerShell (commonly `postgresql-x64-<version>`, e.g. `postgresql-x64-18`), and if it differs, set `PG_STOP_CMD` / `PG_START_CMD` environment variables to override (see the comment above `stopPostgres()`/`startPostgres()` in the test file).

Two real, sequential issues surfaced getting this working end-to-end on an actual Windows/PostgreSQL 18 machine, both now understood and fixed: first, "System error 5 — Access is denied" meant the terminal running the command wasn't actually elevated despite being asked to be (right-click PowerShell → "Run as administrator"; verify with `([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)` printing `True` before proceeding — env vars do not carry over between windows, re-set them in the elevated one). Second, once genuinely elevated, `net start` failed with "The requested service has already been started" — the test's own body already restarts Postgres as its last step, then the file's `afterEach` unconditionally calls `startPostgres()` again "to always leave Postgres running for other test files," and Windows' `net start` (unlike Debian's `service ... start`) treats starting an already-running service as an error rather than a no-op. `startPostgres()` now swallows a failed start attempt and relies on the `waitForPostgresUp()` call that already follows every call site as the real check — a genuine failure to start still surfaces clearly via that timeout, just an already-running service no longer does. Verified on Linux (7/7, unaffected); the fix has not yet been re-run on the original Windows/PostgreSQL 18 machine.

## Current architecture

```
Controller (not yet implemented)
      ↓
Service        — src/services/appointment.service.ts
      ↓            business rules, ownership, state transitions, orchestration
Repository      — src/repositories/appointment.repository.ts
      ↓            the only class that executes appointment SQL
PostgreSQL      — migrations/sql/000*.sql
                   final integrity authority: constraints, triggers, transactions,
                   exclusion constraints, stored functions
```

The database is deliberately not just storage: `book_appointment()`, `is_faculty_available()`, `get_available_slots()`, `enforce_appointment_transition`, and the two GiST exclusion constraints all enforce correctness at the database layer, independent of whatever the application code does or doesn't check first.

## Current gaps

1. No HTTP/controller/authentication layer — Controllers do not exist yet; Service/Repository are exercised only from tests.
2. No `AuthMiddleware` / role-based access control at the HTTP boundary (STUDENT/FACULTY/ADMIN) — ownership checks currently exist only inside `AppointmentService`, scoped to a caller-supplied id with no verification that the id is who it claims to be.
3. No `NotificationService` — the `notifications` table exists in the schema but nothing writes to it or sends an email/push/websocket notification.
4. No frontend (Student, Faculty, or Admin) — not started.
5. No automated migration runner — migrations are applied by hand with `psql`, in numeric order (see above).
6. `faculty_availability` has no application-layer Repository/Service yet — the overlap-protection constraint (migration 0007) is currently only exercised directly against PostgreSQL in tests; there is no code path yet for a faculty member to edit their own availability.

## Next development tasks

Recommended order, matching the project's own phased roadmap:

1. HTTP/controller layer (Express + TypeScript) wrapping the existing Service layer — Controllers thin, no SQL, no business logic.
2. Authentication and authorization (STUDENT/FACULTY/ADMIN roles, session/token verification, ownership checks tied to the authenticated identity rather than a caller-supplied id).
3. NotificationService — distinguish creating a notification record from actually dispatching it (email/etc.); do not claim delivery until both exist and are tested.
4. `FacultyAvailabilityRepository`/`Service` — the application-layer counterpart to migration 0007, so faculty can manage their own availability through the API once it exists.
5. Frontend work (Student — Rekha, Faculty — Sankalp, Admin — Mohammed Izhaan) — see `docs/GITHUB_ISSUES.md` for the proposed task breakdown per person. Depends on (1)–(2) existing first for anything beyond static UI.
6. Frontend/backend integration testing (Mohammed Izhaan) once both sides exist.
