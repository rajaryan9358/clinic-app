<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Invoice extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'patient_id', 'appointment_id', 'invoice_number', 'invoice_date',
        'subtotal', 'discount_amount', 'tax_amount', 'total_amount', 'status', 'notes',
    ];

    protected function casts(): array
    {
        return [
            'invoice_date' => 'date',
            'subtotal' => 'decimal:2',
            'discount_amount' => 'decimal:2',
            'tax_amount' => 'decimal:2',
            'total_amount' => 'decimal:2',
        ];
    }
}
