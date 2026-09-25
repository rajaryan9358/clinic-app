<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\DoctorScheduleException;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DoctorProfileController extends Controller
{
    use ApiResponse;

    private function findDoctor(int $id): Doctor
    {
        return Doctor::query()
            ->withTrashed()
            ->with([
                'services:id,name',
                'schedules',
                'exceptions',
            ])
            ->findOrFail($id);
    }

    public function profile(Request $request, int $id)
    {
        $doctor = $this->findDoctor($id);

        return $this->success('Doctor profile fetched', [
            'doctor' => $doctor,
            'service_ids' => $doctor->services->pluck('id')->values(),
            'setup' => [
                'has_services' => $doctor->services->count() > 0,
                'has_schedules' => $doctor->schedules->count() > 0,
            ],
        ]);
    }

    public function updateProfile(Request $request, int $id)
    {
        $doctor = $this->findDoctor($id);
        $clinicId = (int) $doctor->clinic_id;

        $data = validator($request->all(), [
            'full_name' => ['sometimes', 'string', 'max:255'],
            'title' => ['nullable', 'string', 'max:255'],
            'specialization' => ['nullable', 'string', 'max:255'],
            'qualification' => ['nullable', 'string', 'max:255'],
            'registration_number' => ['nullable', 'string', 'max:255'],
            'experience_years' => ['nullable', 'integer', 'min:0'],
            'gender' => ['nullable', 'in:male,female,other'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email'],
            'consultation_fee' => ['nullable', 'numeric', 'min:0'],
            'followup_fee' => ['nullable', 'numeric', 'min:0'],
            'slot_duration_minutes' => ['nullable', 'integer', 'min:5', 'max:240'],
            'buffer_time_minutes' => ['nullable', 'integer', 'min:0', 'max:120'],
            'bio' => ['nullable', 'string'],
            'photo_url' => ['nullable', 'string', 'max:2048'],
            'status' => ['nullable', 'in:active,inactive'],

            'service_ids' => ['nullable', 'array'],
            'service_ids.*' => ['integer', Rule::exists('services', 'id')->where('clinic_id', $clinicId)],
        ])->validate();

        $doctor->fill(collect($data)->except(['service_ids'])->all());
        $doctor->save();

        if (array_key_exists('service_ids', $data)) {
            $serviceIds = array_values(array_unique(array_map('intval', $data['service_ids'] ?? [])));
            $payload = [];
            foreach ($serviceIds as $serviceId) {
                $payload[$serviceId] = ['clinic_id' => $clinicId];
            }
            $doctor->services()->sync($payload);
        }

        $doctor->refresh()->load(['services:id,name', 'schedules', 'exceptions']);

        return $this->success('Doctor profile updated', [
            'doctor' => $doctor,
            'service_ids' => $doctor->services->pluck('id')->values(),
        ]);
    }

    public function storeSchedule(Request $request, int $id)
    {
        $doctor = $this->findDoctor($id);
        $clinicId = (int) $doctor->clinic_id;

        $data = validator($request->all(), [
            'day_of_week' => ['required', 'integer', 'min:0', 'max:6'],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i'],
            'consultation_mode' => ['required', 'in:in_person,video,both'],
            'max_patients' => ['nullable', 'integer', 'min:1'],
            'slot_duration_minutes' => ['nullable', 'integer', 'min:5', 'max:240'],
            'buffer_time_minutes' => ['nullable', 'integer', 'min:0', 'max:120'],
            'is_active' => ['nullable', 'boolean'],
        ])->validate();

        $schedule = DoctorSchedule::create([
            'clinic_id' => $clinicId,
            'doctor_id' => $doctor->id,
            'day_of_week' => $data['day_of_week'],
            'start_time' => $data['start_time'],
            'end_time' => $data['end_time'],
            'consultation_mode' => $data['consultation_mode'],
            'max_patients' => $data['max_patients'] ?? null,
            'slot_duration_minutes' => $data['slot_duration_minutes'] ?? null,
            'buffer_time_minutes' => $data['buffer_time_minutes'] ?? null,
            'is_active' => (bool) ($data['is_active'] ?? true),
        ]);

        return $this->success('Schedule added', $schedule, 201);
    }

    public function updateSchedule(Request $request, int $id, int $scheduleId)
    {
        $doctor = $this->findDoctor($id);
        $clinicId = (int) $doctor->clinic_id;

        $schedule = DoctorSchedule::query()
            ->where('clinic_id', $clinicId)
            ->where('doctor_id', $doctor->id)
            ->findOrFail($scheduleId);

        $data = validator($request->all(), [
            'day_of_week' => ['sometimes', 'integer', 'min:0', 'max:6'],
            'start_time' => ['sometimes', 'date_format:H:i'],
            'end_time' => ['sometimes', 'date_format:H:i'],
            'consultation_mode' => ['sometimes', 'in:in_person,video,both'],
            'max_patients' => ['nullable', 'integer', 'min:1'],
            'slot_duration_minutes' => ['nullable', 'integer', 'min:5', 'max:240'],
            'buffer_time_minutes' => ['nullable', 'integer', 'min:0', 'max:120'],
            'is_active' => ['nullable', 'boolean'],
        ])->validate();

        $schedule->update($data);

        return $this->success('Schedule updated', $schedule->refresh());
    }

    public function destroySchedule(Request $request, int $id, int $scheduleId)
    {
        $doctor = $this->findDoctor($id);
        $clinicId = (int) $doctor->clinic_id;

        $schedule = DoctorSchedule::query()
            ->where('clinic_id', $clinicId)
            ->where('doctor_id', $doctor->id)
            ->findOrFail($scheduleId);

        $schedule->delete();

        return $this->success('Schedule removed');
    }

    public function storeException(Request $request, int $id)
    {
        $doctor = $this->findDoctor($id);
        $clinicId = (int) $doctor->clinic_id;

        $data = validator($request->all(), [
            'exception_date' => ['required', 'date'],
            'type' => ['required', 'in:leave,blocked,special_hours'],
            'start_time' => ['nullable', 'date_format:H:i'],
            'end_time' => ['nullable', 'date_format:H:i'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ])->validate();

        $exception = DoctorScheduleException::create([
            'clinic_id' => $clinicId,
            'doctor_id' => $doctor->id,
            'exception_date' => $data['exception_date'],
            'type' => $data['type'],
            'start_time' => $data['start_time'] ?? null,
            'end_time' => $data['end_time'] ?? null,
            'reason' => $data['reason'] ?? null,
        ]);

        return $this->success('Exception added', $exception, 201);
    }

    public function destroyException(Request $request, int $id, int $exceptionId)
    {
        $doctor = $this->findDoctor($id);
        $clinicId = (int) $doctor->clinic_id;

        $exception = DoctorScheduleException::query()
            ->where('clinic_id', $clinicId)
            ->where('doctor_id', $doctor->id)
            ->findOrFail($exceptionId);

        $exception->delete();

        return $this->success('Exception removed');
    }
}
