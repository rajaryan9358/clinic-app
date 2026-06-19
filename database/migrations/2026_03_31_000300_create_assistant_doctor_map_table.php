<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assistant_doctor_map', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('assistant_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('doctors')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['assistant_user_id', 'doctor_id']);
            $table->index(['clinic_id', 'assistant_user_id']);
            $table->index(['clinic_id', 'doctor_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assistant_doctor_map');
    }
};
