# Admin UI Overhaul — Design

Date: 2026-10-17
Status: Drafted from a conversation with the product owner; decisions marked "theirs" came from them, the rest are the author's calls
Source: the owner's walkthrough of the running app after E4, plus a read of `resources/js/admin/src`

## Why

The admin app has two personalities. Purpose-built pages — the appointments flow, waitlist, patient profile, prescriptions, and the billing pages from E4 — are shaped like the job they serve. Alongside them, a generic layer (`config/modules.js` → `ModuleListPage` / `ModuleFormPage` / `ModuleViewPage`) turns database tables straight into screens: every column a field, filters named after columns, labels like "Assigned To User Id".

Super admins never see the generic screens — `config/access.js` hides them — but **clinic staff do**. A receptionist's sidebar carries both the polished appointments flow and a raw `Appointments` table, and the one screen they use constantly that has no purpose-built page at all is Follow-ups.

The owner's report, in their words: staff hesitate on "appointments, follow up, etc." Asked where the front desk actually spends the day, they said appointments, follow-ups and billing; doctors spend it in appointments and prescriptions. Everything on that list already has a real page **except follow-ups**.

## Goals

1. Clinic staff never meet a screen shaped like a database table.
2. One consistent way to open a record: a page, not a panel.
3. Loading looks like the thing that is loading, not a spinner in an empty box.
4. A receptionist can bill a consultation without first finding the appointment.

## Non-goals

- Rewriting the appointments flow, prescriptions, patient profile or the E4 billing pages — they are the good ones; they get consistency fixes only.
- A visual redesign: no new palette, type scale or component library. This is about shape and consistency within the existing Tailwind vocabulary.
- Backend work beyond three small, named additions: the doctor-fee lookup, eager-loading the follow-up assignee so the worklist shows a name rather than an id, and a dedicated "complete a follow-up" endpoint. Anything else stays frontend-only.
- A super-admin billing screen (noted as a gap after E4; still out of scope).
- Pagination, export, bulk actions, or anything else not already present.

## Anti-goals — ways this ships and is still a failure

- The front desk has to click more than before to do the same job.
- Record payment stops being possible without leaving the invoice.
- A "nicer" screen that hides information staff were relying on.
- Skeletons that flash on fast responses and make the app feel slower.
- Icons chosen for decoration, so staff stop reading them as meaning anything.

## Decisions

| Question | Decision | Whose |
|---|---|---|
| Follow-ups | Gets a purpose-built worklist page, grouped Overdue / Today / This week, patient name and reason rather than ids, Call and Done on the row | **Theirs** (picked option B from a mockup) |
| The other generic screens | Stay generic; the generic layer itself is improved once, so Patients, Services, Staff Users, Reminders and WhatsApp all benefit | **Theirs** |
| Panels and dialogs | The appointment detail drawer, Add to waitlist and the row-view sheet become full pages | **Theirs** ("all of them") |
| Record payment / Refund | **Stay inline on the invoice page**, restyled to match. The owner first said "all of them", then chose inline when shown the cost: leaving the invoice to take ₹500 in cash and returning to confirm it landed is the most frequent billing action at a front desk | **Theirs**, reversing the earlier answer |
| Who sees which follow-ups | Doctors and assistants land on the follow-ups assigned to them, with a filter for everything; receptionists and clinic admins see the whole clinic by default | **Theirs** |
| Duplicate Appointments | The generic `appointments` module is removed from clinic navigation; the appointments flow page is the only one | Author |
| Patients | Stays on the improved generic layer — named as a screen staff pass through, not live in | Author, flagged to them |
| Loading | Skeletons that mirror the real layout, on lists and detail pages; spinners survive only inside buttons | Author |
| Icons | Drawn from the existing `AppIcon` set, one per module and per row action, used only where they carry meaning | Author |
| Doctor fees in billing | The invoice editor gets a doctor-fee picker beside the service picker, and the standalone New-invoice flow can attach an appointment | Author |

## Current state the builder needs to know

- **Add and edit are already full pages.** `App.jsx:164-166` routes `/modules/:moduleKey/new`, `/:id/edit` and `/:id`. What is a panel is **view**: `ModuleListPage.jsx:1025` opens `RecordDialog variant="sheet"`, a generic key→value dump, while `ModuleViewPage` already exists and is routed. Much of item "view should be full page" is wiring, not new code.
- **`StatCard` already supports colour.** `DashboardPage.jsx:15-19` defines blue/emerald/amber/violet tones with matching icon and value colours, and the clinic dashboard uses them. The super-admin branch at `:696-697` calls `<StatCard label="Total Clinics" value={…} />` with no tone and no icon, which is the whole of the "no colour in super admin overview" report.
- **Spinners are the only loading state**: 22 `animate-spin` sites across the admin SPA.
- **Follow-ups data** is `FollowupTask` (`clinic_id, patient_id, appointment_id, assigned_to_user_id, doctor_id, due_date, due_time, task_type, status, priority, note, completed_at`) behind `Api/Clinic/FollowupTaskController`, reachable today only through generic CRUD.
- **The doctor fee is already billable** — `InvoiceService::prefillFor()` returns a service line and a "Consultation — Dr X" line at the doctor's `consultation_fee`/`followup_fee`. It is only reachable by raising the invoice from an appointment, which is why billing looked service-only.
- **The generic Appointments routes already redirect.** `App.jsx:152-155` sends `/modules/appointments*` to the workflow page, so the only work is removing the sidebar entry — navigation is built from `config/modules.js` (`clinic: true`, `navOrder`).
- **Patients and Doctors already bypass the generic view entirely**: `/modules/patients/:id` routes to `PatientProfilePage` and `/modules/doctors/:id` to `DoctorSetupFlowPage` (`App.jsx:158-159`). Neither should be pointed at `ModuleViewPage`; their row-view goes to the page that already exists.
- **`FollowupTaskController` extends `BaseClinicCrudController`**, so its update path is the generic unvalidated one. Completing a task should not go through it — that is why the dedicated endpoint above is permitted.
- There is **no JavaScript test harness** in this repo. Every UI change ships verified by the vite build, the PHP suite and review. That is the bar; introducing a harness is a separate decision.

## What gets built

### 1. Follow-ups worklist (`resources/js/admin/src/pages/workflows/FollowupsPage.jsx`)

Grouped Overdue / Today / This week / Done, counts in the group headers, newest urgency first. Each row: patient name, reason, doctor, due date in words ("3 days overdue"), and two actions — a call affordance and Done. Filters for doctor, assignee and status. "Add follow-up" is a full page with the four fields staff actually fill (patient, reason/type, due date, assignee), not the eleven the table has. Removed from the generic module list and added to clinic navigation under Care, gated on `followups.view`.

Details settled by the author so the builder does not have to guess:

- **A row's "reason"** is the `task_type` label (Call, WhatsApp, Review request, Follow-up visit, Lab reminder, Custom), with `note` as the supporting line when present. `priority` shows only when it is high, as a marker rather than a column.
- **Groups** are Overdue, Today, This week (the next seven days, not the calendar week), Later, and Done. Nothing pending is hidden — "Later" exists precisely so it isn't. Done is capped at the most recent 20 with a link to the filtered list, since the list is unpaginated.
- **`skipped` and `cancelled`** sit with Done under a "Closed" heading; neither needs its own group.
- **Done** calls the new complete endpoint (status `done` + `completed_at`), requires `followups.edit`, is hidden for roles without it, and offers an undo for a few seconds rather than a confirm dialog — one click to complete is the point of the screen.
- **Default scope** follows the owner's decision above: assigned-to-me for doctors and assistants, whole clinic for receptionists and clinic admins, with a filter either way.
- **Call** is a `tel:` link; when the patient has no phone the action renders disabled with the reason. Calling is not logged and is independent of Done.

The grouping is computed client-side from `due_date` unless the list grows past one page, in which case the builder should add server-side filters rather than paginate a grouped view.

### 2. The generic layer

Applies to the modules clinic staff actually reach through the generic layer — Services, Staff Users, Reminders and the WhatsApp screens. **Patients and Doctors are excluded**: their row-view already opens a purpose-built page. Domains and Clinic Settings are included only insofar as the shared improvements reach them; neither needs bespoke treatment.

- Row view navigates to `ModuleViewPage` instead of opening `RecordDialog`; `RecordDialog` is removed from `ModuleListPage` once nothing uses it. `ModuleViewPage` itself gets a readable layout — grouped sections, human labels, a header with the record's name and its primary actions — rather than a flat dump.
- Human labels throughout: a label map living beside each module in `config/modules.js`, falling back to the current prettifier, so one file still describes a module. "Assigned to", not "Assigned To User Id". An id renders as the related record's name **only where the API already returns the relation** — no lazy per-row lookups; where it doesn't, the field is omitted from the view rather than shown as a number.
- Skeletons replacing spinners on list and detail loads, shaped like the table or form they precede.
- Icons from `AppIcon` on module headers, empty states and row actions.
- Empty states that say what the screen is for and offer the primary action.

### 3. Panels to pages

- **Appointment detail** (`AppointmentDetailDrawer.jsx`, 684 lines) becomes the route `/workflows/appointments/:id`, beside the existing `/:id/prescription`, keeping every section it has today including the E4 invoice line. It is deep-linkable under the same permission the queue uses. For "back returns to the queue with its filters intact": move the queue's filters into URL query parameters rather than threading router state through a 2000-line component — the flow page then restores itself from the URL, and the drawer's existing `onChanged` refresh becomes a refetch on return.
- **Add to waitlist** becomes a page under the waitlist route, gated exactly as the waitlist screen is, accepting a prefilled patient or doctor from the screen that linked to it.
- **Row view sheet** — covered above; `RecordDialog` is deleted once nothing uses it.
- **Record payment and Refund stay inline** on the invoice page, restyled to match the new look. This is the owner's decision after weighing the cost; see the decisions table.

### 4. Dashboard colour

Give the super-admin stat cards the tone and icon arguments the clinic cards already pass. No new component.

### 5. Billing: doctor fees without an appointment

- A doctor-fee picker beside the service picker in the invoice editor: choose doctor and visit type, and the line is inserted at that doctor's `consultation_fee` or `followup_fee`, matching what `prefillFor` produces.
- The standalone New-invoice flow can attach one of the patient's recent appointments, which then prefills exactly as the drawer's "Raise invoice" does.
- Backend: extend the existing clinic doctors list to carry `consultation_fee` and `followup_fee` (receptionists already hold `doctors.view`, so no new permission is needed; confirm before relying on it). The line's wording must come from the server — extract `prefillFor`'s line builder into something the picker endpoint and the prefill share, so a hand-picked line and a prefilled one are byte-identical rather than two copies of a string that drift.
- "Visit type" in the picker is the two-value choice the fee depends on — new versus follow-up — not the full enum.
- "Recent appointments" for the attach step means the patient's appointments from the last 90 days that are not cancelled and do not already carry a non-cancelled invoice (one invoice per appointment is enforced in `InvoiceService::draft`, so offering an invoiced one would only produce a 422). A patient is chosen first; the appointment list is filtered to them.

## Constraints

- React 19 + Vite + Tailwind 4, no new UI dependencies.
- Follow the conventions already in the workflow pages: reset state on filter/route change, guard stale responses, surface API messages verbatim.
- Permission gating stays exactly as it is; no screen may become reachable to a role that cannot reach it today.
- `php artisan test` stays green and the vite build must pass for every commit.

### 6. Skeleton scope

Every **page-level** load gets a skeleton: the generic list and view pages, the new follow-ups page, the appointment detail page, and the daily-driver pages (appointments flow, billing list and invoice detail, prescriptions). Spinners survive only inside buttons and other in-place actions, which is most of the 22 current sites. The pages marked "consistency fixes only" get the skeleton and nothing else.

## Left to the builder

Skeleton timing (and whether to delay them to avoid flashing on fast responses); the exact icon per module; how the follow-up "Call" action behaves beyond a `tel:` link; group ordering within Overdue; the label map's exact wording; whether `ModuleViewPage` groups fields by a per-module config or a heuristic; and the visual treatment of the appointment detail page's header.
