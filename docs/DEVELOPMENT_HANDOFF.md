# Development Handoff — Faculty Availability & Intelligent Appointment Scheduling System

SRM Institute of Science and Technology — Advanced SQL and Modern Database Features, 5th semester.
Supervisor: Dr. Jaya Priya T.

Team: Sambhavi Ranjan (project/integration owner), Rekha Dharavatu (Student frontend), Sankalp Mohan (Faculty frontend), Mohammed Izhaan (Admin frontend + integration testing).

This document exists so a developer can clone the repository and run the project without asking basic questions. It describes what is genuinely implemented as of this handoff — nothing here is aspirational.

**Updated for the full-stack milestone.** Everything below the "Current state" list, up through "How to run tests," was originally written for a backend-only, Phase 2 snapshot (no authentication beyond a trusted header, no Faculty Availability HTTP endpoints, no admin module, no frontend). The historical bug-fix narrative in "Expected test result" is kept verbatim below because it's an accurate record of real problems found and fixed — it just predates several later additions. The "Current state," "HTTP layer," "Current gaps," and "Next development tasks" sections have been rewritten to describe what's actually true now: real JWT authentication, every backend module (including Faculty Availability and Admin/Reporting), all three frontends wired to it, and a real frontend component-test suite.

## Project

A web-based appointment scheduling system connecting students and faculty at SRM. The database (PostgreSQL) is a core correctness component, not passive storage: appointment overlap prevention, faculty availability computation, and transaction/concurrency correctness are implemented as PostgreSQL constraints, functions, and triggers, not re-implemented in application code. See the project's Level 1–5 design documents for the full rationale; this file only covers what exists and how to run it.

## Current state

Implemented and tested — backend:

- PostgreSQL schema (migrations 0001–0009): users/students/faculty, `faculty_availability`, `faculty_schedule`, `faculty_schedule_exceptions`, `batch_schedule`, `appointments`, `notifications`, `audit_log`, `departments`, `batches`. `pgcrypto` (0009) for bcrypt-compatible seed password hashes.
- `book_appointment()` stored function: atomically validates faculty availability (teaching schedule, leave, blocked periods) and books a PENDING appointment, protected by a GiST exclusion constraint against double-booking (migrations 0002, 0006).
- `faculty_availability` overlap protection: a second GiST exclusion constraint (migration 0007) prevents two contradictory declared availability windows for the same faculty member/day from coexisting.
- **Database session timezone pinned to `Asia/Kolkata`** (migration 0008). See **Timezone: why this exists** below.
- `get_available_slots()`, `is_faculty_available()`: availability computation, reconciling declared availability, teaching schedule, leave/blocked exceptions, and existing appointments.
- `enforce_appointment_transition` trigger; `trg_audit_appointment` trigger (automatic audit logging on every appointment insert/update).
- Views: `faculty_pending_requests`, `student_upcoming_appointments`, `faculty_current_status`. Materialized view: `faculty_appointment_stats`.
- `AppointmentRepository`/`AppointmentService`: booking, idempotent retries, guarded status transitions (approve/reject/cancel/complete/markMissed), error mapping — including both `23P01` (exclusion violation) and `40P01` (deadlock) as legitimate "lost the race" outcomes, and `listAllForFaculty()` for the faculty-scoped history endpoint.
- `FacultyRepository`/`FacultyService`: faculty directory, per-faculty available-slots lookup, and `GET /api/faculty/me/stats` (self-service workload summary).
- `FacultyAvailabilityRepository`/`Service`: read (`GET /api/faculty/availability`, own active windows) and write (`PUT /api/faculty/availability` full replace, `POST .../exceptions`) sides of faculty availability management.
- `AuthRepository`/`AuthService`: real bcrypt + JWT authentication (`POST /api/auth/login`).
- `AdminRepository`/`AdminService`: departments/batches/faculty/students CRUD (no delete — no soft-delete column exists), read-only appointments/audit-log listing, dashboard counts + per-faculty stats, the `RANK()`/running-`SUM()` workload report.
- `NotificationRepository`/`NotificationService`: in-app notifications, fired best-effort on every appointment transition.
- **HTTP/Controller layer** — every module above has a Controller + router; `src/middleware/identify.middleware.ts` verifies a real JWT (see **HTTP layer** below); `src/middleware/error-handler.middleware.ts` maps every domain error centrally.

Implemented and tested — frontend (`apps/student`, `apps/faculty`, `apps/admin`, shared package `packages/ui`):

- All three apps share one `SessionProvider`/`useSession` (real JWT session, `allowedRoles` per app) and one `apiClient` (`Authorization: Bearer <token>` on every request).
- Student: login, faculty directory/search, request an appointment, view my appointments.
- Faculty: login, dashboard, pending requests (approve/reject), availability editor, upcoming appointments, history (with the self-service stats section).
- Admin: login, dashboard, faculty/student/department/batch management, read-only appointments and audit-log viewers, the workload report.
- Vitest + `@testing-library/react` component tests in all three apps (`npm test`), exercising the real component tree against a stubbed `fetch` boundary only.

Not implemented (see **Current gaps** below): a background job to refresh `faculty_appointment_stats` (refreshed on read instead — a deliberate, documented simplification), an endpoint to list previously-added faculty availability exceptions, an admin delete/deactivate UI (matches the backend, which has none), deployment/CI, and component tests for every frontend page (a real but partial start exists — see `docs/IMPLEMENTATION_STATUS.md`).

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

## HTTP layer

An Express + TypeScript HTTP layer over every Service in `src/services/`, following the Controller → Service → Repository → PostgreSQL architecture from the top of this document.

**Running it:**

```bash
cd services/api
npm run dev      # ts-node src/server.ts — reads PORT (default 3000) and PG* from .env
```

**Caller identity — real authentication.** `POST /api/auth/login` (`{email, password}`) verifies the password with bcrypt against `users.password_hash` and returns a JWT (`{sub: userId, role}`, 12h expiry) plus the user's own `{id, role, fullName, email}`. Every other `/api/*` route requires `Authorization: Bearer <token>`; `src/middleware/identify.middleware.ts` verifies it (signature + expiry) and populates `req.user` from its claims — nothing else identifies a caller. **The `X-User-Id`/`X-User-Role` header scheme described in earlier versions of this document no longer exists and is rejected**: a request with those headers but no valid bearer token gets a `401 UNAUTHENTICATED`, the same as a request with nothing at all. A role that doesn't match what an endpoint requires (`requireRole()` at the route level) gets a `403 FORBIDDEN`.

**Endpoints implemented:**

| Endpoint | Method | Role | Success | Key error responses |
|---|---|---|---|---|
| `/api/auth/login` | POST | none (this is how you get an identity) | 200 | 401 UNAUTHENTICATED (same message for "no such user" and "wrong password" — no email enumeration) |
| `/api/appointments` | POST | STUDENT | 201 | 400 VALIDATION_ERROR, 409 SLOT_CONFLICT, 409 FACULTY_UNAVAILABLE |
| `/api/appointments/mine` | GET | STUDENT | 200 | — |
| `/api/appointments/pending` | GET | FACULTY | 200 | — |
| `/api/appointments/mine-as-faculty` | GET | FACULTY | 200 | — (`?status=` optional single-status filter; unfiltered returns every status) |
| `/api/appointments/:id/approve` | PATCH | FACULTY, must own | 200 (idempotent no-op if already APPROVED) | 404 NOT_FOUND, 409 INVALID_TRANSITION |
| `/api/appointments/:id/reject` | PATCH | FACULTY, must own | 200 | 404, 409 |
| `/api/appointments/:id/cancel` | PATCH | STUDENT or FACULTY, must be a party | 200 | 404, 409 |
| `/api/appointments/:id/complete` | PATCH | FACULTY, must own | 200 | 404, 409 |
| `/api/appointments/:id/missed` | PATCH | FACULTY, must own | 200 | 404, 409 |
| `/api/faculty` | GET | STUDENT or FACULTY | 200 | — (`?search=` optional) |
| `/api/faculty/:id/availability` | GET | STUDENT or FACULTY | 200 | 400, 404 (`?date=` required) |
| `/api/faculty/me/stats` | GET | FACULTY | 200 | — (always the caller's own row; no path param exists to get wrong) |
| `/api/faculty/availability` | GET | FACULTY | 200 | — (own currently-active windows) |
| `/api/faculty/availability` | PUT | FACULTY | 200 | 400, 409 AVAILABILITY_OVERLAP |
| `/api/faculty/availability/exceptions` | POST | FACULTY | 201 | 400 |
| `/api/notifications/mine` | GET | any authenticated | 200 | — |
| `/api/notifications/:id/read` | PATCH | owner only | 200 | 404 |
| `/api/admin/departments` | GET, POST | ADMIN | 200 / 201 | 400 |
| `/api/admin/departments/:id` | PATCH | ADMIN | 200 | 400 |
| `/api/admin/batches` | GET, POST | ADMIN | 200 / 201 | 400 (`?departmentId=` optional filter on GET) |
| `/api/admin/batches/:id` | PATCH | ADMIN | 200 | 400 |
| `/api/admin/faculty` | GET, POST | ADMIN | 200 / 201 | 400 (POST returns `{account, temporaryPassword}` — shown once) |
| `/api/admin/faculty/:id` | PATCH | ADMIN | 200 | 400 |
| `/api/admin/students` | GET, POST | ADMIN | 200 / 201 | 400 (`?batchId=` optional filter on GET) |
| `/api/admin/students/:id` | PATCH | ADMIN | 200 | 400 |
| `/api/admin/appointments` | GET | ADMIN | 200 | — (read-only; `?status=&facultyId=&studentId=&page=&pageSize=`) |
| `/api/admin/audit-log` | GET | ADMIN | 200 | — (read-only; `?entityType=&entityId=&page=&pageSize=`) |
| `/api/admin/dashboard` | GET | ADMIN | 200 | — |
| `/api/admin/reports/appointments-summary` | GET | ADMIN | 200 | — |
| `/health` | GET | none | 200 | — |

Every domain error (`ValidationError`, `NotFoundError`, `SlotConflictError`, `FacultyUnavailableError`, `AlreadyProcessedError`, `InvalidTransitionError`, `AvailabilityOverlapError`) is mapped to its HTTP status code in exactly one place, `src/middleware/error-handler.middleware.ts` — Controllers never branch on error type themselves, they just `next(err)`.

**Genuinely still missing** (not deferred-out-of-scope like the old version of this section said — actually absent): an endpoint to list previously-added faculty availability exceptions (only add exists), and any admin write path for an appointment (deliberate, not missing — see `docs/GITHUB_ISSUES.md`'s Level 3 note).

## How to run tests

Backend:

```bash
cd services/api
npm test                              # unit, integration, concurrency, security, advanced-sql, http — 531 tests
npm run test:performance              # real measurements against real PostgreSQL
npm run test:failure-injection        # run in isolation — it stops/restarts real PostgreSQL
```

Frontend (real component tests — Vitest + `@testing-library/react`, jsdom):

```bash
npm test              # from the repo root — runs all three apps' test suites in sequence
# or, per app:
npm run test -w apps/student
npm run test -w apps/faculty
npm run test -w apps/admin
```

These need no running backend or database — every test stubs `fetch` at the network boundary with response bodies shaped exactly like the real backend's, and exercises everything above that boundary (components, `SessionProvider`, `apiClient`) unmocked.

**Always use `npm run test:failure-injection`, not a raw `npx jest --selectProjects failure-injection ...` command.** The npm script carries `--coverage=false` (see **A second, independent bug** below for why); the raw command doesn't, and will fail on a spurious coverage-threshold error even when every individual test passes. An earlier version of this document itself recommended the raw command — that was a real, since-fixed bug in this documentation, not just a hypothetical mistake (see **Windows-specific note** below for the failing run that surfaced it).

The failure-injection project must be run by itself, never combined with the others in one `jest` invocation — it deliberately stops the real PostgreSQL server as part of one test, which would fail other projects' in-flight queries collaterally.

`tests/http/appointment.http.test.ts` follows this project's existing convention of never mocking the database: it builds the real Express app (`createApp()`) wired to a real `AppointmentService` backed by a real `pg.Pool`, and drives it with `supertest`, the same way `tests/integration/*` drives `AppointmentService` directly.

## Expected test result

**Current milestone (read this first):** `npm test` in `services/api` — **531/531 passing, exit code 0** — real PostgreSQL 16, database session pinned to `Asia/Kolkata`, 100% statement coverage / 98.98% branch / 99.29% functions. This is the full set: every module (appointments, faculty directory + availability, auth, admin/reporting, notifications), including a real HTTP-level double-booking concurrency test (`tests/concurrency/double-booking-http.test.ts`) alongside the repository-level one. Frontend: 22/22 Vitest component tests passing across the three apps, plus a clean `npm run typecheck` and `npm run build` on all three.

One test that used to be time-of-day-dependent — `faculty_current_status derives IN_APPOINTMENT for a faculty member with an APPROVED appointment covering the current instant` — is now fixed. It previously used Prof. Rao (`'200'`, who has a *permanent* Mon–Fri 09:00–17:00 availability row) as its test faculty member; its fallback path inserted a wide-open test-scoped window for "today," which collides with that permanent row's GiST exclusion constraint on every weekday outside 09:00–17:00 IST — meaning the test could only pass inside roughly a nine-hour weekday window, not because of any flakiness but as a deterministic consequence of the faculty member chosen. It now uses Prof. Iyer (`'201'`, zero seeded availability, already used elsewhere in the same file as "the faculty with no availability" fixture) instead, so the test-scoped window can never collide with anything pre-existing. Confirmed passing at 20:21 IST on a Thursday — exactly the condition that used to fail it.

The historical record below (Phase 2 era) is kept for reference — it documents real bugs found and fixed at the time (the timezone bug, a deadlock/exclusion-violation concurrency gap, an index-selectivity test-design bug, a Windows service-name hardcoding bug) and remains an accurate account of that work. The pass counts it quotes (211, 236, etc.) are from that earlier, smaller surface area — they are not wrong, just superseded by the 531 total above, which now covers every module this project has.

As actually observed after the timezone fix (migration 0008), the Phase 2 HTTP layer, and all corrections below, verified against real PostgreSQL 16 with the database session pinned to `Asia/Kolkata`, checking the actual process exit code each time (not just the printed pass count):

- `npm test`: **211/211 passing** (188 pre-existing + 2 new `AppointmentService` unit tests + 21 new HTTP tests), exit code 0.
- `npm run test:performance`: **5/5 passing**, exit code 0, real measurements written to `services/api/performance-results.json`.
- `npm run test:failure-injection`: **20/20 passing** (7 pre-existing real-PostgreSQL-stop/restart tests + 13 new unit tests for the Windows service-name resolution logic — see the Windows-specific note below), exit code 0 (run in isolation, per the note above), confirmed stable across 2 consecutive runs, PostgreSQL genuinely back up and accepting connections after each.
- Total: **236/236 tests passing**, all with a genuinely successful exit code.

**PostgreSQL 18 / Windows status:** the pre-existing 200 (everything through the previous milestone) were independently re-confirmed on a real Windows/PostgreSQL 18 machine — see the paragraph below. **The 23 tests added for the Phase 2 HTTP layer, and the 13 new failure-injection unit tests added for the Windows service-name fix below, have only been run in this project's own Linux/PostgreSQL 16 environment so far and have NOT yet been independently re-confirmed on Windows/PostgreSQL 18** — flagging this explicitly rather than assuming portability, consistent with how every other cross-platform claim in this document is sourced from an actual re-run, not an assumption. The Windows-specific fix below was triggered by a genuine failing run on that machine, but the *fix itself* still needs a real re-run there to confirm — this document does not claim it does until that happens.

Every bug in the paragraph below (the index-choice test-design bug, the deadlock/40P01 concurrency gap, the Jest timeout gap, and the `afterEach` double-start idempotency gap) was found from an actual failing test run on a real PostgreSQL 18/Windows machine, not guessed at, then fixed and verified in this project's own PostgreSQL 16 environment first. All three test commands have since been independently re-run on that same original Windows/PostgreSQL 18 machine: `npm test` **188/188** (pre-Phase-2 count), `npm run test:performance` **5/5**, `npm run test:failure-injection` **7/7** — a genuine 200/200, confirmed twice, on two different PostgreSQL major versions and two different operating systems.

**Known open issue — a second, so-far-unfixed instance of the same deadlock class:** while re-running the full suite to verify the Phase 2 HTTP layer didn't regress anything, `tests/integration/faculty-availability-overlap-protection.test.ts` failed once out of four consecutive `npm test` runs, with the identical shape as the double-booking bug fixed earlier: `expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: '23P01' })` received `{ code: '40P01' }` instead — PostgreSQL's deadlock detector resolving the race instead of the `faculty_availability_no_overlap` exclusion constraint. This is the same underlying mechanism as the double-booking fix (two concurrent inserts locking the same GiST index page in opposite order), just on a different table and a different test file, and it was NOT introduced by Phase 2 — this test inserts directly against `faculty_availability` with no application code involved (there is no `FacultyAvailabilityRepository` yet). It is almost certainly fixed the same way: broaden that one assertion to accept either `23P01` or `40P01`, the same pattern already used in `double-booking.test.ts`'s `assertSlotConflict()` helper. Left unfixed here deliberately — it's outside Phase 2's scope (HTTP layer), and per this project's working agreement, scope changes go through Sambhavi rather than getting folded silently into an unrelated pass.

**Correcting an earlier claim in this same document:** an earlier version of this handoff reported "186/186, stable across 3 runs" based on a run in a PostgreSQL install that happened to default to UTC. The same code, run against a PostgreSQL install defaulting to `Asia/Kolkata` (the realistic case for anyone setting this up in India without special configuration), failed 27 tests in `npm test`, 1 in `test:performance`, and 4 in `test:failure-injection` — this is what led to migration 0008 and the fixes below.

**A second, independent bug was also found and fixed while re-verifying:** `npm run test:performance` and the failure-injection run were previously exiting with process exit code 1 even though all individual tests passed — Jest's global 100% coverage threshold (meant for the Service/Repository/domain layer, exercised by `npm test`) was being evaluated against the performance/failure-injection runs too, which never touch that layer (they query the database directly), so coverage always read 0% for those runs and Jest treated the whole run as failed. Both scripts now pass `--coverage=false` in `package.json`, since coverage enforcement belongs on the run that actually exercises the app layer.

**This exact bug resurfaced later, sourced to this document itself, not to `package.json`.** A real run reported the coverage-threshold failure again — but `package.json`'s `test:failure-injection` script already had `--coverage=false`. The actual cause: this document's own "How to run tests" section (and the header comment in `failure-injection.test.ts`) recommended the raw `npx jest --selectProjects failure-injection --runInBand` command, which does not carry that flag. Reproduced directly: running that raw command in this project's own environment, with the Windows service-name fix already applied and every individual test passing, still exits 1 on the coverage threshold — confirming the fix needed was to the *documented command*, not the test logic or `package.json`. **Correction, to be precise about the actual mechanism (an earlier report of this symptom guessed "the test failed before exercising the application code" — that was a reasonable guess but not what's actually happening):** the failure-injection suite passes every individual test regardless; it just doesn't exercise `AppointmentService`/`AppointmentRepository`/the state machine the way `npm test` does (its tests stop Postgres, run raw SQL, exhaust a connection pool — deliberately not routine app-layer calls), so its coverage of those three files reads near-0% by design, every time, whether or not anything failed. Both this document and the test file's header comment now say `npm run test:failure-injection` instead of the raw command.

**A real index-choice test-design bug, found from an actual failure on PostgreSQL 18, not guessed at:** `advanced-sql-features.test.ts`'s bulk index-verification seed originally fixed `student_id=100, faculty_id=200` for all 5000 synthetic rows. That made `appointments_student_status_idx (student_id, status)` and `appointments_faculty_status_idx (faculty_id, status)` statistically IDENTICAL for this data — every row matched both single-column predicates at once — so the planner had no real cost basis to prefer one over the other, and which one it picked was an implementation-detail tie-break that differed between PostgreSQL versions (consistently one index on 16, consistently the other on 18). Fixed by decorrelating student_id/faculty_id across all 4 real seeded (student, faculty) pairs, so each index is now genuinely the more selective choice for its own matching query, on any PostgreSQL version.

**A genuine concurrency-correctness gap, found by deliberately stress-testing the flagship double-booking test 15+ times in a row rather than trusting a single clean run:** roughly 1 run in 7–10, two truly concurrent `book_appointment()` calls for the same/overlapping slot resolved via PostgreSQL's own deadlock detector (SQLSTATE `40P01`, "deadlock detected") instead of the exclusion constraint's `23P01` (exclusion_violation) — both transactions' inserts occasionally lock the same GiST index page in opposite order, and Postgres kills one to break the cycle. This is not corruption; it's a second, equally legitimate mechanism by which "this attempt lost the race for the slot" can occur. `AppointmentRepository.bookAppointment()` previously only mapped `23P01`/`23505` to `SlotConflictError`, so a `40P01` outcome reached the caller as a raw, unmapped `DatabaseError` — this is almost certainly the root cause of the intermittent `double-booking.test.ts` failure flagged as "pre-existing flakiness" earlier in this project's own history, now actually fixed rather than left as an assumed timing quirk. `40P01` is now mapped to `SlotConflictError` in both the plain-conflict path and the idempotent-replay-lookup path (a genuinely concurrent duplicate request carrying the same `clientRequestId` can also resolve via a deadlock, and needs to be recognized as a duplicate the same way a `23P01`/`23505` duplicate already was). Verified with 25 consecutive full concurrency-suite runs, 0 failures, after the fix (was previously flaky roughly every 7–10 runs).

**A related, unrelated-to-timezone test-infrastructure fix found during that same stress-testing:** the two ten-concurrent-caller tests (`double-booking.test.ts`, `extended-concurrency-and-idempotency.test.ts`) occasionally exceeded Jest's 5000ms default test timeout under real load, despite `jest.config.js` declaring `testTimeout: 20000` for the `concurrency` project — that project-level setting was empirically observed not to take effect (the actual timeout error reported "5000 ms"). Both tests now set an explicit `20000` timeout directly, which Jest does reliably honor.

**A real bug, found from an actual failing run on Windows/PostgreSQL 18, not guessed at: the Windows service name was hardcoded to a specific PostgreSQL major version.** `stopPostgres()`/`startPostgres()` defaulted to `net stop`/`net start postgresql-x64-16` on Windows. On a real Windows/PostgreSQL 18 machine (service name `postgresql-x64-18`), this failed immediately: `Command failed: net stop postgresql-x64-16 / The service name is invalid.` Re-hardcoding a different version number would only move the same bug to whenever someone next upgrades PostgreSQL. Fixed by extracting the process-control logic into `tests/failure-injection/postgres-process-control.ts` and resolving the Windows service name at runtime instead of hardcoding any version:

1. `PG_STOP_CMD` / `PG_START_CMD` (unchanged) — a full command override, for anything not covered by the two options below.
2. `PG_WINDOWS_SERVICE_NAME` (new) — just the service name, if you already know it or auto-detection picks the wrong one (e.g. more than one `postgresql*` service installed).
3. Auto-detected via `Get-Service -Name postgresql*` in PowerShell (new default) — works for any installed PostgreSQL version without this file ever needing to know which one. Cached for the process so it's only queried once per test run, not once per stop/start call.
4. Non-Windows platforms are unaffected: still `service postgresql start/stop`.

`net start`/`net stop` still require an elevated (Run as Administrator) terminal on Windows, and PowerShell must be reachable on PATH for auto-detection to work — if it isn't, the error message names exactly which env var to set instead. The command-resolution logic (which command gets picked for which platform/env-var combination, including this exact regression — three different PostgreSQL major versions resolving correctly without any code change) has unit tests in `tests/failure-injection/postgres-process-control.test.ts`, with `child_process.execSync` mocked throughout, so they run on any machine without touching a real PostgreSQL service.

Two real, sequential issues surfaced getting this working end-to-end on an actual Windows/PostgreSQL 18 machine, both now understood, fixed, and re-confirmed: first, "System error 5 — Access is denied" meant the terminal running the command wasn't actually elevated despite being asked to be (right-click PowerShell → "Run as administrator"; verify with `([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)` printing `True` before proceeding — env vars do not carry over between windows, re-set them in the elevated one). Second, once genuinely elevated, `net start` failed with "The requested service has already been started" — the test's own body already restarts Postgres as its last step, then the file's `afterEach` unconditionally calls `startPostgres()` again "to always leave Postgres running for other test files," and Windows' `net start` (unlike Debian's `service ... start`) treats starting an already-running service as an error rather than a no-op. `startPostgres()` now swallows a failed start attempt and relies on the `waitForPostgresUp()` call that already follows every call site as the real check — a genuine failure to start still surfaces clearly via that timeout, just an already-running service no longer does. Re-run on the original Windows/PostgreSQL 18 machine after the fix: **7/7 passing**, including the real stop-and-recover test taking ~8s of genuine downtime (not a stub) and the same benign "already been started" message from `net start` inside `afterEach` no longer failing the run.

## Current architecture

```
Controller     — src/controllers/*.controller.ts
      ↓            HTTP concerns only: request/response shape, status codes.
      ↓            src/routes/*.routes.ts wires paths + role checks;
      ↓            src/middleware/identify.middleware.ts verifies the caller's
      ↓            real JWT (see "HTTP layer" above); src/app.ts wires it all up.
Service        — src/services/*.service.ts
      ↓            business rules, ownership, state transitions, orchestration
Repository      — src/repositories/*.repository.ts
      ↓            the only classes that execute their module's SQL
PostgreSQL      — migrations/sql/000*.sql
                   final integrity authority: constraints, triggers, transactions,
                   exclusion constraints, stored functions
```

One Controller/Service/Repository trio per module: appointments, faculty directory + availability, auth, admin/reporting, notifications — same layering throughout. The database is deliberately not just storage: `book_appointment()`, `is_faculty_available()`, `get_available_slots()`, `enforce_appointment_transition`, and the two GiST exclusion constraints all enforce correctness at the database layer, independent of whatever the application code does or doesn't check first.

Frontend: `apps/student`, `apps/faculty`, `apps/admin` (Vite + React + TypeScript), each consuming the shared `packages/ui` package (design system, typed API client, `SessionProvider`) via a direct source-file path alias, not a built/published package.

## Current gaps

Genuinely open items, not aspirational — everything else described in this document is built and tested.

1. No endpoint to list previously-added faculty availability exceptions — only `POST .../exceptions` (add) exists, no `GET`. The Availability page's exceptions form is honest about this in a notice banner.
2. No faculty background job to refresh `faculty_appointment_stats` — both the admin dashboard and `GET /api/faculty/me/stats` refresh it on every read instead. Correct, but not the performance win a real scheduled refresh would be. No scheduler infrastructure exists in this codebase to build one on top of yet.
3. No admin delete/deactivate UI or endpoint for any entity — matches the backend, which has none (no soft-delete column on `departments`/`batches`/`faculty`/`students`). Would need a real migration to do properly.
4. Frontend component test coverage is real but partial — Login (all three apps), Faculty History, and Admin Departments have tests; most other pages don't yet. See `docs/IMPLEMENTATION_STATUS.md`.
5. No true multi-process HTTP concurrency test spanning a separately-running server process — the concurrency tests (including the HTTP-level one) all run an in-process `createApp()` instance via `supertest`, which is a real Express app and a real database but not a separately-launched server process.
6. No automated migration runner — migrations are applied by hand with `psql`, in numeric order (see above).
7. No deployment configuration, CI pipeline, or hosting setup. Out of scope for this project.

## Next development tasks

The backend and all three frontends are functionally complete. Recommended order for what's left:

1. Component tests for the remaining frontend pages (see gap 4 above) — the infrastructure exists (Vitest + Testing Library, all three apps), so this is additive test-writing, not new setup.
2. A faculty availability exceptions list endpoint (`GET /api/faculty/availability/exceptions`, mirroring the pattern the availability-windows `GET` already follows), to close gap 1.
3. A real background refresh job for `faculty_appointment_stats`, once this project has any scheduler infrastructure at all, to close gap 2.
4. Everything else in **Current gaps** above, roughly in the order listed — none of it blocks a working demo of the system as it stands today.
