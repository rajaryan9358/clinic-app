<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('appointment_reschedule_logs', function (Blueprint $table) {
            $table->date('old_appointment_date')->nullable()->after('new_appointment_id');
            $table->time('old_start_time')->nullable()->after('old_appointment_date');
            $table->time('old_end_time')->nullable()->after('old_start_time');
            $table->date('new_appointment_date')->nullable()->after('old_end_time');
            $table->time('new_start_time')->nullable()->after('new_appointment_date');
            $table->time('new_end_time')->nullable()->after('new_start_time');

            $table->index(['clinic_id', 'new_appointment_id'], 'arl_clinic_new_appt_idx');
        });
    }

    public function down(): void
    {
        Schema::table('appointment_reschedule_logs', function (Blueprint $table) {
            $table->dropIndex('arl_clinic_new_appt_idx');

            $table->dropColumn([
                'old_appointment_date',
                'old_start_time',
                'old_end_time',
                'new_appointment_date',
                'new_start_time',
                'new_end_time',
            ]);
        });
    }
};
