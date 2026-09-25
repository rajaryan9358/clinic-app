<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SubscriptionTransaction extends Model
{
    protected $fillable = [
        'clinic_id', 'clinic_subscription_id', 'plan_id', 'billing_cycle', 'amount', 'currency', 'status', 'source',
        'method', 'razorpay_payment_id', 'razorpay_subscription_id', 'razorpay_invoice_id', 'invoice_url',
        'failure_reason', 'notes', 'recorded_by', 'paid_at', 'period_start', 'period_end',
    ];

    protected $casts = [
        'amount' => 'integer', 'paid_at' => 'datetime', 'period_start' => 'datetime', 'period_end' => 'datetime',
    ];

    public function clinic(): BelongsTo { return $this->belongsTo(Clinic::class); }
    public function plan(): BelongsTo { return $this->belongsTo(Plan::class)->withTrashed(); }
    public function subscription(): BelongsTo { return $this->belongsTo(ClinicSubscription::class, 'clinic_subscription_id'); }
}
