<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patient_global_summaries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained('patients')->cascadeOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('overall_health_summary')->nullable();
            $table->json('key_concerns')->nullable();
            $table->text('treatment_progress')->nullable();
            $table->text('recommended_focus')->nullable();
            $table->timestamp('summary_generated_at')->nullable();
            $table->timestamps();

            $table->unique(['clinic_id', 'patient_id']);
            $table->index(['patient_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('patient_global_summaries');
    }
};
