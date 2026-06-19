<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('user_branch_map') && ! Schema::hasColumn('user_branch_map', 'updated_at')) {
            Schema::table('user_branch_map', function (Blueprint $table) {
                $table->timestamp('updated_at')->nullable()->after('created_at');
            });
        }

        if (Schema::hasTable('doctor_branch_map') && ! Schema::hasColumn('doctor_branch_map', 'updated_at')) {
            Schema::table('doctor_branch_map', function (Blueprint $table) {
                $table->timestamp('updated_at')->nullable()->after('created_at');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('user_branch_map') && Schema::hasColumn('user_branch_map', 'updated_at')) {
            Schema::table('user_branch_map', function (Blueprint $table) {
                $table->dropColumn('updated_at');
            });
        }

        if (Schema::hasTable('doctor_branch_map') && Schema::hasColumn('doctor_branch_map', 'updated_at')) {
            Schema::table('doctor_branch_map', function (Blueprint $table) {
                $table->dropColumn('updated_at');
            });
        }
    }
};
