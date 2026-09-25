<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ClinicSubscription extends Model
{
    public const STATUSES = ['trialing', 'pending_payment', 'active', 'past_due', 'expired', 'cancelled'];

    protected $fillable = [
        'clinic_id', 'plan_id', 'billing_cycle', 'status', 'trial_ends_at', 'current_period_start',
        'current_period_end', 'grace_ends_at', 'razorpay_subscription_id',
        'pending_razorpay_subscription_id', 'cancelled_at',
    ];

    protected $casts = [
        'trial_ends_at' => 'datetime', 'current_period_start' => 'datetime', 'current_period_end' => 'datetime',
        'grace_ends_at' => 'datetime', 'cancelled_at' => 'datetime',
    ];

    public function clinic(): BelongsTo { return $this->belongsTo(Clinic::class); }
    public function plan(): BelongsTo { return $this->belongsTo(Plan::class)->withTrashed(); }
    public function transactions(): HasMany { return $this->hasMany(SubscriptionTransaction::class); }

    public function allowsAccess(): bool
    {
        $now = now();

        return match ($this->status) {
            'trialing' => $this->trial_ends_at !== null && $this->trial_ends_at->gt($now),
            'active' => true,
            'pending_payment', 'past_due' => $this->grace_ends_at !== null && $this->grace_ends_at->gt($now),
            'cancelled' => $this->current_period_end !== null && $this->current_period_end->gt($now),
            default => false,
        };
    }
}
