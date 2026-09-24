# Frontend Migration Report — Student, Faculty & Admin Rebuild

**Date:** 2026-09-24
**Scope:** Full replacement of the three frontend modules (student, faculty, admin) with a single, shared, production-quality implementation, built against the real `services/api` backend only.
**Backend:** Untouched. No file under `services/api/` was modified, added, or deleted.

---

## 1. What changed, in one paragraph

None of the three prior frontend submissions (Rekha's student app, Sankalp's faculty app, Izhaan's admin app) had ever actually been merged into this repository — `docs/IMPLEMENTATION_STATUS.md` confirms all three were still "Not started" here. This pass adds `packages/ui` (one shared design system + API client + types, used by all three apps) and `apps/student`, `apps/faculty`, `apps/admin` as new npm workspaces, built from scratch against the real backend contract, with genuinely useful UI/UX ideas salvaged from the three prior submissions where they held up. Nothing invented: every screen either calls a real, already-tested endpoint, or honestly says it can't yet and names the exact endpoint it's waiting on.

---

## 2. A scope decision made with Sambhavi before building (see conversation)

Two questions were asked and answered before any app code was written, because the requested scope (faculty search/profile/availability, an availability editor, exceptions, and a full admin module) conflicted directly with "use only real backend APIs, no invented endpoints, no mock data" — the backend genuinely does not have those endpoints yet.

**Decision 1 — scope:** Build only what the real backend supports today, production-quality. Everything else shows an honest, clearly-labeled "not available yet" state naming the missing endpoint — never mock data, never a fabricated endpoint.

**Decision 2 — auth:** Build a real dev-login screen against the backend's actual (temporary, unverified) `X-User-Id` / `X-User-Role` header scheme, clearly labeled as a stand-in, not real authentication.

Both decisions are implemented exactly as agreed — see Section 6 for exactly what "honestly blocked" means on each screen.

---

## 3. New files created

### `packages/ui` — shared design system, API client, types (new package)

```
packages/ui/package.json
packages/ui/src/index.ts                       — barrel export + CSS side-effect import
packages/ui/src/types/index.ts                 — AppointmentRow, FacultyPendingRequestRow, AppointmentStatus,
                                                   UserRole, Session, ApiError, ALLOWED_TRANSITIONS — every
                                                   field mirrored exactly from services/api/src, not guessed
packages/ui/src/api/client.ts                   — fetch wrapper: attaches X-User-Id/X-User-Role, normalizes
                                                   the backend's {error,message} shape into ApiError
packages/ui/src/api/appointments.ts             — one function per real route in appointment.routes.ts, nothing else
packages/ui/src/auth/SessionProvider.tsx        — dev-login session (localStorage-backed, per-app storage key)
packages/ui/src/tokens/tokens.css               — design tokens (palette adapted from Izhaan's admin submission,
                                                   the most complete of the three), per-app accent classes
packages/ui/src/tokens/components.css           — shared component styles
packages/ui/src/components/{Button,Card,Field,StatusBadge,States,Toast,
                             ConfirmDialog,PageHeader,AppShell,Table}.tsx
packages/ui/src/utils/slot.ts                   — parses the raw Postgres tstzrange string the backend
                                                   actually returns for `slot` (no type parser is registered
                                                   server-side, confirmed by reading services/api/src/db/client.ts
                                                   and verified against a real running instance — see Section 5)
packages/ui/src/utils/localCache.ts             — the honestly-labeled local cache described in Section 6
```

### `apps/student`

```
apps/student/{package.json,vite.config.ts,tsconfig*.json,index.html}
apps/student/src/main.tsx, App.tsx
apps/student/src/pages/{Login,Dashboard,RequestAppointment,MyAppointments,AppointmentDetail,FacultyDirectory}.tsx
apps/student/src/state/AppointmentsContext.tsx   — single in-memory copy of GET /appointments/mine, shared by
                                                    every screen (avoids re-fetching, backs the appointment-detail
                                                    view since no GET-by-id endpoint exists)
apps/student/src/hooks/useCancelAppointment.ts
apps/student/src/utils/{validation.ts,errors.ts}
apps/student/src/styles.css
```

### `apps/faculty`

```
apps/faculty/{package.json,vite.config.ts,tsconfig*.json,index.html}
apps/faculty/src/main.tsx, App.tsx
apps/faculty/src/components/Layout.tsx
apps/faculty/src/pages/{Login,Dashboard,PendingRequests,UpcomingAppointments,History,Availability}.tsx
apps/faculty/src/lib/errorMessage.ts
apps/faculty/src/styles.css
```

### `apps/admin`

```
apps/admin/{package.json,vite.config.ts,tsconfig*.json,index.html}
apps/admin/src/main.tsx, App.tsx
apps/admin/src/session/AdminSessionContext.tsx   — local-only display name, deliberately NOT the shared
                                                    SessionProvider (there is no ADMIN role server-side —
                                                    see Section 6)
apps/admin/src/routes/ProtectedRoute.tsx
apps/admin/src/layout/AdminLayout.tsx
apps/admin/src/components/BlockedPage.tsx
apps/admin/src/pages/{Login,Dashboard,Faculty,Students,Departments,Appointments,
                       AuditLogs,Reports,SystemStatus}.tsx
```

### Root

```
package.json                — npm workspaces (apps/*, packages/*)
docs/MIGRATION_REPORT.md    — this file
```

---

## 4. Files reused vs. rewritten (salvage decisions)

Nothing was copied file-for-file — the three prior submissions were built against a different (in two cases, non-existent or fake) backend and had no shared component library. Every screen was rewritten against `@faculty-scheduling/ui` and the real contract. What was genuinely **reused** was UX structure, wording, and validation logic:

| From | Reused | Rewritten / dropped, and why |
|---|---|---|
| **Rekha — student** (`review/rekha/apps/student/src`) | Reason-length validation thresholds/wording, dashboard "recent activity" structure, status-filter-chip UX on My Appointments, confirm-before-cancel flow, login page's "dev note" framing | `FacultySearch.tsx`, `FacultyProfile.tsx`, `Availability.tsx` — all built against **mock/fake data** — dropped entirely, replaced by the honest `FacultyDirectory` blocked-state page. All API/type/session code replaced by `@faculty-scheduling/ui`. |
| **Sankalp — faculty** (`review/sankalp/apps/faculty/src`) | Dashboard stat-card layout, pending-request card shape (student, slot, reason, Approve/Reject), the complete/missed action pattern with an optional notes field | `AvailabilityEditor.tsx`, `Exceptions.tsx`, `History.tsx`'s mocked stats, and `api/availability.mock.ts`/`history.mock.ts` — **all built against an unauthorized second backend/database that has since been discarded entirely** (never part of this repo). Replaced by the honest `Availability.tsx` blocked page and a real, locally-cached `History.tsx` (Section 6). `apps/backend/` and root `sql/` from that submission do not exist anywhere in this repo and were never touched. |
| **Izhaan — admin** (`review/izhaan_v3/apps/admin/src`) | Sidebar/header layout structure, component naming conventions (`DataTable`, `StatCard`, `EmptyState`/`ErrorState`/`LoadingState`), the design tokens/palette itself (this repo's shared `tokens.css` is adapted directly from this submission's, since it was the most complete and consistent of the three) | Every `services/*.ts` file (all called fabricated/mocked data for entities with no real backend), the fake email/password `Login.tsx`, and the hardcoded-stats `Dashboard.tsx` — all replaced by the honest `BlockedFeature`-based pages in Section 6. |

None of the three original submissions' files were deleted, because none were ever part of this repository — they remain wherever they were originally submitted, untouched and unaffected by this work.

---

## 5. A real integration bug found and fixed during verification

While standing up the real backend against a real local PostgreSQL 16 database (see Section 7) and exercising every endpoint each frontend actually calls, `GET /api/appointments/pending` was found to return a **different shape** than assumed: it reads from the `faculty_pending_requests` **view** (`services/api/migrations/sql/0004_views.sql`), not the `appointments` table directly, so it adds `student_name`/`roll_number` (joined from `students`/`users`) but omits `status`, `client_request_id`, `responded_at`, `responded_by`, `cancelled_by`, `completion_notes`, `created_at`, and `updated_at`.

The faculty app's pending-requests and dashboard screens were initially typed against the generic `AppointmentRow`, which would have compiled fine but silently dropped the two real fields the endpoint actually provides, and risked a runtime crash the day any code assumed `.status` or `.completion_notes` existed on a pending row. Fixed by adding a dedicated `FacultyPendingRequestRow` type to `packages/ui/src/types/index.ts` (mirroring the view's exact `SELECT` list), updating `appointmentsApi.listPending()`'s return type, and updating both consuming screens — which also let the pending-request cards show the student's real name and roll number instead of just an ID. Verified against the real endpoint before and after the fix.

---

## 6. Exactly what's real vs. honestly blocked, per screen

### Student app — real
- Login (dev-login, sends real `X-User-Id`/`X-User-Role: STUDENT` headers)
- Dashboard stats (from real `GET /appointments/mine`)
- Request Appointment (real `POST /appointments`, with a generated `crypto.randomUUID()` `clientRequestId`, reused on retry)
- My Appointments (real `GET /appointments/mine`), Cancel (real `PATCH /:id/cancel`)
- Appointment Detail — derived from the already-fetched list (no GET-by-id endpoint exists)

### Student app — honestly blocked / partial
- **Faculty Directory** — no faculty search/listing/profile endpoint exists. Shows a `BlockedFeature` state naming the missing endpoints, plus a real, honestly-labeled list of faculty IDs the student has actually corresponded with (derived from their own real appointment history — not fabricated).
- The Request Appointment form takes a plain Faculty ID text field and two `datetime-local` inputs (no live availability lookup exists to build a slot picker against).

### Faculty app — real
- Login (dev-login, `X-User-Role: FACULTY`)
- Pending Requests (real `GET /appointments/pending`), Approve/Reject (real `PATCH`)
- Complete / Mark Missed / Cancel (real `PATCH`)

### Faculty app — real-but-locally-cached (not mock data — see explanation)
- **Upcoming Appointments** and **History** — there is no endpoint that lists a faculty member's APPROVED/COMPLETED/MISSED/REJECTED/CANCELLED appointments; `GET /appointments/pending` only ever returns PENDING ones. The only way this frontend ever learns of a non-pending appointment is from the JSON response of an action it just performed. Both screens read from a small `localStorage` cache (`packages/ui/src/utils/localCache.ts`) populated **only** from real API responses (never fabricated), and both screens display a visible banner explaining this is a device-local, incomplete list — not a substitute for a real listing endpoint (which is filed in Section 8).

### Faculty app — honestly blocked
- **Availability & Exceptions** — no endpoint exists at all (`docs/IMPLEMENTATION_STATUS.md`: "Faculty still cannot manage their own availability through any code path"). Shows `BlockedFeature` naming the two missing endpoints.

### Admin app — real
- **System Status** — the one genuinely real page: calls the real, unauthenticated `GET /health`.
- The login screen is an honest local-only name entry (never sent as any header) — there is no `ADMIN` role in `identify.middleware.ts` and zero admin endpoints exist, so nothing about admin "login" can be real yet.

### Admin app — honestly blocked (all data pages)
Dashboard, Faculty, Students, Departments, Appointments, Audit Logs, Reports — every one shows `BlockedFeature` naming the exact missing endpoint (full list in Section 8). No fabricated tables, charts, or stats anywhere in this app.

---

## 7. Build & integration verification actually performed

- `npm install` at the workspace root — clean, all four packages (`ui`, `student`, `faculty`, `admin`) resolve correctly via npm workspaces.
- `npm run build` (`tsc -b && vite build`) for **all three apps — zero TypeScript errors, zero build errors.**
- **Real integration test, not just code review:** installed PostgreSQL 16 in the sandbox, ran all 8 migrations (`0001`–`0008`) and both seed files from a clean database exactly per `README.md`'s documented steps, started the actual `services/api` server (`ts-node src/server.ts`) against it, and exercised the real HTTP API end-to-end:
  - Booked a real appointment, listed it as a student, listed it as pending faculty, approved it, completed it with notes — full lifecycle, real database, real responses.
  - Confirmed the double-booking conflict (`409 SLOT_CONFLICT`), an unauthorized cancel (`404 NOT_FOUND`), and no-identity (`401 UNAUTHENTICATED`) all return exactly the codes/shapes every frontend's error handling expects.
  - Started the student app's actual Vite dev server and round-tripped real requests through its `/api` proxy to the real backend, confirming the CORS workaround (Section 9) genuinely works, not just in theory.
  - This is how the bug in Section 5 was actually found.
  - The local Postgres instance and the temporary `services/api/.env` used for this test were left in place in the sandbox for reference but are not part of any deliverable; `.env` was never committed (already `.gitignore`d) and contains only local default credentials.

---

## 8. Remaining backend dependencies — filed the way this project already files them

Following the same template already used in `docs/GITHUB_ISSUES.md`:

### [BACKEND DEPENDENCY] Faculty availability HTTP endpoints
**Feature:** Faculty availability editor & exceptions (faculty app), slot picker (student app)
**What's needed:** `GET /api/faculty/:facultyId/availability`, `PUT /api/faculty/availability`, `POST /api/faculty/availability/exceptions`
**Current status:** Database-level `is_faculty_available()`/`get_available_slots()` and overlap protection are complete and tested; no Repository/Service/route layer exists yet.
**Why frontend cannot proceed:** No callable endpoint at all — confirmed by reading `services/api/src/routes/appointment.routes.ts` in full.
**Priority:** High — this is the single biggest gap in the student/faculty experience today.

### [BACKEND DEPENDENCY] A faculty directory / search endpoint
**Feature:** Faculty Directory (student app)
**What's needed:** `GET /api/faculty` (list, minimally id + name + department), `GET /api/faculty/:id` (profile)
**Current status:** Not started. A `faculty`/`users`/`departments` schema exists (`migrations/sql/0001`), but nothing exposes it over HTTP.
**Why frontend cannot proceed:** Students currently must already know a faculty member's numeric ID to request an appointment.
**Priority:** High.

### [BACKEND DEPENDENCY] A faculty-scoped listing endpoint beyond "pending"
**Feature:** Upcoming Appointments & History (faculty app) — currently backed by an honest, labeled, device-local cache only (Section 6)
**What's needed:** e.g. `GET /api/appointments/mine-as-faculty` returning all statuses, or `?status=` filtering on an existing/new endpoint.
**Current status:** Not started. Only `faculty_pending_requests` (PENDING-only) exists.
**Why frontend cannot proceed:** No way to reconstruct a faculty member's full appointment list from a fresh session/device today.
**Priority:** High — this is the second-biggest real gap, and the local-cache workaround is explicitly a stopgap.

### [BACKEND DEPENDENCY] Admin & reporting endpoints, and an ADMIN role
**Feature:** Entire admin app
**What's needed:** An `ADMIN` role in `identify.middleware.ts`'s `VALID_ROLES`, plus `GET/POST/PATCH/DELETE /api/admin/{faculty,students,departments}`, read-only `GET /api/admin/appointments` (must stay read-only for admins even once built — appointment decisions belong to students/faculty), read-only `GET /api/admin/audit-log` (shape should mirror the real `audit_log` table: `entity_type, entity_id, action, actor_id, old_data, new_data, created_at`), `GET /api/admin/dashboard`, `GET /api/admin/reports/appointments-summary`.
**Current status:** Not started at all — zero admin routes, zero ADMIN role support.
**Why frontend cannot proceed:** Nothing to call, nothing to authenticate as.
**Priority:** Medium — the admin app is fully shelled and ready to wire up the moment any of these land, incrementally, one endpoint at a time.

### [BACKEND DEPENDENCY] Real authentication
**Feature:** All three apps' "login"
**What's needed:** Replace `identify.middleware.ts`'s header-trust scheme with real session/token verification, per its own documented "Task 2 in the roadmap" comment.
**Current status:** Deliberate, documented temporary stand-in.
**Why frontend cannot proceed:** N/A today (all three apps already integrate correctly against the real scheme) — filed so it isn't forgotten, since every dev-login screen will need a small, contained update (not a rewrite) once this lands, per `identify.middleware.ts`'s own comment that only its implementation needs to change.
**Priority:** Medium.

### [BACKEND DEPENDENCY] CORS
**Feature:** All three apps, for any real (non-dev-proxy) deployment
**What's needed:** `services/api` currently registers no CORS middleware (`src/app.ts`). Each app's Vite dev server works around this with a same-origin `/api` proxy (Section 9), which only works in dev.
**Current status:** Not started.
**Why frontend cannot proceed:** A production build served from a different origin than the API would be blocked by the browser today.
**Priority:** Low for now (dev proxy covers current needs) — needed before any real deployment.

---

## 9. Notable engineering decisions

- **npm workspaces monorepo** (`packages/ui`, `apps/*`) so all three apps share one design system, one API client, and one set of types — instead of three independently-drifting copies, which is exactly the kind of duplication the original three submissions had (three separate `StatusBadge` implementations, three separate API client patterns).
- **Vite dev-proxy for `/api`**, not a CORS change to the backend — `services/api` was explicitly off-limits; the proxy keeps every dev request same-origin without touching backend code. Flagged as a real gap for any non-dev deployment (Section 8).
- **`crypto.randomUUID()` client-request IDs**, generated once per submission attempt and reused only on a genuine retry of the same attempt — matches the backend's documented idempotency contract exactly (`AppointmentRepository.bookAppointment`'s handling of `23505`/`23P01`/`40P01` alongside a matching `client_request_id`).
- **The local-cache pattern (Section 6)** is the one deliberately non-obvious design decision in this whole pass — it is real data, always labeled, never presented as a complete list, and exists only because of a real, filed backend gap (Section 8). It was a specific, considered response to the "no mock data" constraint, not a loophole around it.

---

## 10. How to run this for real

### macOS / Linux

```bash
# Backend (unchanged)
cd services/api
npm install
cp .env.example .env
service postgresql start
createdb -U postgres faculty_scheduling
for f in migrations/sql/0*.sql; do psql -U postgres -d faculty_scheduling -f "$f"; done
psql -U postgres -d faculty_scheduling -f migrations/sql/seed_test_data.sql
psql -U postgres -d faculty_scheduling -f migrations/sql/seed_availability_test_data.sql
npm run dev

# Frontends (new) — from the repo root, each in its own terminal
npm install
npm run dev:student   # http://localhost:5173
npm run dev:faculty   # http://localhost:5174
npm run dev:admin     # http://localhost:5175
```

### Windows (cmd.exe)

```bat
:: Backend (unchanged)
cd services\api
npm install
copy .env.example .env

:: Start PostgreSQL if it isn't already running as a service.
:: Check services.msc for the exact name (usually postgresql-x64-<version>).
net start postgresql-x64-16

:: Uses the postgres superuser password you set at install time (see note below).
createdb -U postgres faculty_scheduling
for %f in (migrations\sql\0*.sql) do psql -U postgres -d faculty_scheduling -f "%f"
psql -U postgres -d faculty_scheduling -f migrations\sql\seed_test_data.sql
psql -U postgres -d faculty_scheduling -f migrations\sql\seed_availability_test_data.sql
npm run dev

:: Frontends (new) — from the repo root, each in its own terminal
npm install
npm run dev:student   :: http://localhost:5173
npm run dev:faculty   :: http://localhost:5174
npm run dev:admin     :: http://localhost:5175
```

**Windows notes:**
- The `for %f in (...)` loop syntax above is for typing directly at a `cmd.exe` prompt. Inside a `.bat` script file, double the percent signs (`%%f`).
- If `createdb`/`psql` fail with `password authentication failed for user "postgres"`, that's the Postgres superuser password set when PostgreSQL was installed (not a project setting) — check pgAdmin if it has it saved, or reset it: open `C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf`, temporarily set the `postgres` line's auth method to `trust`, restart the service, run `psql -U postgres` (no password) and `ALTER USER postgres WITH PASSWORD 'newpassword';`, then revert `pg_hba.conf` and restart the service again.
- If `createdb`/`psql` aren't recognized at all, add PostgreSQL's `bin` folder (e.g. `C:\Program Files\PostgreSQL\16\bin`) to your `PATH`, or run them with the full path.

Seeded test identities (from `seed_test_data.sql`, matching `tests/http/appointment.http.test.ts`): students `100`/`101`, faculty `200`/`201` — use any of these IDs at each app's login screen.
