<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Numbers restart at 00001 per clinic, so uniqueness is per clinic, not global. */
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropUnique(['invoice_number']);
            $table->unique(['clinic_id', 'invoice_number'], 'invoices_clinic_number_unique');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropUnique('invoices_clinic_number_unique');
            $table->unique('invoice_number');
        });
    }
};
