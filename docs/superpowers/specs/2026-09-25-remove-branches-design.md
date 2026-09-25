# Remove the Branch System — Design

Date: 2026-09-25
Status: Approved

## Goal

A clinic is one location. Organisations with several locations create several clinic profiles. Every branch concept is removed from the schema, backend, frontend, seeders and report views so the MVP matches the PRD (§5 tenant = clinic, §13 data model has no branch, §17 lists multi-branch as "Later").

## Decisions

| Question | Decision |
|---|---|
| Existing data | None to preserve. Edit original migrations; rebuild with `php artisan migrate:fresh --seed`. |
| `branch_manager` role | Removed. Roles: `super_admin`, `clinic_admin`, `doctor`, `receptionist`, `assistant`. |
| Branch location fields | Moved onto `clinics`. |
| Branch settings | Merged into `clinic_settings`. |
| Tests | No feature tests exist. Verify with migrate:fresh, grep, frontend build and API smoke checks. |

## 1. Schema

Edit migrations in place.

**Tables removed**
- `branches`, `user_branch_map` (`2026_03_29_000100_create_clinic_core_tables.php`)
- `doctor_branch_map` (`2026_03_29_000200_create_doctors_and_services_tables.php`)
- `branch_settings` (`2026_03_29_000600_create_settings_billing_and_logs_tables.php`)
- `branch_service_map` — delete migration `2026_04_09_001000_create_branch_service_map_table.php`
- `2026_03_29_100000_add_updated_at_to_pivot_maps.php` — remove the `user_branch_map` and `doctor_branch_map` blocks; delete the file if nothing remains.

**`branch_id` column removed from**
`domains`, `doctor_schedules`, `doctor_schedule_exceptions`, `patients`, `patient_notes`, `appointments`, `followup_tasks`, `whatsapp_accounts`, `whatsapp_templates`, `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_flow_sessions`, `invoices`, `audit_logs`, `file_uploads`, `reviews`.

**Indexes rewritten**
- `doctor_schedules`: drop `ds_clinic_branch_idx`.
- `patients`: drop `(clinic_id, branch_id)`.
- `appointments`: `appt_clinic_branch_date_idx` → `(clinic_id, appointment_date)` named `appt_clinic_date_idx`.
- `reviews`: `(clinic_id, branch_id, review_date)` → `(clinic_id, review_date)`.

**Columns added to `clinics`** (all nullable)
`address_line_1`, `address_line_2`, `city`, `state`, `pincode`, `latitude decimal(10,7)`, `longitude decimal(10,7)`, `phone varchar(20)`, `email`.

**Columns added to `clinic_settings`**
`walkin_enabled bool default true`, `token_system_enabled bool default false`, `max_advance_booking_days uint default 30`, `min_booking_notice_minutes uint default 30`.

**Role enum**: `users.role` drops `branch_manager`.

## 2. Backend

**Delete**
- Models: `Branch`, `BranchSetting`, `UserBranchMap`, `DoctorBranchMap`
- Service: `BranchService`
- Controllers: `Clinic/BranchController`, `Clinic/BranchSettingController`, `SuperAdmin/BranchController`, `SuperAdmin/BranchSettingController`
- Requests: `StoreBranchRequest`, `UpdateBranchRequest`
- Routes: `branches`, `settings/branch`, `services/{id}/branches` in `routes/api.php`

**Modify**
- `UserRole` enum and `RolesAndPermissionsSeeder`: remove `branch_manager`.
- `Clinic` model: add the new fillable fields; remove `branches()`. `ClinicSetting` model: add the four fields and casts.
- All models with `branch_id` in `$fillable` or a `branch()` relation: remove both. `User::branches()`, `Doctor`/`Service` branch relations removed.
- `ResolveClinicContext`: delete the branch-scoped block (`allowed_branch_ids`, `active_branch_id`, `X-Branch-Id`, `branch_id` filter guard). Doctor and assistant→doctor scoping unchanged.
- `BaseClinicCrudController`: delete branch filtering.
- `MeController`: stop returning `active_branch_id` and `allowed_branches`.
- `AppointmentService::getDoctorAvailability(int $clinicId, int $doctorId, string $fromDate, string $toDate, ?int $excludeAppointmentId = null)`: no branch argument or filters. Booking-window limits (`max_advance_booking_days`, `min_booking_notice_minutes`) are stored but **not** enforced here: staff use this endpoint for walk-ins booked "now", which a notice limit would block. Enforcement belongs to the public booking page work.
- `AppointmentService` create/reschedule and `patient` creation: no `branch_id`.
- `ClinicCreationService`: create clinic (with location fields) → clinic settings → clinic admin. No branch.
- `UserManagementService`, `DoctorManagementService`, Store/Update user, doctor, clinic, appointment requests: remove branch fields and role `branch_manager`.
- Controllers that validate, filter, eager-load or return branch data: Clinic + SuperAdmin `Doctor`, `DoctorProfile`, `Service`, `User`, `Appointment`, `Dashboard`, `Review`, `PatientProfile`, `Patient`, `Report`, `WhatsappAccount`, `Domain`, and any other hit from `grep -ri branch app`.
- `AuditLogService`: stop writing `branch_id`.
- Blade report views and `DemoClinicSeeder`: remove branch output and seeding; seeder writes location fields on the clinic.

## 3. Frontend (`resources/js/admin/src`)

**Delete**: `pages/workflows/BranchProfilePage.jsx`, `pages/workflows/CreateBranchWizardPage.jsx`; routes for `/workflows/branch-profile` and `/workflows/create-branch`; `branches` and `branchSettings` entries in `config/modules.js`.

**Modify**
- `api/client.js`: drop `X-Branch-Id` header.
- `context/ScopeContext.jsx`: drop `active_branch_id` storage.
- `components/Layout.jsx`: drop branch switcher/labels.
- `config/navigation.js`: remove `branch_manager` block.
- `config/access.js`: remove `branch_manager`, `branches`, `branchSettings` rules and `isAutoBranchRole`; staff role options lose `branch_manager`.
- `pages/workflows/ClinicDetailPage.jsx`: remove Branches tab; Domains/Doctors/Services/Staff tabs lose branch selectors; Settings tab gains walk-in, token system, max advance booking days, min booking notice; clinic edit form gains address and contact fields.
- `pages/workflows/OnboardClinicWizardPage.jsx`: two steps — Clinic (incl. address/contact) → Clinic Admin.
- `ModuleFormPage`, `ModuleListPage`, `ModuleViewPage`, `FormRenderer`, `DataTable`, `RecordDialog`, `AppointmentDetailDrawer`, `DashboardPage`, `AppointmentsFlowPage`, `DoctorSetupFlowPage`, `DoctorAvailabilityPage`, `SetupDoctorWizardPage`, `CreateStaffWizardPage`, `PatientProfilePage`, `MyDoctorProfilePage`: remove branch fields, columns, filters and query params.

## 4. Verification

1. `php artisan migrate:fresh --seed` completes.
2. `grep -rin branch app database routes resources/js/admin/src resources/views config` returns no branch-feature hits.
3. `php artisan route:list` loads; no branch routes.
4. `npm run build` passes.
5. API smoke checks with the seeded users:
   - super admin: onboard a clinic (clinic + admin), list clinics, update clinic settings.
   - clinic admin: create doctor with a weekly schedule, create service, call `appointments/availability`.
   - receptionist: create a patient and an appointment in an available slot; run lifecycle `checked_in`.

## Out of scope

Multi-clinic membership per user, public booking page, WhatsApp sending. Tracked separately.
