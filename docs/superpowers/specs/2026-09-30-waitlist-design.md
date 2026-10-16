# Waitlist (E3) — Design

Date: 2026-09-30
Status: Approved in chat
Roadmap: E3 of the new-clinic adoption (E1 WhatsApp ✅ → E2 patient portal ✅ → **E3 waitlist** → E4 invoices + online payment)
Source: new-clinic `apps/api/src/waitlist/waitlist.service.ts`, portal appointments/book/reschedule pages

## Goal

When a slot is taken, a patient can join a waitlist for that exact slot (from the portal, or added by staff). When the slot frees up, it is held for the first person in line for a clinic-set time and they get a WhatsApp "Book it" link; if they don't book in time it moves to the next person. Staff see and manage the waitlist.

## Decisions (from chat)

| Question | Decision |
|---|---|
| Freed slot | Hold for the first waiting patient for `waitlist_hold_minutes` (default 30); WhatsApp with a one-tap Book-it link; on decline/expiry move to the next. |
| What is waited for | The exact slot: doctor + date + start time. |
| Staff | View, add (phone-in patients), remove; holds/notifications happen automatically on staff cancel/reschedule. |

Out of scope: auto-booking, "any time that day" waits, SMS, waitlists across doctors.

## 1. Data

**Table `waitlist_entries`** (new migration): `id, clinic_id FK cascade, patient_id FK cascade, doctor_id FK cascade, appointment_date date, start_time time, end_time time null, status enum(waiting, offered, booked, declined, expired, removed) default waiting, source enum(portal, staff), offered_at timestamp null, hold_expires_at timestamp null, booked_appointment_id FK appointments nullOnDelete, login_link_id FK patient_login_links nullOnDelete, created_by_user_id FK users nullOnDelete, timestamps`. Indexes `(clinic_id, doctor_id, appointment_date, start_time, status)`, `(patient_id, status)`. "Active" = waiting or offered; at most one active entry per (patient, doctor, date, start_time) — enforced in the service under the doctor-row lock (no DB unique, since finished rows repeat).

**Clinic settings:** `clinic_settings.waitlist_enabled` bool default true; `waitlist_hold_minutes` unsigned int default 30 (validation 5–240). No settings row ⇒ enabled, 30.

**Login links:** `patient_login_links.redirect_path` string(200) null — after exchange the portal navigates there (only same-origin paths starting with `/` and not `//` are honoured).

## 2. Lifecycle (`App\Services\Waitlist\WaitlistService`)

- `join(Patient $p, int $doctorId, string $date, string $start, string $source, ?int $userId): WaitlistEntry` — requires clinic waitlist enabled (422 `Waitlist is not available at this clinic.`), the time to be an offered slot for the doctor (same grid/window rules as booking, `PortalBookingPolicy::slotFor`; for staff the window/notice rules are skipped but the slot must be on the grid and in the future), the slot to be **taken or held for someone else** (a free slot → 422 `This slot is free — book it directly.`), the patient not to hold an active entry for it (409 `Already on the waitlist for this time.`) nor an appointment in it, and at most **3** active entries per patient (422 `You can be on up to 3 waitlists at a time.`; staff-added entries count too). `end_time` copied from the slot.
- `slotFreed(int $clinicId, int $doctorId, string $date, string $start): void` — called after commit when an appointment occupying the slot is cancelled (any source) or rescheduled away (the old slot). If the slot is still free and in the future, not already held, and the clinic has the waitlist on: take the oldest `waiting` entry (by id), set `offered`, `offered_at = now`, `hold_expires_at = now + hold minutes` (capped at slot start), create a login link for the patient's account holder (the entry's patient if an account holder, else its `managed_by` holder) with `expires_at = hold_expires_at`, `redirect_path = /waitlist/{id}` (plus the profile id so the portal selects the dependent's profile: `/waitlist/{id}?profile={patient_id}`), store `login_link_id`, and send `PatientNotifier::waitlistOffer(WaitlistEntry, string $token)`. Serialised with the doctor-row lock (`Doctor::lockForUpdate`) like booking.
- `book(WaitlistEntry $e, array $data): Appointment` — entry must be `offered` and `hold_expires_at > now` (else 422 `This offer has expired.`); creates the appointment through `AppointmentService::create(..., source 'patient')` with `status pending`, `booking_channel portal` (staff-added entries still book as portal when the patient accepts in the portal) — the slot check treats this entry's own hold as not blocking; sets `booked`, `booked_appointment_id`; consumes the login link.
- `decline(WaitlistEntry $e)` — offered → `declined`, then offer to the next (`slotFreed` for that slot).
- `remove(WaitlistEntry $e)` — waiting/offered → `removed`; if it was offered, offer to the next.
- `process()` — command `waitlist:process` scheduled `everyMinute()->withoutOverlapping()`: offered entries with `hold_expires_at <= now` → `expired` then offer to next; waiting/offered entries whose slot start ≤ now → `expired`. Idempotent.

**Holds block others:** `PortalBookingPolicy::freeSlots` excludes slots with an active offer for someone else; `AppointmentService::assertSlotFree` (patient source) treats an active offer for a different patient as a conflict (409 `That slot was just taken. Please pick another.`). Staff create is unchanged (can override).

Times use `config('app.clinic_timezone')`.

## 3. WhatsApp

Template type `waitlist_slot_open` (utility) added to `TemplateSettings::TYPES`: body 1 patient name, 2 clinic name, 3 doctor name, 4 date (`Tue, 29 Sep 2026`), 5 time (`10:30 AM`), 6 hold minutes; URL button parameter = login-link token (button URL `https://<domain>/portal/login/{{1}}`). `PatientNotifier::waitlistOffer(WaitlistEntry $e, string $token): WhatsappMessage` (notification_type `waitlist_slot_open`, appointment_id null, patient = entry patient, phone = account holder's phone).

## 4. Portal

- Slots endpoint `GET doctors/{id}/slots?date=` adds `taken: [{start_time, end_time}]` (booked or held for someone else, grid-aligned, in the booking window, not already joined by P) alongside `slots`.
- Book / Reschedule slot grid: taken times shown greyed with **Join waitlist**; a 409 on book/reschedule offers "Join waitlist for this time".
- Visits page: "Waitlist" card with active entries (doctor, date, time, status, **Leave**); offered entries highlighted "Held for you until 10:45 — Book it".
- `/waitlist/:id`: held slot, countdown, visit type + mode (+ reason), **Book** / **Decline**; expired → message.
- Login-link exchange honours `redirect_path` (and `profile` query → `setProfile`).
- Endpoints (portal.auth + portal.consent, acting profile P, other patients' entries → 404): `GET waitlist`, `POST waitlist {doctor_id, appointment_date, start_time}` → 201, `DELETE waitlist/{id}`, `POST waitlist/{id}/book {visit_type, consultation_mode, reason?}` → 201 appointment, `POST waitlist/{id}/decline`.

## 5. Staff

- Waitlist page (under Appointments, `appointments.view`): filters doctor/date/status; columns patient, slot, position (among waiting for that slot), status, hold expiry, source; **Add to waitlist** (patient picker, doctor, date, taken slot) and **Remove** (`appointments.create`). Clinic API `GET/POST waitlist`, `DELETE waitlist/{id}`; super-admin equivalents (role-gated, clinic filter).
- Appointment drawer: "N waiting for this slot" and "Held for {name} until {time}" when applicable (from the appointment detail payload).
- Clinic settings forms: "Waitlist enabled", "Hold time (minutes)". WhatsApp settings help line for `waitlist_slot_open`.

## 6. Errors

409 `Already on the waitlist for this time.`; 422 `You can be on up to 3 waitlists at a time.`, `This slot is free — book it directly.`, `Waitlist is not available at this clinic.`, `This offer has expired.`; 404 for other patients'/clinics' entries.

## 7. Testing

Join rules (duplicate, limit incl. staff entries, free slot, disabled, off-grid/past, already booked by P); freeing by portal cancel, staff cancel and reschedule offers only the oldest waiting entry, sends `waitlist_slot_open` with a link token whose exchange redirects to `/waitlist/{id}`; dependent entries send to the holder's phone and select the dependent profile; held slot hidden from others' free slots and portal booking 409 while staff booking succeeds; book from offer → pending portal appointment, entry booked, link consumed; book after expiry → 422; decline → next offered; remove offered → next offered; `waitlist:process` expires holds (next offered) and past-slot entries, idempotent; isolation (other patient/clinic 404); staff add/remove + permissions; slots endpoint `taken`. E2E in the browser after a dev-DB backup.
