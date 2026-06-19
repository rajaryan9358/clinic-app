<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BookingSource extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = ['clinic_id', 'name', 'type', 'status'];
}
