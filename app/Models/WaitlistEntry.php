<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A patient waiting for a taken doctor slot (E3 waitlist). "Active" means
 * `waiting` or `offered`; the other statuses (`booked`, `declined`,
 * `expired`, `removed`) are terminal. See App\Services\Waitlist\WaitlistService.
 */
class WaitlistEntry extends Model
{
    use HasFactory, BelongsToClinicScope;

    public const ACTIVE_STATUSES = ['waiting', 'offered'];

    protected $fillable = [
        'clinic_id', 'patient_id', 'doctor_id', 'appointment_date', 'start_time', 'end_time',
        'status', 'source', 'offered_at', 'hold_expires_at', 'booked_appointment_id',
        'login_link_id', 'created_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'appointment_date' => 'date',
            'offered_at' => 'datetime',
            'hold_expires_at' => 'datetime',
        ];
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->whereIn('status', self::ACTIVE_STATUSES);
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function bookedAppointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class, 'booked_appointment_id');
    }

    public function loginLink(): BelongsTo
    {
        return $this->belongsTo(PatientLoginLink::class, 'login_link_id');
    }
}
