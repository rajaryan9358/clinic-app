<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class LoginOtp extends Model
{
    use HasFactory;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id', 'phone_or_email', 'otp_code', 'purpose', 'expires_at', 'verified_at', 'created_at',
    ];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'verified_at' => 'datetime', 'created_at' => 'datetime'];
    }
}
