<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clinic_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->unique()->constrained('clinics')->cascadeOnDelete();
            $table->boolean('booking_enabled')->default(true);
            $table->boolean('whatsapp_booking_enabled')->default(true);
            $table->boolean('auto_confirm_appointments')->default(false);
            $table->boolean('allow_reschedule')->default(true);
            $table->boolean('allow_cancel')->default(true);
            $table->unsignedInteger('reschedule_cutoff_hours')->default(2);
            $table->unsignedInteger('cancel_cutoff_hours')->default(2);
            $table->unsignedInteger('default_slot_duration_minutes')->default(15);
            $table->boolean('walkin_enabled')->default(true);
            $table->boolean('token_system_enabled')->default(false);
            $table->unsignedInteger('max_advance_booking_days')->default(30);
            $table->unsignedInteger('min_booking_notice_minutes')->default(30);
            $table->text('booking_notice_text')->nullable();
            $table->text('terms_text')->nullable();
            $table->text('privacy_policy_text')->nullable();
            $table->timestamps();
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('appointments')->nullOnDelete();
            $table->string('invoice_number')->unique();
            $table->date('invoice_date');
            $table->decimal('subtotal', 12, 2);
            $table->decimal('discount_amount', 12, 2)->default(0);
            $table->decimal('tax_amount', 12, 2)->default(0);
            $table->decimal('total_amount', 12, 2);
            $table->enum('status', ['draft', 'issued', 'paid', 'cancelled'])->default('draft');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
            $table->index(['clinic_id', 'invoice_date'], 'inv_clinic_date_idx');
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('invoice_id')->nullable()->constrained('invoices')->nullOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('appointments')->nullOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->enum('payment_method', ['cash', 'upi', 'card', 'bank_transfer', 'other']);
            $table->string('reference_number')->nullable();
            $table->timestamp('paid_at');
            $table->enum('status', ['success', 'pending', 'failed', 'refunded'])->default('success');
            $table->foreignId('collected_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
            $table->index(['clinic_id', 'paid_at']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->nullable()->constrained('clinics')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('module');
            $table->string('entity_type');
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('action');
            $table->json('old_values_json')->nullable();
            $table->json('new_values_json')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['clinic_id', 'module']);
            $table->index(['clinic_id', 'created_at'], 'audit_clinic_created_idx');
        });

        Schema::create('login_otps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->nullable()->constrained('clinics')->nullOnDelete();
            $table->string('phone_or_email');
            $table->string('otp_code', 10);
            $table->enum('purpose', ['login', 'verify_phone', 'verify_email', 'password_reset']);
            $table->timestamp('expires_at');
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['phone_or_email', 'purpose'], 'otp_contact_purpose_idx');
            $table->index('expires_at');
        });

        Schema::create('file_uploads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->nullable()->constrained('patients')->nullOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('appointments')->nullOnDelete();
            $table->foreignId('uploaded_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('module');
            $table->string('file_name');
            $table->string('file_path');
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->enum('visibility', ['private', 'clinic', 'patient'])->default('private');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['clinic_id', 'module']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_uploads');
        Schema::dropIfExists('login_otps');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('clinic_settings');
    }
};
