<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_sources', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->string('name');
            $table->enum('type', ['organic', 'ads', 'referral', 'walk_in', 'other']);
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
        });

        Schema::create('appointments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->uuid('uuid')->unique();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('doctors')->cascadeOnDelete();
            $table->foreignId('service_id')->nullable()->constrained('services')->nullOnDelete();
            $table->date('appointment_date');
            $table->time('start_time');
            $table->time('end_time')->nullable();
            $table->unsignedInteger('token_number')->nullable();
            $table->enum('visit_type', ['new', 'followup', 'routine', 'urgent']);
            $table->enum('consultation_mode', ['in_person', 'video', 'phone'])->default('in_person');
            $table->foreignId('booking_source_id')->nullable()->constrained('booking_sources')->nullOnDelete();
            $table->enum('booking_channel', ['walk_in', 'phone', 'website', 'whatsapp', 'google', 'staff', 'other']);
            $table->enum('status', ['pending', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show', 'rescheduled'])->default('pending');
            $table->enum('payment_status', ['unpaid', 'partial', 'paid', 'waived'])->default('unpaid');
            $table->decimal('appointment_fee', 10, 2)->nullable();
            $table->decimal('discount_amount', 10, 2)->default(0);
            $table->decimal('final_amount', 10, 2)->nullable();
            $table->foreignId('booked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('checked_in_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->text('cancellation_reason')->nullable();
            $table->unsignedBigInteger('rescheduled_from_appointment_id')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->foreign('rescheduled_from_appointment_id')
                ->references('id')
                ->on('appointments')
                ->nullOnDelete();

            $table->index(['clinic_id', 'appointment_date'], 'appt_clinic_date_idx');
            $table->index(['clinic_id', 'doctor_id', 'appointment_date'], 'appt_clinic_doc_date_idx');
            $table->index(['clinic_id', 'status']);
        });

        Schema::create('appointment_status_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('appointment_id')->constrained('appointments')->cascadeOnDelete();
            $table->string('old_status')->nullable();
            $table->string('new_status');
            $table->foreignId('changed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('source', ['system', 'staff', 'patient', 'whatsapp']);
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['clinic_id', 'appointment_id'], 'asl_clinic_appt_idx');
        });

        Schema::create('appointment_reschedule_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('old_appointment_id')->constrained('appointments')->cascadeOnDelete();
            $table->foreignId('new_appointment_id')->constrained('appointments')->cascadeOnDelete();
            $table->foreignId('changed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['clinic_id', 'old_appointment_id'], 'arl_clinic_old_appt_idx');
        });

        Schema::create('followup_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('appointments')->nullOnDelete();
            $table->foreignId('assigned_to_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('doctors')->nullOnDelete();
            $table->date('due_date');
            $table->time('due_time')->nullable();
            $table->enum('task_type', ['call', 'whatsapp', 'review_request', 'followup_visit', 'lab_reminder', 'custom']);
            $table->enum('status', ['pending', 'done', 'skipped', 'cancelled'])->default('pending');
            $table->enum('priority', ['low', 'medium', 'high'])->default('medium');
            $table->text('note')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
            $table->index(['clinic_id', 'due_date']);
        });

        Schema::create('reminder_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('appointment_id')->constrained('appointments')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->enum('channel', ['whatsapp', 'sms', 'email', 'call']);
            $table->enum('reminder_type', ['booking_confirmation', '24h_before', '2h_before', 'missed_visit', 'followup_due', 'review_request']);
            $table->timestamp('scheduled_for')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->enum('delivery_status', ['pending', 'sent', 'failed', 'read', 'delivered'])->default('pending');
            $table->string('provider_message_id')->nullable();
            $table->text('failure_reason')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'delivery_status']);
            $table->index(['clinic_id', 'reminder_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reminder_logs');
        Schema::dropIfExists('followup_tasks');
        Schema::dropIfExists('appointment_reschedule_logs');
        Schema::dropIfExists('appointment_status_logs');
        Schema::dropIfExists('appointments');
        Schema::dropIfExists('booking_sources');
    }
};
