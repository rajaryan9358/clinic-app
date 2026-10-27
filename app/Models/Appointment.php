<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

class Appointment extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'uuid', 'patient_id', 'doctor_id', 'service_id', 'appointment_date',
        'start_time', 'end_time', 'token_number', 'visit_type', 'consultation_mode', 'booking_source_id',
        'booking_channel', 'status', 'payment_status', 'appointment_fee', 'discount_amount', 'final_amount',
        'booked_by_user_id', 'confirmed_at', 'checked_in_at', 'completed_at', 'cancelled_at',
        'cancellation_reason', 'rescheduled_from_appointment_id', 'notes',
    ];

    /** Lets the staff UI show "Undo" only inside the server's window. */
    protected $appends = ['can_undo_status'];

    protected function casts(): array
    {
        return [
            'appointment_date' => 'date',
            'appointment_fee' => 'decimal:2',
            'discount_amount' => 'decimal:2',
            'final_amount' => 'decimal:2',
            'confirmed_at' => 'datetime',
            'checked_in_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    /**
     * True while AppointmentService::undoStatus() would accept this
     * appointment's status and date: cancelled / no-show / completed, and
     * the clinic-local date is on or before the appointment day. Read from
     * raw attributes so partial selects never trip over missing columns.
     * Permissions and slot conflicts are still checked by the endpoint.
     */
    protected function canUndoStatus(): Attribute
    {
        return Attribute::get(function (): bool {
            $status = $this->attributes['status'] ?? null;
            $date = $this->attributes['appointment_date'] ?? null;
            if (! in_array($status, ['cancelled', 'no_show', 'completed'], true) || ! $date) {
                return false;
            }

            return Carbon::now(config('app.clinic_timezone', 'Asia/Kolkata'))->toDateString() <= substr((string) $date, 0, 10);
        });
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

    public function statusLogs(): HasMany
    {
        return $this->hasMany(AppointmentStatusLog::class);
    }

    public function prescriptions(): HasMany
    {
        return $this->hasMany(AppointmentPrescription::class);
    }
}
