<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('waitlist_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('doctors')->cascadeOnDelete();
            $table->date('appointment_date');
            $table->time('start_time');
            $table->time('end_time')->nullable();
            $table->enum('status', ['waiting', 'offered', 'booked', 'declined', 'expired', 'removed'])->default('waiting');
            $table->enum('source', ['portal', 'staff']);
            $table->timestamp('offered_at')->nullable();
            $table->timestamp('hold_expires_at')->nullable();
            $table->foreignId('booked_appointment_id')->nullable()->constrained('appointments')->nullOnDelete();
            $table->foreignId('login_link_id')->nullable()->constrained('patient_login_links')->nullOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['clinic_id', 'doctor_id', 'appointment_date', 'start_time', 'status'], 'waitlist_slot_idx');
            $table->index(['patient_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('waitlist_entries');
    }
};
