<?php

namespace App\Http\Middleware;

use App\Enums\UserRole;
use App\Models\Doctor;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveClinicContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            abort(401, 'Unauthenticated');
        }

        if ($user->role === UserRole::SUPER_ADMIN->value) {
            return $next($request);
        }

        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $user->clinic_id);

        // Doctor context: doctor role is always scoped to the user's doctor record.
        if ($user->role === UserRole::DOCTOR->value) {
            $doctor = Doctor::query()
                ->where('clinic_id', $clinicId)
                ->where('user_id', $user->id)
                ->first();

            if (! $doctor) {
                abort(403, 'Doctor profile not linked to this user.');
            }

            $request->attributes->set('allowed_doctor_ids', [(int) $doctor->id]);
            $request->attributes->set('active_doctor_id', (int) $doctor->id);

            if ($request->filled('doctor_id') && (int) $request->input('doctor_id') !== (int) $doctor->id) {
                abort(403, 'Doctor filter not allowed.');
            }
        }

        // Assistant context: assistants can be tagged to one or more doctors.
        if ($user->role === UserRole::ASSISTANT->value) {
            $assigned = $user->assignedDoctors()
                ->select(['doctors.id'])
                ->where('doctors.clinic_id', $clinicId)
                ->orderBy('doctors.id')
                ->get();

            $allowedDoctorIds = $assigned->pluck('id')->map(fn ($id) => (int) $id)->values()->all();

            if (count($allowedDoctorIds) === 0) {
                abort(403, 'No doctors assigned to assistant.');
            }

            if (count($allowedDoctorIds) > 0) {
                $requestedDoctorId = $this->intOrNull($request->header('X-Doctor-Id'))
                    ?? $this->intOrNull($request->input('active_doctor_id'));

                $activeDoctorId = $requestedDoctorId ?: (int) $allowedDoctorIds[0];
                if (! in_array($activeDoctorId, $allowedDoctorIds, true)) {
                    abort(403, 'Doctor not allowed.');
                }

                if ($request->filled('doctor_id') && (int) $request->input('doctor_id') !== $activeDoctorId) {
                    abort(403, 'Doctor filter not allowed.');
                }

                if ($request->filled('preferred_doctor_id') && (int) $request->input('preferred_doctor_id') !== $activeDoctorId) {
                    abort(403, 'Preferred doctor filter not allowed.');
                }

                $request->attributes->set('allowed_doctor_ids', $allowedDoctorIds);
                $request->attributes->set('active_doctor_id', $activeDoctorId);
            }
        }

        return $next($request);
    }

    private function intOrNull(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }

        return (int) $value;
    }
}
