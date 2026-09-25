<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FileUpload extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id', 'patient_id', 'appointment_id', 'uploaded_by_user_id', 'module',
        'file_name', 'file_path', 'mime_type', 'file_size', 'visibility', 'created_at',
    ];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
