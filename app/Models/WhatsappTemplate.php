<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WhatsappTemplate extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'whatsapp_account_id', 'name', 'template_key', 'category', 'language',
        'header_text', 'body_text', 'footer_text', 'variables_json', 'status',
    ];

    protected function casts(): array
    {
        return ['variables_json' => 'array'];
    }
}
