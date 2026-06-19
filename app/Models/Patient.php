<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Patient extends Model
{
    use HasFactory, SoftDeletes, BelongsToClinicScope;

    protected static function booted(): void
    {
        static::creating(function (Patient $patient) {
            if (empty($patient->uuid)) {
                $patient->uuid = (string) Str::uuid();
            }

            if (empty($patient->status_tag)) {
                $patient->status_tag = 'active';
            }

            if (empty($patient->full_name)) {
                $full = trim((string) ($patient->first_name ?? '') . ' ' . (string) ($patient->last_name ?? ''));
                $patient->full_name = $full !== '' ? $full : (string) ($patient->first_name ?? '');
            }
        });

        static::saving(function (Patient $patient) {
            $shouldRecalc = empty($patient->full_name) || $patient->isDirty('first_name') || $patient->isDirty('last_name');
            if ($shouldRecalc) {
                $full = trim((string) ($patient->first_name ?? '') . ' ' . (string) ($patient->last_name ?? ''));
                $patient->full_name = $full !== '' ? $full : (string) ($patient->first_name ?? '');
            }
        });
    }

    protected $fillable = [
        'clinic_id', 'uuid', 'branch_id', 'first_name', 'last_name', 'full_name', 'gender', 'dob', 'age',
        'phone', 'alternate_phone', 'email', 'blood_group', 'address_line_1', 'address_line_2', 'city',
        'state', 'pincode', 'occupation', 'referred_by', 'preferred_doctor_id', 'communication_consent',
        'whatsapp_opt_in', 'sms_opt_in', 'email_opt_in', 'first_visit_date', 'last_visit_date',
        'visit_count', 'no_show_count', 'status_tag',
    ];

    protected function casts(): array
    {
        return [
            'dob' => 'date',
            'first_visit_date' => 'date',
            'last_visit_date' => 'date',
            'communication_consent' => 'boolean',
            'whatsapp_opt_in' => 'boolean',
            'sms_opt_in' => 'boolean',
            'email_opt_in' => 'boolean',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function medicalProfile()
    {
        return $this->hasOne(PatientMedicalProfile::class);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(PatientNote::class);
    }
}
