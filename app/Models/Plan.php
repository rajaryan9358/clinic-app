<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Plan extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name', 'description', 'monthly_price', 'yearly_price', 'max_doctors', 'max_staff',
        'max_appointments_per_month', 'is_active', 'razorpay_plan_id_monthly', 'razorpay_plan_id_yearly', 'sort_order',
    ];

    protected $casts = [
        'monthly_price' => 'integer', 'yearly_price' => 'integer', 'max_doctors' => 'integer',
        'max_staff' => 'integer', 'max_appointments_per_month' => 'integer', 'is_active' => 'boolean', 'sort_order' => 'integer',
    ];

    public function subscriptions(): HasMany
    {
        return $this->hasMany(ClinicSubscription::class);
    }

    public function priceFor(string $cycle): ?int
    {
        return $cycle === 'yearly' ? $this->yearly_price : $this->monthly_price;
    }

    public function limitFor(string $resource): ?int
    {
        return match ($resource) {
            'doctors' => $this->max_doctors,
            'staff' => $this->max_staff,
            'appointments' => $this->max_appointments_per_month,
            default => null,
        };
    }
}
