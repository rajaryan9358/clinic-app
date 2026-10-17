# Admin UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clinic staff stop meeting screens shaped like database tables — follow-ups gets a real worklist, records open as pages, loading looks like the thing loading, and a consultation can be billed without hunting for its appointment.

**Architecture:** Four small, named backend additions carry everything the UI needs (doctor fees, a shared fee-line builder, a follow-up complete endpoint, an assignee eager-load); the rest is React in `resources/js/admin/src`. The generic module layer is improved once so Services, Staff Users, Reminders and WhatsApp all benefit, while Patients and Doctors keep the purpose-built pages they already have.

**Tech Stack:** Laravel 13, PHP 8.4, React 19 + Vite + Tailwind 4, PHPUnit (SQLite in-memory). No new UI dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-admin-ui-overhaul-design.md`

## Global Constraints

- Tests `php artisan test`; frontend build `node node_modules/vite/bin/vite.js build`. Both green before every commit.
- **There is no JavaScript test harness and this plan does not add one.** Frontend tasks are verified by the build, the PHP suite and review. Backend tasks are strict TDD.
- Backend work is limited to exactly four additions: doctor fees on the clinic doctors list, extracting `prefillFor`'s line builder, a follow-up complete endpoint, and eager-loading the follow-up assignee. Anything else is frontend-only.
- Permission gating must not change: no screen or action may become reachable to a role that cannot reach it today. `billing.view/create/edit`, `followups.view/edit`, `appointments.view` keep their current meanings.
- Follow-up groups: Overdue, Today, This week (**next seven days**, not the calendar week), Later, Done. Nothing pending is hidden. Done shows the most recent 20. `skipped`/`cancelled` sit with Done under "Closed".
- Follow-up default scope: assigned-to-me for `doctor` and `assistant`; whole clinic for `receptionist` and `clinic_admin`. Either way a filter switches it.
- A row's reason is the `task_type` label (Call, WhatsApp, Review request, Follow-up visit, Lab reminder, Custom) with `note` beneath it; `priority` renders only when high.
- Record payment and Refund **stay inline** on the invoice page — restyle only. Do not route them.
- Patients and Doctors are **excluded** from the generic-layer work: `/modules/patients/:id` → `PatientProfilePage`, `/modules/doctors/:id` → `DoctorSetupFlowPage` already.
- Skeletons on page-level loads only; spinners stay inside buttons and in-place actions.
- Icons come from the existing `AppIcon` set — no new icon library.
- Commits: stage named files only; never `Clinic_Management_System_MVP_PRD.pdf`, `.playwright-mcp/`, `.superpowers/`, `public/build`. Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

1. A follow-up completed by a user without `followups.edit` must be refused by the server, not merely hidden in the UI — `test_completing_a_followup_requires_followups_edit` (Task 1).
2. A follow-up for another clinic must 404 on the complete endpoint, like every other clinic route — `test_completing_another_clinics_followup_is_404` (Task 1).
3. The doctor-fee line a user picks by hand and the line `prefillFor` generates must be byte-identical, or invoices will disagree depending on how they were raised — `test_picked_and_prefilled_fee_lines_are_identical` (Task 1).
4. A doctor with no consultation fee set (null or 0) must not produce a ₹0 line or a crash in the picker — `test_doctor_without_a_fee_offers_no_line` (Task 1).
5. Exposing fees on the doctors list must not widen who can read that list — `test_doctor_fees_require_doctors_view` (Task 1).

---

### Task 1: Backend — doctor fees, shared fee line, follow-up completion

**Files:**
- Modify: `app/Services/Billing/InvoiceService.php` (extract the line builder used by `prefillFor`)
- Modify: `app/Http/Controllers/Api/Clinic/DoctorController.php` (+ the SuperAdmin twin if it exists) — expose `consultation_fee`, `followup_fee`
- Modify: `app/Http/Controllers/Api/Clinic/FollowupTaskController.php` — eager-load the assignee; add `complete`
- Modify: `routes/api.php`
- Test: `tests/Feature/Billing/DoctorFeeLineTest.php`, `tests/Feature/Followups/FollowupCompleteTest.php`

**Interfaces — Produces:**
```php
// InvoiceService: the single source of a fee line's wording and amount.
public static function doctorFeeLine(Doctor $doctor, string $visitType): ?array;
// returns ['description' => 'Consultation - Dr Asha Rao'|'Follow-up consultation - …',
//          'service_id' => null, 'quantity' => 1, 'unit_amount' => float]  — null when the fee is null or 0.
// prefillFor() must call this rather than keeping its own copy of the wording.

// POST /api/clinic/followups/{id}/complete   (perm:followups.edit)  → the updated task
// GET  /api/clinic/doctors  → each row additionally carries consultation_fee, followup_fee
```
`$visitType` is `'new'` or `'followup'`; anything else is treated as `'new'`. The complete endpoint sets `status = 'done'` and `completed_at = now()`, is idempotent on an already-done task, and does not go through the generic update path.

- [ ] **Step 1: Write the failing tests.** In `DoctorFeeLineTest`: `test_picked_and_prefilled_fee_lines_are_identical` (build an appointment, assert `doctorFeeLine($doctor, $appointment->visit_type)` equals the matching entry from `prefillFor($appointment)` exactly, including the description string); `test_doctor_without_a_fee_offers_no_line` (null fee → null, 0 fee → null); `test_followup_visit_uses_the_followup_fee`; `test_doctors_list_carries_both_fees`; `test_doctor_fees_require_doctors_view` (a user without `doctors.view` still 403s on the list). In `FollowupCompleteTest`: `test_complete_sets_done_and_completed_at`; `test_completing_twice_is_idempotent`; `test_completing_a_followup_requires_followups_edit` (403); `test_completing_another_clinics_followup_is_404`; `test_list_carries_the_assignee_name`.
- [ ] **Step 2: Run `php artisan test tests/Feature/Billing/DoctorFeeLineTest.php tests/Feature/Followups/FollowupCompleteTest.php` — expect FAIL (method/route missing).**
- [ ] **Step 3: Implement** the extraction, the two controller changes and the route.
- [ ] **Step 4: Run both files, then the full `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(admin): doctor fee line, follow-up completion endpoint`

---

### Task 2: Billing — doctor fees without an appointment

**Files:**
- Modify: `resources/js/admin/src/pages/workflows/InvoiceDetailPage.jsx`

**Interfaces — Consumes:** `GET /api/clinic/doctors` (now with both fees), `GET appointments/{id}/invoice-prefill`.

This task also owns the **Record payment / Refund restyle**: they stay exactly where they are on the invoice page (do not route them) but are brought in line with the new look — same spacing, buttons and field styling as the rest of the overhaul.

Beside the existing service picker, a doctor-fee picker: choose doctor + visit type (new / follow-up), and the line is inserted with the description and amount the server's `doctorFeeLine` produces — fetch it rather than formatting the string client-side, so the two can never drift. A doctor with no fee for the chosen visit type is not offered. On the standalone New-invoice path, once a patient is chosen, offer their appointments from the last 90 days that are not cancelled and have no non-cancelled invoice; choosing one prefills exactly as the appointment drawer's "Raise invoice" does.

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green. Step 3: Commit** `feat(admin-ui): bill a doctor fee without an appointment`

---

### Task 3: Generic layer — pages, labels, icons, empty states

**Files:**
- Modify: `resources/js/admin/src/pages/ModuleListPage.jsx` (row view navigates to `/modules/:moduleKey/:id`; drop `RecordDialog`), `pages/ModuleViewPage.jsx` (readable layout), `config/modules.js` (per-module label map; remove the `appointments` sidebar entry), `components/Layout.jsx` (module icons)
- Delete: `resources/js/admin/src/components/RecordDialog.jsx` once nothing imports it

Scope is Services, Staff Users, Reminders, Domains, Clinic Settings and the WhatsApp screens — **not** Patients or Doctors, whose ids already route to their own pages. `ModuleViewPage` gets a header with the record's name and its actions, fields grouped into sections, human labels from the map (falling back to the current prettifier), and a related record rendered by name **only where the API already returns the relation** — never a per-row lookup; otherwise the field is omitted. Empty states say what the screen is for and offer its primary action. The generic `appointments` entry leaves the sidebar (its routes already redirect).

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green; confirm by grep that nothing imports `RecordDialog`. Step 3: Commit** `feat(admin-ui): record pages, human labels and icons for generic modules`

---

### Task 4: Skeletons and dashboard colour

**Files:**
- Create: `resources/js/admin/src/components/Skeleton.jsx`
- Modify: the page-level loads in `ModuleListPage.jsx`, `ModuleViewPage.jsx`, `pages/workflows/{AppointmentsFlowPage,BillingPage,InvoiceDetailPage,PrescriptionPage}.jsx`, `pages/DashboardPage.jsx`

One `Skeleton` component with table-row and form-field shapes, used wherever a page-level fetch currently renders a spinner. Spinners inside buttons and in-place actions stay. In the same pass, `DashboardPage.jsx:696-697` and its neighbours in the super-admin branch pass the `tone` and icon arguments `StatCard` already supports (`:15-19`) so the super-admin overview matches the clinic one.

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green. Step 3: Commit** `feat(admin-ui): skeleton loading and super-admin stat colour`

---

### Task 5: Follow-ups worklist

**Files:**
- Create: `resources/js/admin/src/pages/workflows/FollowupsPage.jsx`, `pages/workflows/FollowupFormPage.jsx`
- Modify: `resources/js/admin/src/App.jsx` (routes `/workflows/followups`, `/workflows/followups/new`), `config/modules.js` (drop the generic `followups` sidebar entry), `components/Layout.jsx` (nav entry under Care, gated `followups.view`)

**Interfaces — Consumes:** `GET /api/clinic/followups` (now carrying the assignee), `POST /api/clinic/followups/{id}/complete`.

Groups and scope exactly as the Global Constraints state. Each row: patient name, the task-type label with `note` beneath, doctor, due date in words ("3 days overdue"), a `tel:` call action (disabled with a reason when the patient has no phone), and Done. Done is one click with a few seconds of undo, hidden without `followups.edit`. Filters for doctor, assignee and status. The add page carries four fields — patient, type, due date, assignee — not the table's eleven.

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green. Step 3: Commit** `feat(admin-ui): follow-ups worklist`

---

### Task 6: Panels become pages

**Files:**
- Create: `resources/js/admin/src/pages/workflows/AppointmentDetailPage.jsx` (wrapping the body of `AppointmentDetailDrawer.jsx`), `pages/workflows/WaitlistAddPage.jsx`
- Modify: `App.jsx` (route `/workflows/appointments/:id`, beside the existing `/:id/prescription`; route for the waitlist add page), `pages/workflows/AppointmentsFlowPage.jsx` (filters move into URL query params; link to the detail route; refetch on return), `pages/workflows/WaitlistPage.jsx` (link to the add page)

The detail page keeps every section the drawer has today, including the E4 invoice line, and is deep-linkable under the permission the queue already uses. Moving the queue's filters into the URL is what makes "back" restore them — do that rather than threading router state through the flow page. The waitlist add page is gated exactly as the waitlist screen is and accepts a prefilled patient or doctor.

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green. Step 3: Commit** `feat(admin-ui): appointment detail and waitlist add as pages`

---

### Task 7: Verification

- [ ] `php artisan test` green; `node node_modules/vite/bin/vite.js build` green.
- [ ] Walk the app against the dev database (`php artisan serve`, MySQL container `clinic-mysql`): follow-ups groups and Done-with-undo as each role; a record view for Services and Staff Users; skeletons on first paint of every page-level load; the super-admin overview's coloured cards; an invoice raised from the Billing page with a doctor fee picked by hand, and the same invoice raised from an appointment — the fee lines must read identically; appointment detail deep-linked, then back to a filtered queue.
- [ ] Confirm nothing regressed for a role that should not see a screen: a doctor without `billing.view` still gets no invoice line on the appointment page; an assistant without `followups.edit` sees no Done button and is refused by the API if they call it anyway.
- [ ] Screenshots under `.superpowers/sdd/2026-10-17-admin-ui-overhaul/e2e/` if a browser is available; if not, say so plainly in the report rather than implying the UI was seen.
