<?php

namespace App\Models;

use App\Services\WhatsApp\PatientNotifier;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AppointmentPrescription extends Model
{
    protected static function booted(): void
    {
        static::created(function (self $rx) {
            DB::afterCommit(function () use ($rx) {
                try {
                    app(PatientNotifier::class)->prescriptionReady($rx);
                } catch (\Throwable $e) {
                    Log::warning('WhatsApp notifier failed: '.$e->getMessage(), ['exception' => $e]);
                }
            });
        });
    }

    protected $fillable = [
        'clinic_id',
        'appointment_id',
        'created_by_user_id',
        'source',
        'transcript_text',
        'data',
        'raw',
    ];

    protected $casts = [
        'data' => 'array',
        'raw' => 'array',
    ];

    public function appointment()
    {
        return $this->belongsTo(Appointment::class);
    }

    public function clinic()
    {
        return $this->belongsTo(Clinic::class);
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
