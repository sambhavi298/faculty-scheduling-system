# Proposed GitHub Issues

Drafted for Sambhavi to create as actual GitHub Issues once the repository exists. Endpoints below are taken verbatim from the established Level 5 API contract table (`docs/level-5-low-level-design.md` in the project docs) — none are invented here.

**Update (Phase 2):** the Appointment Management module of the HTTP layer now exists and is tested — `POST /api/appointments`, `GET /api/appointments/mine`, `GET /api/appointments/pending`, and `PATCH /api/appointments/:id/{approve,reject,cancel,complete,missed}` (see `docs/DEVELOPMENT_HANDOFF.md`, "HTTP layer"). Issues that depend only on those endpoints are marked **Unblocked** below and can start now. Everything depending on Faculty Availability endpoints, real authentication, or an admin/reporting endpoint is still **Blocked** — those genuinely don't exist yet.

**One thing every unblocked issue needs to know:** there is no real authentication yet. The API currently reads caller identity from two request headers, `X-User-Id` and `X-User-Role` (`STUDENT` or `FACULTY`), sent directly by the client with no verification (see `docs/DEVELOPMENT_HANDOFF.md`, "HTTP layer", for the full rationale). Frontend work should send these headers from wherever the app currently keeps "the logged-in user" (even a hardcoded dev value while there's no login screen), but should not hardcode the header mechanism deeply into UI components — it will be replaced by a real token once Task 2 (authentication) lands, and per Level 5 this is meant to be an implementation detail behind whatever HTTP client wrapper the frontend uses.

A few endpoints referenced by the Admin/Reporting screens (faculty/student/batch/department CRUD, system usage overview, audit log viewer) are named only conceptually in the Level 1/3 design docs (the "Administration Module" and "Reporting Module") — Level 5's API contract table does not give them concrete paths yet. Those are marked **"path not yet defined"** below rather than invented, so Mohammed Izhaan's work doesn't get built against a contract nobody agreed to.

---

## Rekha — Student Frontend

### Issue: Student authentication UI

**Objective:** Login screen for students.
**Scope:** Login form, session/token storage, redirect-on-success, logout.
**Files/directories likely affected:** `apps/student/` (or equivalent — frontend directory structure not yet established; propose one in the PR).
**API endpoints required:** Not yet defined at Level 5 — Level 2 specifies self-issued JWT with role claims, but no `/api/auth/login` path is in the Level 5 contract table yet. **Blocked** on the backend auth endpoint being defined and built.
**Dependencies:** Backend HTTP layer + authentication (not started).
**Acceptance criteria:** A student can log in with valid credentials and reach the authenticated app shell; invalid credentials show a clear error; the session persists across a page refresh.
**Tests required:** Component tests for the form (validation, error states); an integration/E2E test once the backend auth endpoint exists.
**Must NOT change:** Any backend code, the JWT claim shape once defined, other frontend apps' code.

### Issue: Faculty search

**Objective:** Let a student find a faculty member by name/department.
**Scope:** Search input, results list.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** Not yet defined — faculty directory listing/search is not in the Level 5 contract table (it only covers appointments/availability). **Blocked** on this endpoint being defined.
**Dependencies:** Backend HTTP layer.
**Acceptance criteria:** Typing a name/department filters results; selecting a result navigates to that faculty member's profile.
**Tests required:** Component tests with a mocked API response.
**Must NOT change:** Backend code.

### Issue: Faculty profile

**Objective:** Show a faculty member's basic profile (name, department, office location).
**Scope:** Profile display screen.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** Not yet defined (faculty profile read). **Blocked.**
**Dependencies:** Backend HTTP layer.
**Acceptance criteria:** Given a faculty id, the correct profile data renders; a nonexistent id shows a clear "not found" state.
**Tests required:** Component tests with mocked data.
**Must NOT change:** Backend code.

### Issue: Availability display

**Objective:** Show a faculty member's bookable slots for a chosen date.
**Scope:** Date picker + slot list, reading from `GET /api/faculty/:facultyId/availability?date=YYYY-MM-DD`.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `GET /api/faculty/:facultyId/availability?date=YYYY-MM-DD` (Level 5 contract table). **Blocked** until this endpoint is implemented server-side (it currently only exists as `get_available_slots()` at the database layer — no Controller wraps it yet).
**Dependencies:** Backend HTTP layer wrapping `AvailabilityService`/`get_available_slots()`.
**Acceptance criteria:** Selecting a date shows that day's real bookable slots; an empty day (e.g. declared leave) shows a clear empty state, not an error.
**Tests required:** Component tests with mocked API responses covering both the populated and empty cases.
**Must NOT change:** The slot data shape returned by the endpoint once defined; backend code.

### Issue: Appointment request

**Objective:** Let a student submit an appointment request for a chosen slot with a reason.
**Scope:** Request form (slot pre-filled from the previous screen, reason text field, client-side length validation matching the 5–1000 character database constraint), submission, pending confirmation.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `POST /api/appointments` (Level 5 contract table — request body `{facultyId, slotStart, slotEnd, reason, clientRequestId}`, response `{id, status: 'PENDING', ...}`). Must generate and send a `clientRequestId` (e.g. `crypto.randomUUID()` — must be a real UUID, the column is typed `uuid`) so a retried submission (double-click, refresh) doesn't create a duplicate — the backend's idempotency handling depends on the client actually sending this. **Unblocked** — implemented and tested (`tests/http/appointment.http.test.ts`); requires `X-User-Id`/`X-User-Role: STUDENT` headers (see note at top of this document).
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** A valid request succeeds and shows a pending confirmation; a `409 SLOT_CONFLICT` response (the slot was taken between the student viewing it and submitting) shows a clear "no longer available, please pick another slot" message rather than a generic error; a too-short reason is caught client-side before submission.
**Tests required:** Component tests covering success, conflict, and validation-failure states.
**Must NOT change:** The request/response shape defined in Level 5; the idempotency-key requirement.

### Issue: My appointments

**Objective:** List the student's own appointments (pending, upcoming, history).
**Scope:** List/tab view reading from `GET /api/appointments/mine`.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `GET /api/appointments/mine` (Level 5 contract table). **Unblocked** — implemented and tested; requires `X-User-Id`/`X-User-Role: STUDENT` headers.
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Shows the student's own appointments only, grouped/filterable by status; never shows another student's data (this is a backend-enforced guarantee — the frontend should not need its own filtering logic to achieve it, but should handle an empty list gracefully).
**Tests required:** Component tests with mocked mixed-status data.
**Must NOT change:** Backend authorization logic.

### Issue: Appointment status

**Objective:** Show the current status of a single appointment with clear visual states (pending/approved/rejected/cancelled/completed/missed).
**Scope:** Status detail view/badge component, reused from the "My appointments" list.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** Reads from the same `GET /api/appointments/mine` response (or a future single-appointment `GET`, not yet in the Level 5 table — propose reusing the list response first rather than adding a new endpoint unless genuinely needed).
**Dependencies:** "My appointments" issue above.
**Acceptance criteria:** Every one of the seven statuses (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `COMPLETED`, `MISSED`, `EXPIRED`) renders a distinct, clear visual state — these must match `AppointmentStateMachine`'s status list exactly (`src/domain/appointment-state-machine.ts`), not a frontend-invented subset.
**Tests required:** Component tests, one per status.
**Must NOT change:** The status enum — it is defined in the database (`appointment_status` type) and mirrored in `AppointmentStateMachine`; do not introduce a different set of status strings in the frontend.

### Issue: Cancellation

**Objective:** Let a student cancel their own pending or approved appointment.
**Scope:** Cancel action + confirmation, using `PATCH /api/appointments/:id/cancel`.
**Files/directories likely affected:** `apps/student/`.
**API endpoints required:** `PATCH /api/appointments/:id/cancel` (Level 5 contract table). **Unblocked** — implemented and tested; either `X-User-Role: STUDENT` or `FACULTY` is accepted at the route, but the caller must actually be a party to the appointment (student or faculty on that row) or the API returns `404`.
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Cancelling a pending/approved appointment succeeds and updates the UI immediately; attempting to cancel an already-terminal appointment (e.g. already completed) shows the `409` error clearly rather than a generic failure.
**Tests required:** Component tests for both the success and already-terminal-state cases.
**Must NOT change:** Backend cancellation logic or ownership rules.

---

## Sankalp — Faculty Frontend

### Issue: Faculty dashboard

**Objective:** Landing screen for a logged-in faculty member summarizing pending requests and today's upcoming appointments.
**Scope:** Summary cards/counts.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/appointments/pending` (Level 5 contract table) for the pending count — **unblocked**, implemented and tested; requires `X-User-Id`/`X-User-Role: FACULTY` headers. Upcoming-today still needs a filtered view of the same or a new read — confirm with Sambhavi before adding a new endpoint; that part remains **blocked**.
**Dependencies:** None remaining for the pending count; real authentication is still not built (see the header note at the top of this document).
**Acceptance criteria:** Counts match what's actually in the database for that faculty member; zero-state (no pending requests) renders cleanly.
**Tests required:** Component tests with mocked counts.
**Must NOT change:** Backend code.

### Issue: Availability management

**Objective:** Let a faculty member declare/edit their weekly availability windows and one-off exceptions (leave/meeting/block).
**Scope:** Weekly schedule editor, exception form.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PUT /api/faculty/availability` and `POST /api/faculty/availability/exceptions` (Level 5 contract table). **Blocked** — and note this also needs an application-layer `FacultyAvailabilityRepository`/`Service` that does not exist yet (documented gap in `docs/IMPLEMENTATION_STATUS.md`); only the database-level overlap protection (migration 0007) exists so far.
**Dependencies:** Backend HTTP layer + `FacultyAvailabilityService` (not yet built).
**Acceptance criteria:** Submitting an overlapping window shows the database's rejection as a clear, specific error (not a generic 500) — the database (migration 0007's exclusion constraint) is the actual source of truth here, the frontend should surface its rejection reason, not attempt to re-implement the overlap check itself.
**Tests required:** Component tests for the editor, including the overlap-rejection error state once the backend contract for that error exists.
**Must NOT change:** The overlap-protection logic itself (database-enforced, do not attempt to duplicate it client-side).

### Issue: Appointment request list

**Objective:** Show incoming pending requests for this faculty member.
**Scope:** List view reading from `GET /api/appointments/pending`.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `GET /api/appointments/pending` (Level 5 contract table, backed by the `faculty_pending_requests` view). **Unblocked** — implemented and tested; requires `X-User-Id`/`X-User-Role: FACULTY` headers. Note the view's rows don't include a `status` field (it's implicitly `PENDING` by the view's own `WHERE` clause) — don't expect one in the response.
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Shows only this faculty member's own pending requests, ordered by request time; each entry shows the student's name and stated reason.
**Tests required:** Component tests with mocked data.
**Must NOT change:** Backend authorization/ownership logic.

### Issue: Approve

**Objective:** Let a faculty member approve a pending request.
**Scope:** Approve action from the request list.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PATCH /api/appointments/:id/approve` (Level 5 contract table). **Unblocked** — implemented and tested; requires `X-User-Id`/`X-User-Role: FACULTY` headers, and the caller must own the appointment (`404` otherwise).
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Approving updates the item's status immediately in the UI; approving an already-approved item is a harmless no-op (matches the Service layer's idempotent behavior — do not show an error for this case); approving something genuinely invalid (e.g. already rejected) shows the `409` clearly.
**Tests required:** Component tests for success, no-op, and invalid-transition states.
**Must NOT change:** Backend approval logic.

### Issue: Reject

**Objective:** Let a faculty member reject a pending request, optionally with a reason.
**Scope:** Reject action + optional reason input.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PATCH /api/appointments/:id/reject` (Level 5 contract table, optional `{reason?}` body). **Unblocked** — implemented and tested; same auth requirements as Approve above.
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Same idempotent/invalid-transition handling as Approve above.
**Tests required:** Component tests mirroring the Approve issue.
**Must NOT change:** Backend rejection logic.

### Issue: Upcoming appointments

**Objective:** Show this faculty member's approved, upcoming appointments (e.g. today/this week calendar view).
**Scope:** Calendar/list view.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** Not yet explicitly defined for a faculty-scoped upcoming view — `GET /api/appointments/pending` covers pending only; an upcoming-approved read needs to be proposed and confirmed rather than invented here.
**Dependencies:** Backend HTTP layer.
**Acceptance criteria:** Shows only approved, future-dated appointments for this faculty member.
**Tests required:** Component tests with mocked data.
**Must NOT change:** Backend code.

### Issue: Complete

**Objective:** Let a faculty member mark an approved appointment as completed, with optional notes.
**Scope:** Complete action + optional notes field.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PATCH /api/appointments/:id/complete` (Level 5 contract table, optional `{notes?}` body). **Unblocked** — implemented and tested; same auth/ownership requirements as Approve above.
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Only an APPROVED appointment owned by this faculty member can be completed; attempting on a still-pending or not-owned appointment shows the appropriate error rather than succeeding silently.
**Tests required:** Component tests for success and both error cases.
**Must NOT change:** Backend completion logic.

### Issue: Mark missed

**Objective:** Let a faculty member mark an approved appointment as missed (the student didn't show up).
**Scope:** Mark-missed action.
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** `PATCH /api/appointments/:id/missed` (Level 5 contract table). **Unblocked** — implemented and tested; same auth/ownership requirements as Approve above.
**Dependencies:** None remaining for this endpoint.
**Acceptance criteria:** Same ownership/state rules as Complete above.
**Tests required:** Component tests mirroring the Complete issue.
**Must NOT change:** Backend logic.

### Issue: Appointment history

**Objective:** Let a faculty member browse their own past appointments and basic stats.
**Scope:** History list + summary stats (from `faculty_appointment_stats`).
**Files/directories likely affected:** `apps/faculty/`.
**API endpoints required:** Not yet defined at the HTTP layer — the data exists in the `faculty_appointment_stats` materialized view, but no endpoint reads it yet.
**Dependencies:** Backend HTTP layer + Reporting module endpoint (not yet built).
**Acceptance criteria:** Stats shown match the materialized view's last-refreshed values; the UI should indicate these are periodically refreshed figures, not necessarily real-time (matches the materialized view's actual behavior — do not imply real-time accuracy it doesn't have).
**Tests required:** Component tests with mocked data.
**Must NOT change:** Backend reporting logic.

---

## Mohammed Izhaan — Admin + Integration

### Issue: Admin dashboard

**Objective:** Landing screen summarizing system usage (appointment volume, active faculty/students).
**Scope:** Summary view.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** Path not yet defined (Reporting/Administration module, conceptually described in Level 1/3, no concrete endpoint in the Level 5 table). Propose an endpoint and confirm with Sambhavi before building against it.
**Dependencies:** Backend HTTP layer, authentication, an admin-scoped reporting endpoint (not yet built).
**Acceptance criteria:** TBD once the endpoint is defined — do not hardcode assumptions about its shape in advance.
**Tests required:** Component tests once the endpoint contract is confirmed.
**Must NOT change:** Backend code.

### Issue: Faculty/student management

**Objective:** CRUD screens for faculty, student, batch, and department records (the "Administration Module" from Level 3).
**Scope:** List/create/edit/deactivate screens for each entity.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** Path not yet defined — this is real, not-yet-built backend work (an `AdministrationService`/Controller layer over the existing `users`/`students`/`faculty`/`departments`/`batches` tables). Do not invent REST paths here; propose them alongside the backend work and get them added to the API contract table.
**Dependencies:** Backend HTTP layer + an Administration module (not started).
**Acceptance criteria:** TBD once the backend contract exists.
**Tests required:** Component tests once the contract is confirmed.
**Must NOT change:** The exclusion constraint, audit trigger, or any transactional appointment logic — admin actions must go through the same guarded functions/triggers as any other actor (Level 3, Security Architecture: "admin-initiated changes go through the same transactional functions and are captured by the same triggers as any other actor").

### Issue: Reports

**Objective:** Surface reporting/analytics (faculty responsiveness, demand concentration, etc.) from the Reporting module.
**Scope:** Report views, likely reading `faculty_appointment_stats` and future reporting queries.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** Path not yet defined.
**Dependencies:** Backend HTTP layer + Reporting module endpoints (not started).
**Acceptance criteria:** TBD once the endpoint contract exists.
**Tests required:** Component tests once the contract is confirmed.
**Must NOT change:** Backend query logic; do not bypass the materialized view to hit raw tables directly from the frontend.

### Issue: Audit information

**Objective:** Read-only audit log viewer for admins.
**Scope:** List/filter view over `audit_log`.
**Files/directories likely affected:** `apps/admin/`.
**API endpoints required:** Path not yet defined. Per Level 3's Security Architecture, this must be a read-only path — no role, including admin's application role, has UPDATE/DELETE grants on `audit_log`, and the endpoint must not attempt to expose any write capability.
**Dependencies:** Backend HTTP layer + a read-only audit endpoint (uses the existing, unused `AuditRepository` design from Level 5 — not yet implemented in code).
**Acceptance criteria:** TBD once the endpoint exists; must be genuinely read-only end-to-end.
**Tests required:** Component tests once the contract is confirmed; confirm no write action is exposed anywhere in the UI for this screen.
**Must NOT change:** The audit trigger, the `REVOKE INSERT, UPDATE, DELETE ON audit_log FROM app_runtime` database grant, or any backend code that would weaken audit-log immutability.

### Issue: API integration tests

**Objective:** End-to-end tests exercising the real HTTP API (Controller → Service → Repository → PostgreSQL), building on the existing backend-only integration/concurrency/security test suites.
**Scope:** New test suite(s) under a `tests/e2e/` or similar directory, run against a real running instance of the API and a real PostgreSQL database — no mocking of database-dependent behavior, consistent with the rest of this project's testing approach.
**Files/directories likely affected:** New test directory; does not modify existing backend test files.
**API endpoints required:** **Unblocked for the Appointment Management lifecycle** — `tests/http/appointment.http.test.ts` already covers the request/approve/reject/cancel/complete/missed lifecycle and one conflict scenario against the real HTTP layer (in-process via `supertest`, not a separately-running server process). What's still genuinely open for this issue: (a) true multi-process concurrency through HTTP — the existing double-booking concurrency test drives `AppointmentService`/`AppointmentRepository` directly, not HTTP, so a "two simultaneous HTTP POSTs for the same slot" version doesn't exist yet; (b) tests against a separately-running server process (`npm run dev` / a built `dist/`) rather than an in-process app instance, if that distinction matters for this issue's goals; (c) anything touching Faculty Availability, still blocked.
**Dependencies:** None for the appointment lifecycle piece; Faculty Availability endpoints for the rest.
**Acceptance criteria:** Covers, at minimum, the flagship concurrency scenario (two simultaneous booking requests for the same slot, exercised through the real HTTP API rather than directly against the repository) and the standard request/approve/reject/cancel/complete/missed lifecycle end-to-end.
**Tests required:** This issue *is* the tests.
**Must NOT change:** Existing backend unit/integration/concurrency/security/advanced-SQL/HTTP tests — this is additive, not a replacement.

### Issue: Frontend/backend integration support

**Objective:** Help Rekha and Sankalp unblock integration issues as their frontends come online against the real API.
**Scope:** Cross-cutting — not a single feature.
**Dependencies:** The other frontend and backend issues above.
**Acceptance criteria:** N/A — ongoing support role.
**Must NOT change:** N/A.

### Issue: Documentation

**Objective:** Keep `docs/DEVELOPMENT_HANDOFF.md` and `docs/IMPLEMENTATION_STATUS.md` current as the HTTP layer, auth, notifications, and frontends are built.
**Scope:** Documentation only.
**Dependencies:** None to start; ongoing as other issues close.
**Acceptance criteria:** Both docs accurately reflect actual implementation state at all times — per this project's own honesty rule, never mark something complete in the status table until it genuinely is.
**Must NOT change:** N/A.
