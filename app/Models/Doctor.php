<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Doctor extends Model
{
    use HasFactory, SoftDeletes, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'user_id', 'full_name', 'title', 'specialization', 'qualification',
        'registration_number', 'experience_years', 'gender', 'phone', 'email',
        'consultation_fee', 'followup_fee', 'slot_duration_minutes', 'buffer_time_minutes',
        'bio', 'photo_url', 'status',
    ];

    protected function casts(): array
    {
        return [
            'consultation_fee' => 'decimal:2',
            'followup_fee' => 'decimal:2',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function schedules(): HasMany
    {
        return $this->hasMany(DoctorSchedule::class);
    }

    public function exceptions(): HasMany
    {
        return $this->hasMany(DoctorScheduleException::class);
    }

    public function services(): BelongsToMany
    {
        return $this->belongsToMany(Service::class, 'doctor_services')
            ->withPivot(['clinic_id']);
    }

    public function assistants(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'assistant_doctor_map', 'doctor_id', 'assistant_user_id')
            ->withPivot(['clinic_id']);
    }

    /**
     * Consultation modes offered across the doctor's active schedules
     * ('both' ⇒ in_person + video), for the portal's mode pickers.
     * Uses the `schedules` relation when it's already loaded (callers
     * eager-load it constrained to is_active).
     *
     * @return array<int, string>
     */
    public function consultationModes(): array
    {
        $schedules = $this->relationLoaded('schedules')
            ? $this->schedules
            : $this->schedules()->where('is_active', true)->get();

        return $schedules
            ->flatMap(fn (DoctorSchedule $s) => $s->consultation_mode === 'both' ? ['in_person', 'video'] : [$s->consultation_mode])
            ->filter()
            ->unique()
            ->values()
            ->all();
    }
}
