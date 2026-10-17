<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained('invoices')->cascadeOnDelete();
            $table->foreignId('service_id')->nullable()->constrained('services')->nullOnDelete();
            $table->string('description');
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('unit_amount', 12, 2);
            $table->decimal('amount', 12, 2);
            $table->unsignedInteger('sort_order')->default(0);
        });

        // One row per clinic per April-March financial year (period like "2026-27").
        Schema::create('invoice_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->string('period', 9);
            $table->unsignedInteger('next_number')->default(1);

            $table->unique(['clinic_id', 'period']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_counters');
        Schema::dropIfExists('invoice_items');
    }
};
