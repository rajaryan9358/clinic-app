# Permission-Based Roles — Design

Date: 2026-09-26
Status: Approved in chat
Sub-project: D of the super admin roadmap (A done, B done, D this, C next)

## Goal

The super admin builds roles from module permissions, platform-wide. Clinic admins assign those roles to their staff. Every `/api/clinic` endpoint checks the user's permissions; the hard-coded role checks go away, except where they decide **which data** a user sees (doctor → own records, assistant-like → assigned doctors), which moves onto the role's *kind*.

## Decisions (from chat)

| Question | Decision |
|---|---|
| Who creates roles | Super admin only; roles apply to every clinic. |
| Built-in roles | clinic_admin, doctor, receptionist, assistant stay as editable defaults (system roles: cannot be deleted, kind fixed, permissions editable). clinic_admin always has full clinic access. |
| Granularity | Module × view / create / edit / delete, plus a few special permissions. |
| Data scope | A role has a kind: `staff` or `doctor` (plus internal `clinic_admin`, `super_admin`). Staff roles may be limited to assigned doctors. |
| Storage | Kind and flags live on Spatie's `roles` table; `users.role` holds the role name (string). |

## 1. Data model

**`roles`** (Spatie table; edit `database/migrations/2026_03_28_191751_create_permission_tables.php` in place — schema is rebuilt with migrate:fresh) gains:
`label` (string), `kind` enum(`super_admin`, `clinic_admin`, `staff`, `doctor`), `limit_to_assigned_doctors` (bool, default false), `is_system` (bool, default false), `description` (text, null).

A `App\Models\Role` class extends `Spatie\Permission\Models\Role` with fillable/casts for these, and is set as `permission.models.role` in `config/permission.php`.

**`users.role`**: the enum becomes `string(64)` holding a role `name` (edit `0001_01_01_000000_create_users_table.php`). `User::roleModel()` returns the Role by name (cached per request). `User::roleKind(): string` returns its kind (`super_admin` for the super admin). Spatie's `model_has_roles` stays in sync with `users.role` (as today via `syncRoles`).

**System roles** (seeded; `is_system = true`):

| name | label | kind | limit_to_assigned_doctors |
|---|---|---|---|
| super_admin | Super Admin | super_admin | false (hidden from the role builder) |
| clinic_admin | Clinic Admin | clinic_admin | false |
| doctor | Doctor | doctor | false |
| receptionist | Receptionist | staff | false |
| assistant | Assistant | staff | true |

## 2. Permission catalogue

Replaces the unused `{module}.{9 actions}` set. Permission names `{module}.{action}`, guard `web`.

Modules (label in UI): `patients` (Patients), `appointments` (Appointments), `doctors` (Doctors), `doctor_schedules` (Doctor schedules & leave), `services` (Services), `staff` (Staff users), `whatsapp` (WhatsApp), `reminders` (Reminders), `followups` (Follow-ups), `billing` (Invoices & payments), `reviews` (Reviews), `reports` (Reports), `audit_logs` (Audit log), `clinic_profile` (Clinic profile), `clinic_settings` (Clinic settings), `subscription` (Subscription).

Actions: `view`, `create`, `edit`, `delete` for every module, except view-only modules `reports`, `audit_logs` (only `view`).

Special permissions: `appointments.check_in` (lifecycle transitions to checked_in / in_consultation / completed / no_show), `appointments.cancel` (lifecycle → cancelled), `appointments.prescribe` (prescription + consultation summary incl. voice), `subscription.manage` (checkout and verify).

A single source of truth: `App\Support\PermissionCatalogue` (modules, labels, actions, specials, and `all(): array` of names). The seeder and the role-builder API both read it.

**Default permissions for system roles**
- clinic_admin: all (and enforced by Gate::before regardless of assigned permissions; UI shows "Full access").
- doctor: patients.view, patients.edit, appointments.view, appointments.create, appointments.edit, appointments.check_in, appointments.prescribe, doctor_schedules.view, doctor_schedules.create, doctor_schedules.edit, doctor_schedules.delete, doctors.view, services.view, followups.view, followups.create, followups.edit.
- receptionist: patients.* (view/create/edit), appointments.view/create/edit/check_in/cancel, doctors.view, doctor_schedules.view, services.view, reminders.view, followups.view/create/edit, whatsapp.view/create, billing.view/create/edit, reports.view.
- assistant: patients.view, patients.create, patients.edit, appointments.view, appointments.create, appointments.edit, appointments.check_in, doctors.view, doctor_schedules.view, services.view, followups.view.

## 3. Enforcement

**Gate::before** (AppServiceProvider): return `true` when the user's kind is `super_admin` or `clinic_admin`; otherwise defer to Spatie permissions.

**Route permissions**: `registerCrudRoutes(string $prefix, string $controller, ?string $module = null)` — when `$module` is given, attach per-route `can:` middleware: GET index/show → `{module}.view`; POST store → `{module}.create`; PUT update, POST restore/status/block/unblock → `{module}.edit`; DELETE → `{module}.delete`. Super-admin routes call it without `$module` (unchanged).

Clinic route → permission map:

| Route(s) | Permission |
|---|---|
| users (CRUD) | staff.* |
| doctors (CRUD), GET doctors/{id}/profile | doctors.* / doctors.view |
| PUT doctors/{id}/profile | doctors.edit (doctor kind: own profile, limited fields — see §4) |
| doctors/{id}/schedules, exceptions (POST/PUT/DELETE) | doctor_schedules.create / edit / delete |
| services (CRUD) | services.* |
| patients (CRUD), patients/{id}/profile, notes (GET), activity, global-summary (GET), report.pdf | patients.view (reads) / patients.create / patients.edit / patients.delete |
| POST patients/{id}/notes, PUT medical-profile, POST global-summary | patients.edit |
| appointments (CRUD), availability, detail, report.pdf | appointments.view / create / edit / delete |
| POST appointments/generate-tokens, POST appointments/{id}/reschedule | appointments.edit |
| POST appointments/{id}/lifecycle | `appointments.cancel` when target status is `cancelled`; otherwise `appointments.check_in` (checked in controller, 403 message names the permission) |
| appointments/{id}/prescription (GET, PDF), summary (GET) | appointments.view |
| POST appointments/{id}/prescription/voice, POST summary/voice | appointments.prescribe |
| followups (CRUD) | followups.* |
| reminders (CRUD) | reminders.* |
| whatsapp/* (all five CRUD groups) | whatsapp.* |
| invoices, payments (CRUD) | billing.* |
| reviews (CRUD), generate-reply, reply | reviews.view / edit |
| reports/*.pdf | reports.view |
| audit-logs (CRUD reads) | audit_logs.view (writes stay unavailable) |
| settings/clinic (CRUD) | clinic_settings.view / edit (create counts as edit) |
| domains (CRUD) | clinic_settings.* |
| GET/PUT clinic/profile | clinic_profile.view / edit |
| GET subscription | subscription.view |
| POST subscription/checkout, verify | subscription.manage |
| GET roles (clinic) | staff.view — returns assignable roles only (see §4) |
| POST roles/{id}/permissions (clinic) | **removed** (only the super admin edits roles) |
| GET permissions (clinic) | **removed** |
| me/context, dashboard/*, uploads/image | authenticated only (no permission) |

Always allowed while subscription-locked stays as today (me/context, GET subscription, checkout, verify); the lock middleware runs before permission checks.

**Denied** → HTTP 403 `{"success": false, "message": "You don't have permission to {human action} {module label}."}` via a small `EnsurePermission` middleware alias `perm` used as `perm:patients.create` (wraps `$user->can()` so the message is friendly). `can:` is not used directly.

**Hard-coded checks to convert** (current list):
- `ResolveClinicContext`: `role === doctor` → `roleKind() === 'doctor'`; `role === assistant` → `roleModel()->limit_to_assigned_doctors`.
- `EnsureClinicScope`, `EnsureClinicSubscription`: super admin check → `roleKind() === 'super_admin'`.
- `Clinic/UserController:23` (staff management) → route permission `staff.*` (remove the role check).
- `Clinic/DoctorController:21` → route permission `doctors.create` (remove).
- `Clinic/ClinicSettingController:69` → route permission `clinic_settings.edit` (remove).
- `Clinic/SubscriptionController:63,81` → route permission `subscription.manage` (remove).
- `Clinic/DoctorProfileController:26,117,126` → permissions `doctors.edit` / `doctor_schedules.*`; the "doctor can only edit own profile, limited fields" rule stays as a **kind** rule (`roleKind() === 'doctor'`).
- `AppointmentController:58`, `BaseClinicCrudController:80`, `DoctorProfileController:49,102` → kind checks (`roleKind() === 'doctor'`) — data scoping, unchanged behaviour.
- `UserManagementService:94,112` (assistant doctor mapping) → `limit_to_assigned_doctors` of the target role.
- `SuperAdmin/DashboardController:27-28` staff counts → exclude roles whose kind is super_admin or doctor.
- `RolePermissionController` (both) → replaced by the new role builder (§5); clinic version reduced to `GET roles`.

## 4. Assigning roles

- Staff create/update (clinic `users` and super admin `users`, `UserManagementService`): `role` must be an existing role name. Clinic admin may assign roles of kind `staff` or `clinic_admin`; super admin may assign any kind except `super_admin` to clinic users and `super_admin` only to users without a clinic. Doctor-kind roles are rejected on the staff form (422 "Doctor logins are created from the doctor's profile.").
- Doctor onboarding (`DoctorManagementService` linked user): assigns the system `doctor` role by default, or a given doctor-kind role (`linked_user.role`), validated to be kind `doctor`.
- `staff.edit` on a user whose role is clinic_admin requires the actor to be clinic_admin kind (a staff-kind user with `staff.edit` cannot edit or demote an admin) — 403 otherwise.
- `GET /clinic/roles` returns `{name, label, kind, limit_to_assigned_doctors}` for roles of kind `staff`, plus `clinic_admin` when the actor is clinic_admin kind.
- Plan limits unchanged: staff = users whose role kind ≠ doctor.

## 5. Super admin role builder

API (super admin only):
- `GET /api/super-admin/roles` → roles (excluding super_admin) with `label, kind, limit_to_assigned_doctors, is_system, description, permissions[], users_count`.
- `GET /api/super-admin/permission-catalogue` → `{modules: [{key, label, actions: [...]}], specials: [{name, label, module}]}`.
- `POST /api/super-admin/roles {label, kind (staff|doctor), limit_to_assigned_doctors?, description?, permissions[]}` → 201; `name` = slug of label, unique (422 on clash).
- `PUT /api/super-admin/roles/{id} {label?, description?, limit_to_assigned_doctors?, permissions[]?}` — kind cannot change on system roles (422); clinic_admin permissions cannot be edited (422 "Clinic Admin always has full access."); permissions must be catalogue names (422 otherwise).
- `DELETE /api/super-admin/roles/{id}` — 422 for system roles; 422 "Move its N users to another role first." when users have it.
Permission cache is reset after every change (`PermissionRegistrar::forgetCachedPermissions`).

UI — super admin sidebar **Admin → Roles** page: list (label, kind, users, System badge); create/edit sheet with label, kind (staff/doctor, fixed for system roles), "Only see assigned doctors' patients and appointments" (staff), description, and a permission grid (rows = modules, columns = View / Create / Edit / Delete; cells absent where the action doesn't exist) plus a "Special" group. clinic_admin opens read-only with "Full access". Delete with an inline confirm.

## 6. Clinic app

- `me/context` adds `role_label`, `role_kind`, `permissions: string[]` (all catalogue names for clinic_admin kind).
- `ScopeContext` exposes `can(permission): boolean`.
- `config/navigation.js`: a single clinic navigation list where each item declares the permission it needs (e.g. Patients → `patients.view`, Staff Users → `staff.view`, WhatsApp → `whatsapp.view`, Subscription → `subscription.view`, Clinic Profile → `clinic_profile.view`); items are shown when `can()` passes. The per-role navigation blocks for clinic roles are removed (super admin keeps its own block).
- `config/access.js`: `canAccessModule` / `canCreateModule` for clinic users are answered from permissions (module key → permission module map); the role-string branches for clinic roles go.
- Buttons: Add / Edit / Delete on module pages, appointment Check-in / Cancel / Prescription, Pay on the Subscription page — shown only when permitted.
- Routes: a page the user lacks `view` permission for redirects to `/dashboard`.
- Dashboards: chosen by kind — clinic_admin kind → clinic admin dashboard; doctor kind → doctor dashboard; staff kind with `limit_to_assigned_doctors` → assistant dashboard; other staff → receptionist dashboard.
- Staff forms (clinic `users` create/edit, super admin StaffTab, CreateStaffWizard): role select from `GET /clinic/roles` (clinic) or `GET /super-admin/roles` filtered to non-doctor kinds (super admin), showing labels. "Assigned doctors" picker shown when the chosen role has `limit_to_assigned_doctors`.

## 7. Testing

- Catalogue: seeder creates exactly the catalogue permissions; system roles with defaults.
- Permission matrix: for each row of the §3 table, a staff user with a role lacking the permission gets 403 with the friendly message; granting it yields 2xx. clinic_admin kind passes every row without explicit permissions.
- Lifecycle: cancel needs `appointments.cancel`; check-in needs `appointments.check_in`.
- Scoping regressions: doctor kind sees only own appointments/patients; a custom staff role with limit_to_assigned_doctors sees only assigned doctors; a custom doctor-kind role behaves like doctor.
- Role builder: create/update/delete rules (system, in use, clinic_admin read-only, catalogue validation, unique name, cache reset takes effect in the same test).
- Assignment rules: clinic admin cannot assign doctor kind via staff form; staff-kind user with staff.edit cannot edit a clinic admin; super_admin role only for clinic-less users.
- Clinic `POST roles/{id}/permissions` and `GET permissions` return 404/405.
- Existing feature tests updated to seed roles/permissions via the seeder (most already do).

## Out of scope

Super-admin sub-roles, per-clinic custom roles, field-level permissions, permission-change audit log, patient-facing roles.
