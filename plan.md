# Clinic Admin App — Project Plan (RBAC + UX)

Date: 2026-04-14

## Goals
- Enforce the role hierarchy end-to-end (backend is source of truth):
  `super_admin → clinic_admin → branch_manager → receptionist → assistant → doctor`.
- Upper roles can create/manage subordinate roles ("manager creates all below").
- Receptionist / assistant / doctor cannot manage staff users.
- Sidebar profile entries:
  - clinic_admin: Clinic Profile
  - branch_manager: Branch Profile
- Doctor sidebar includes Calendar menu entry.
- Doctor self-edit is limited (fees/profile/schedule), not full staff management.

## RBAC Rules

### Role creation / management matrix
- `super_admin`: can create/manage any role.
- `clinic_admin`: can create/manage `branch_manager`, `receptionist`, `assistant`.
- `branch_manager`: can create/manage `receptionist`, `assistant`.
- `receptionist`, `assistant`, `doctor`: cannot create/manage staff users.

Note: **doctor logins are created via Doctor onboarding** (doctor record + `create_linked_user`) to ensure the doctor account is linked to a doctor profile.

### Visibility constraints
- Staff user management (`/clinic/users` CRUD): blocked for `receptionist`, `assistant`, `doctor`.
- Doctor management:
  - Create doctor: only `clinic_admin` / `branch_manager`.
  - Edit doctor profile:
    - `clinic_admin` / `branch_manager`: full edit
    - `doctor`: limited self-edit fields only
    - `receptionist` / `assistant`: no edits

## Navigation / UX
- Doctor default landing remains `/dashboard`.
- Doctor sidebar adds a dedicated **Calendar** item.
- Doctor profile route `/workflows/my-profile` supports `?tab=` so nav can open Calendar vs Availability.

## Branch Profile
- Branch Profile is **branch settings only** (active branch context):
  - `booking_enabled`, `walkin_enabled`, `token_system_enabled`
  - `max_advance_booking_days`, `min_booking_notice_minutes`

## Implementation Checklist
1. Backend: enforce role matrix on staff create/update (clinic-side).
2. Backend: block staff endpoints for receptionist/assistant/doctor.
3. Backend: doctor profile endpoints enforce role-based allowed fields.
4. Frontend: centralize allowed staff role options; apply in all staff create UIs.
5. Frontend: add Branch Profile workflow page + route + sidebar.
6. Frontend: add Doctor Calendar sidebar item; preserve tab query.
7. Validate: build frontend; basic API smoke checks.
