<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('appointment_summaries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('appointment_id')->constrained('appointments')->cascadeOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('source', ['voice'])->default('voice');
            $table->longText('transcript_text')->nullable();
            $table->text('patient_summary')->nullable();
            $table->text('doctor_suggestions')->nullable();
            $table->json('preferred_medications')->nullable();
            $table->json('raw')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'appointment_id']);
            $table->index(['appointment_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appointment_summaries');
    }
};
