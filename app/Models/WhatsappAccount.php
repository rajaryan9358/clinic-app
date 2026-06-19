<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WhatsappAccount extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'branch_id', 'business_name', 'phone_number', 'provider', 'phone_number_id',
        'waba_id', 'access_token_encrypted', 'webhook_verify_token', 'status',
    ];

    protected $hidden = [
        'access_token_encrypted',
        'webhook_verify_token',
    ];
}
