# Proposed GitHub Issues

Originally drafted for Sambhavi to create as actual GitHub Issues once the repository existed. Endpoints below are taken verbatim from this project's actual, implemented API — see `docs/DEVELOPMENT_HANDOFF.md`'s "HTTP layer" section for the authoritative endpoint table.

**This is the fully-updated version.** Every issue below that earlier versions of this document marked "Blocked," "Unblocked," or "path not yet defined" is now **Done** — real, live, tested code, not just a callable endpoint. Backend: 531/531 tests passing (`npm test` in `services/api`). Frontend: all three apps typecheck and build clean, are smoke-tested against a real running backend, and have 22 real Vitest component tests (Login for all three apps, Faculty History, Admin Departments). A small number of items remain genuinely open; each is called out individually where it applies (faculty availability exceptions listing, a faculty stats background-refresh job, admin delete/deactivate UI, broader component test coverage, true multi-process HTTP concurrency testing).

**Authentication, for context on every issue below:** `POST /api/auth/login` (`{email, password}` → `{token, user: {id, role, fullName, email}}`), bcrypt-verified, a real 12h JWT. Every other endpoint requires `Authorization: Bearer <token>`; the old `X-User-Id`/`X-User-Role` header scheme this document used to describe no longer exists in any form.

---

## Rekha — Student Frontend

### Issue: Student authentication UI

**Objective:** Login screen for students.
**Scope:** Login form, session/token storage, redirect-on-success, logout.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `POST /api/auth/login`. **Done** — `apps/student/src/pages/Login.tsx` calls it for real; the shared `SessionProvider` (`packages/ui`) stores `{token, id, role, fullName, email}` and rejects a real account whose role isn't STUDENT.
**Dependencies:** None remaining.
**Acceptance criteria:** A student can log in with valid credentials and reach the authenticated app shell; invalid credentials show a clear error ("Incorrect email or password"); the session persists across a page refresh (`localStorage`, per-app storage key).
**Tests required:** `apps/student/src/pages/Login.test.tsx` — real component tests (renders, empty-field validation, successful login stores the session, 401 shows the right error, wrong-role rejection). Component tests for the other student pages listed below are not yet added.
**Must NOT change:** Any backend code, the JWT claim shape, other frontend apps' code.

### Issue: Faculty search

**Objective:** Let a student find a faculty member by name/department.
**Scope:** Search input, results list.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `GET /api/faculty?search=`. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Typing a name/department filters results; selecting a result navigates to that faculty member's profile.
**Tests required:** Component tests with a mocked API response — not yet added.
**Must NOT change:** Backend code.

### Issue: Faculty profile

**Objective:** Show a faculty member's basic profile (name, department, office location).
**Scope:** Profile display screen.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `GET /api/faculty` (directory listing, filtered client-side by id). **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Given a faculty id, the correct profile data renders; a nonexistent id shows a clear "not found" state.
**Tests required:** Component tests with mocked data — not yet added.
**Must NOT change:** Backend code.

### Issue: Availability display

**Objective:** Show a faculty member's bookable slots for a chosen date.
**Scope:** Date picker + slot list, reading from `GET /api/faculty/:facultyId/availability?date=YYYY-MM-DD`.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `GET /api/faculty/:facultyId/availability?date=YYYY-MM-DD`. **Done** (Request Appointment page).
**Dependencies:** None remaining.
**Acceptance criteria:** Selecting a date shows that day's real bookable slots; an empty day (e.g. declared leave) shows a clear empty state, not an error.
**Tests required:** Component tests with mocked API responses — not yet added.
**Must NOT change:** The slot data shape; backend code.

### Issue: Appointment request

**Objective:** Let a student submit an appointment request for a chosen slot with a reason.
**Scope:** Request form, submission, pending confirmation.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `POST /api/appointments`. **Done** — real `Authorization: Bearer <token>` from a real STUDENT login.
**Dependencies:** None remaining.
**Acceptance criteria:** A valid request succeeds and shows a pending confirmation; a `409 SLOT_CONFLICT` shows a clear "no longer available" message; a too-short reason is caught client-side.
**Tests required:** Component tests covering success, conflict, and validation-failure states — not yet added.
**Must NOT change:** The request/response shape; the idempotency-key requirement.

### Issue: My appointments

**Objective:** List the student's own appointments (pending, upcoming, history).
**Scope:** List/tab view reading from `GET /api/appointments/mine`.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `GET /api/appointments/mine`. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Shows the student's own appointments only; handles an empty list gracefully.
**Tests required:** Component tests with mocked mixed-status data — not yet added.
**Must NOT change:** Backend authorization logic.

### Issue: Appointment status

**Objective:** Show the current status of a single appointment with clear visual states.
**Scope:** Status detail view/badge, reused from "My appointments."
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** Reads from the same `GET /api/appointments/mine` response. **Done** (`StatusBadge`, shared package).
**Dependencies:** "My appointments" issue above.
**Acceptance criteria:** Every status renders a distinct, clear visual state matching `AppointmentStateMachine`'s status list exactly.
**Tests required:** Component tests, one per status — not yet added.
**Must NOT change:** The status enum.

### Issue: Cancellation

**Objective:** Let a student cancel their own pending or approved appointment.
**Scope:** Cancel action + confirmation, using `PATCH /api/appointments/:id/cancel`.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `PATCH /api/appointments/:id/cancel`. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Cancelling succeeds and updates the UI immediately; cancelling an already-terminal appointment shows the `409` error clearly.
**Tests required:** Component tests for both cases — not yet added.
**Must NOT change:** Backend cancellation logic or ownership rules.

---

## Sankalp — Faculty Frontend

### Issue: Faculty dashboard

**Objective:** Landing screen for a logged-in faculty member summarizing pending requests and appointment counts.
**Scope:** Summary cards/counts.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/appointments/pending` for the pending count; `GET /api/appointments/mine-as-faculty` for upcoming (APPROVED) and history counts. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Counts match what's actually in the database for that faculty member; zero-state renders cleanly.
**Tests required:** Component tests with mocked counts — not yet added.
**Must NOT change:** Backend code.

### Issue: Availability management

**Objective:** Let a faculty member declare/edit their weekly availability windows and one-off exceptions (leave/meeting/block).
**Scope:** Weekly schedule editor, exception form.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/faculty/availability` (own current windows), `PUT /api/faculty/availability`, `POST /api/faculty/availability/exceptions`. **Done** — `apps/faculty/src/pages/Availability.tsx`: loads current windows, edits a local draft (add/remove rows), and `PUT`s the full set on save; a separate form `POST`s exceptions.
**Dependencies:** None remaining.
**Acceptance criteria:** Submitting an overlapping window shows the real `409 AVAILABILITY_OVERLAP` message (database-enforced, not re-implemented client-side). Since `PUT` replaces the entire set, the editor submits the full current+edited list each time.
**Tests required:** Component tests for the editor, including the overlap-rejection error state — not yet added; backend-side overlap rejection is fully tested (`tests/http/faculty-availability.http.test.ts`).
**Must NOT change:** The overlap-protection logic itself.
**Known gap:** there is still no `GET` for exceptions, so the page can only show exceptions added during the current browser session (labelled honestly with a notice banner, not hidden).

### Issue: Appointment request list

**Objective:** Show incoming pending requests for this faculty member.
**Scope:** List view reading from `GET /api/appointments/pending`.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/appointments/pending`. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Shows only this faculty member's own pending requests, ordered by request time; each entry shows the student's name and stated reason.
**Tests required:** Component tests with mocked data — not yet added.
**Must NOT change:** Backend authorization/ownership logic.

### Issue: Approve / Reject

**Objective:** Let a faculty member approve or reject a pending request.
**Scope:** Approve/Reject actions from the request list.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PATCH /api/appointments/:id/approve`, `PATCH /api/appointments/:id/reject`. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Approving/rejecting updates the item's status immediately; an idempotent no-op and an invalid transition are both handled.
**Tests required:** Component tests for success, no-op, and invalid-transition states — not yet added.
**Must NOT change:** Backend approval/rejection logic.

### Issue: Upcoming appointments

**Objective:** Show this faculty member's approved, upcoming appointments.
**Scope:** List view.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/appointments/mine-as-faculty?status=APPROVED`. **Done** — `apps/faculty/src/pages/UpcomingAppointments.tsx`, real server-side data, no client-side caching.
**Dependencies:** None remaining.
**Acceptance criteria:** Shows real, server-side, cross-device data.
**Tests required:** Component tests with mocked data — not yet added.
**Must NOT change:** Backend code.

### Issue: Complete / Mark missed

**Objective:** Let a faculty member mark an approved appointment as completed (with optional notes) or missed.
**Scope:** Complete/Mark-missed actions.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PATCH /api/appointments/:id/complete`, `PATCH /api/appointments/:id/missed`. **Done.**
**Dependencies:** None remaining.
**Acceptance criteria:** Only an APPROVED appointment owned by this faculty member can be completed/missed; the appropriate error shows otherwise.
**Tests required:** Component tests for success and both error cases — not yet added.
**Must NOT change:** Backend logic.

### Issue: Appointment history

**Objective:** Let a faculty member browse their own past appointments and basic stats.
**Scope:** History list + summary stats.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/appointments/mine-as-faculty` (unfiltered, then filtered client-side), `GET /api/faculty/me/stats`. **Done, including the stats section** — `apps/faculty/src/pages/History.tsx` loads both independently (one failing doesn't block the other), rendering the stats row via the shared `StatCard`/`StatGrid` components.
**Dependencies:** None remaining.
**Acceptance criteria:** History list shows real past appointments; the stats section shows real total/completed/missed/rejected/cancelled counts and average response time, always the caller's own — never another faculty member's.
**Tests required:** `apps/faculty/src/pages/History.test.tsx` — covers the stats section rendering, PENDING rows being excluded from history, and the error-state-is-independent-per-section behavior.
**Must NOT change:** Backend reporting logic.

---

## Mohammed Izhaan — Admin + Integration

### Issue: Admin dashboard

**Objective:** Landing screen summarizing system usage (appointment volume, active faculty/students).
**Scope:** Summary view.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** `GET /api/admin/dashboard`. **Done** — `apps/admin/src/pages/Dashboard.tsx`: real counts + the `faculty_appointment_stats` table.
**Dependencies:** None remaining.
**Acceptance criteria:** Counts and stats shown match `GET /api/admin/dashboard`'s response exactly.
**Tests required:** Component tests — not yet added.
**Must NOT change:** Backend code.

### Issue: Faculty/student management

**Objective:** CRUD screens for faculty, student, batch, and department records.
**Scope:** List/create/edit screens for each entity. **No delete/deactivate UI** — matches the backend, which deliberately has no delete method for any of these entities (no soft-delete column exists on this schema).
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** `GET/POST/PATCH /api/admin/departments`, `/api/admin/batches`, `/api/admin/faculty`, `/api/admin/students`. **Done** — `apps/admin/src/pages/{Faculty,Students,Departments}.tsx` (Departments page also covers Batches — there's no separate nav item, and a batch only ever makes sense scoped to a department). A newly-created account's one-time `temporaryPassword` is shown in a dismissible on-screen banner — no copy-to-clipboard button yet, a reasonable small follow-up.
**Dependencies:** None remaining.
**Acceptance criteria:** Every write surfaces the real validation/conflict errors the API returns (e.g. duplicate email/code → `400 VALIDATION_ERROR` with the backend's own message).
**Tests required:** `apps/admin/src/pages/Departments.test.tsx` — list loading, create-form submission and list refresh, and a real duplicate-code validation error surfacing inline. Faculty/Students pages don't have their own tests yet.
**Must NOT change:** The exclusion constraint, audit trigger, or any transactional appointment logic — confirmed: `AdminService`/the admin frontend pages have no path that creates, approves, rejects, or otherwise mutates an appointment.

### Issue: Reports

**Objective:** Surface reporting/analytics from the Reporting module.
**Scope:** Report views.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** `GET /api/admin/reports/appointments-summary`. **Done** — `apps/admin/src/pages/Reports.tsx`, presents `workload_rank` and `running_total_this_semester` as-is, not reinterpreted client-side.
**Dependencies:** None remaining.
**Acceptance criteria:** Report matches the endpoint's response.
**Tests required:** Component tests — not yet added.
**Must NOT change:** Backend query logic; the frontend never bypasses the materialized view to hit raw tables.

### Issue: Audit information

**Objective:** Read-only audit log viewer for admins.
**Scope:** List/filter view over `audit_log`.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** `GET /api/admin/audit-log?entityType=&entityId=&page=&pageSize=`. **Done** — `apps/admin/src/pages/AuditLogs.tsx`, genuinely read-only end-to-end.
**Dependencies:** None remaining.
**Acceptance criteria:** Filtering by entity type/id works; pagination matches `page`/`pageSize` query params.
**Tests required:** Component tests — not yet added.
**Must NOT change:** The audit trigger, the `REVOKE INSERT, UPDATE, DELETE ON audit_log FROM app_runtime` database grant, or any backend code that would weaken audit-log immutability.

### Issue: API integration tests

**Objective:** End-to-end tests exercising the real HTTP API, building on the existing backend-only integration/concurrency/security test suites.
**Scope:** New test suite(s) under `tests/http/` or `tests/concurrency/`.
**Files/directories likely affected:** Test directories only.
**API endpoints required:** All backend modules are built and covered by in-process HTTP tests (`tests/http/*.test.ts`, real Express app + real PostgreSQL via `supertest`). **Done for the flagship scenario** — `tests/concurrency/double-booking-http.test.ts` fires genuinely concurrent `POST /api/appointments` requests through the real HTTP surface (two-way, then a five-way race, then an overlapping-not-identical-slots case), proving the same guarantee the repository-level test proves, one layer further out. **Still genuinely open:** a true multi-process concurrency test against a separately-launched server process, rather than an in-process `createApp()` instance.
**Dependencies:** None remaining at the backend-module level.
**Acceptance criteria:** Covers the flagship concurrency scenario through the real HTTP API (done) and the standard request/approve/reject/cancel/complete/missed lifecycle end-to-end (done, across the existing HTTP test files).
**Tests required:** This issue *is* the tests — remaining scope is the multi-process variant only.
**Must NOT change:** Existing backend test suites — this is additive.

### Issue: Frontend/backend integration support

**Objective:** Help Rekha and Sankalp unblock integration issues as their frontends come online against the real API.
**Scope:** Cross-cutting — not a single feature. **Done** — all three frontends are wired to the full real backend; remaining integration work is component-level test coverage (see each issue's "Tests required" line above), not blocked wiring.
**Dependencies:** The other frontend and backend issues above.
**Acceptance criteria:** N/A — ongoing support role.
**Must NOT change:** N/A.

### Issue: Documentation

**Objective:** Keep `docs/DEVELOPMENT_HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md`, and this file current as the system evolves.
**Scope:** Documentation only.
**Dependencies:** None to start; ongoing as other issues close.
**Acceptance criteria:** All three docs accurately reflect actual implementation state at all times. **Done as of this update** — all three were rewritten from their Phase-2-era versions (no auth, no admin module, no frontend) to reflect the current full-stack state.
**Must NOT change:** N/A.
