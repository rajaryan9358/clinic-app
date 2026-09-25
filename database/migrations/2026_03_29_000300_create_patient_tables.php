<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->uuid('uuid')->unique();
            $table->string('first_name');
            $table->string('last_name')->nullable();
            $table->string('full_name');
            $table->enum('gender', ['male', 'female', 'other'])->nullable();
            $table->date('dob')->nullable();
            $table->unsignedInteger('age')->nullable();
            $table->string('phone', 20);
            $table->string('alternate_phone', 20)->nullable();
            $table->string('email')->nullable();
            $table->string('blood_group')->nullable();
            $table->string('address_line_1')->nullable();
            $table->string('address_line_2')->nullable();
            $table->string('city')->nullable();
            $table->string('state')->nullable();
            $table->string('pincode')->nullable();
            $table->string('occupation')->nullable();
            $table->string('referred_by')->nullable();
            $table->foreignId('preferred_doctor_id')->nullable()->constrained('doctors')->nullOnDelete();
            $table->boolean('communication_consent')->default(true);
            $table->boolean('whatsapp_opt_in')->default(true);
            $table->boolean('sms_opt_in')->default(true);
            $table->boolean('email_opt_in')->default(false);
            $table->date('first_visit_date')->nullable();
            $table->date('last_visit_date')->nullable();
            $table->unsignedInteger('visit_count')->default(0);
            $table->unsignedInteger('no_show_count')->default(0);
            $table->enum('status_tag', ['active', 'followup_due', 'inactive', 'blocked'])->default('active');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['clinic_id', 'phone']);
            $table->index(['clinic_id', 'status_tag']);
        });

        Schema::create('patient_medical_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->text('allergies')->nullable();
            $table->text('chronic_conditions')->nullable();
            $table->text('current_medications')->nullable();
            $table->text('surgeries_history')->nullable();
            $table->text('family_history')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique(['clinic_id', 'patient_id']);
        });

        Schema::create('patient_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('doctors')->nullOnDelete();
            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->enum('note_type', ['general', 'doctor_note', 'reception_note', 'followup_note']);
            $table->text('note');
            $table->boolean('is_private')->default(false);
            $table->timestamps();

            $table->index(['clinic_id', 'patient_id'], 'pn_clinic_patient_idx');
        });

        Schema::create('patient_family_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('related_patient_id')->constrained('patients')->cascadeOnDelete();
            $table->string('relation')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['patient_id', 'related_patient_id']);
            $table->index(['clinic_id', 'patient_id'], 'pfl_clinic_patient_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('patient_family_links');
        Schema::dropIfExists('patient_notes');
        Schema::dropIfExists('patient_medical_profiles');
        Schema::dropIfExists('patients');
    }
};
