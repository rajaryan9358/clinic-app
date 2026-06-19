<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_service_map', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->foreignId('service_id')->constrained('services')->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['branch_id', 'service_id']);
            $table->index(['clinic_id', 'branch_id']);
            $table->index(['clinic_id', 'service_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_service_map');
    }
};
