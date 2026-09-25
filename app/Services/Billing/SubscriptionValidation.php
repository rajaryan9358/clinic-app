<?php

namespace App\Services\Billing;

use App\Models\Plan;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SubscriptionValidation
{
    /**
     * Validation rules for creating a subscription (plan_id, billing_cycle, start_mode, ...).
     *
     * @param  string  $prefix  Dot-prefix for the field names, e.g. "subscription" for onboarding's nested payload.
     * @param  string  $requiredRule  The "required" rule to use for the always-required fields
     *                                (e.g. "required_with:subscription" when the whole block is optional).
     */
    public static function rules(string $prefix = '', string $requiredRule = 'required'): array
    {
        $key = fn (string $field): string => $prefix === '' ? $field : "{$prefix}.{$field}";

        return [
            $key('plan_id') => [$requiredRule, 'integer', Rule::exists('plans', 'id')->where('is_active', true)->whereNull('deleted_at')],
            $key('billing_cycle') => [$requiredRule, 'in:monthly,yearly'],
            $key('start_mode') => [$requiredRule, 'in:trial,pending_payment,paid_offline'],
            $key('trial_days') => ['sometimes', 'integer', 'min:1', 'max:365'],
            $key('offline_amount') => ['required_if:'.$key('start_mode').',paid_offline', 'integer', 'min:1'],
            $key('offline_period_months') => ['sometimes', 'integer', 'min:1', 'max:36'],
            $key('offline_notes') => ['nullable', 'string', 'max:500'],
        ];
    }

    public static function assertYearlyPriceAvailable(Plan $plan, string $cycle, string $field = 'billing_cycle'): void
    {
        if ($cycle === 'yearly' && $plan->yearly_price === null) {
            throw ValidationException::withMessages([$field => 'This plan has no yearly price.']);
        }
    }
}
