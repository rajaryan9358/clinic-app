<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WhatsappFlowSession extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'conversation_id', 'patient_id', 'flow_type', 'current_step',
        'state_json', 'status', 'started_at', 'ended_at',
    ];

    protected function casts(): array
    {
        return ['state_json' => 'array', 'started_at' => 'datetime', 'ended_at' => 'datetime'];
    }
}
