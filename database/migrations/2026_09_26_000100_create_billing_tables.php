<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedInteger('monthly_price');
            $table->unsignedInteger('yearly_price')->nullable();
            $table->unsignedInteger('max_doctors')->nullable();
            $table->unsignedInteger('max_staff')->nullable();
            $table->unsignedInteger('max_appointments_per_month')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('razorpay_plan_id_monthly')->nullable();
            $table->string('razorpay_plan_id_yearly')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('clinic_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->unique()->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('plans');
            $table->enum('billing_cycle', ['monthly', 'yearly'])->default('monthly');
            $table->enum('status', ['trialing', 'pending_payment', 'active', 'past_due', 'expired', 'cancelled']);
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_start')->nullable();
            $table->timestamp('current_period_end')->nullable();
            $table->timestamp('grace_ends_at')->nullable();
            $table->string('razorpay_subscription_id')->nullable()->unique();
            $table->string('pending_razorpay_subscription_id')->nullable()->unique();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index('status');
        });

        Schema::create('subscription_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('clinic_subscription_id')->nullable()->constrained('clinic_subscriptions')->nullOnDelete();
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->enum('billing_cycle', ['monthly', 'yearly'])->nullable();
            $table->unsignedInteger('amount');
            $table->string('currency', 3)->default('INR');
            $table->enum('status', ['captured', 'failed', 'refunded']);
            $table->enum('source', ['razorpay', 'offline']);
            $table->string('method')->nullable();
            $table->string('razorpay_payment_id')->nullable()->unique();
            $table->string('razorpay_subscription_id')->nullable();
            $table->string('razorpay_invoice_id')->nullable();
            $table->string('invoice_url')->nullable();
            $table->string('failure_reason')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('period_start')->nullable();
            $table->timestamp('period_end')->nullable();
            $table->timestamps();
            $table->index(['clinic_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });

        Schema::create('razorpay_webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_id')->unique();
            $table->string('event');
            $table->json('payload');
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('razorpay_webhook_events');
        Schema::dropIfExists('subscription_transactions');
        Schema::dropIfExists('clinic_subscriptions');
        Schema::dropIfExists('plans');
    }
};
