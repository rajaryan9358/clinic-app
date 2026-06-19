<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clinics', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name');
            $table->string('legal_name')->nullable();
            $table->string('slug')->unique();
            $table->string('owner_name')->nullable();
            $table->string('owner_phone', 20)->nullable();
            $table->string('owner_email')->nullable();
            $table->string('logo_url')->nullable();
            $table->string('primary_color')->nullable();
            $table->string('secondary_color')->nullable();
            $table->enum('status', ['active', 'trial', 'suspended', 'inactive'])->default('trial');
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreign('clinic_id')->references('id')->on('clinics')->nullOnDelete();
        });

        Schema::create('branches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->uuid('uuid')->unique();
            $table->string('name');
            $table->string('code')->nullable();
            $table->string('address_line_1')->nullable();
            $table->string('address_line_2')->nullable();
            $table->string('city')->nullable();
            $table->string('state')->nullable();
            $table->string('pincode')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('email')->nullable();
            $table->boolean('is_main_branch')->default(false);
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['clinic_id', 'status']);
            $table->index(['clinic_id', 'is_main_branch']);
        });

        Schema::create('domains', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('host')->unique();
            $table->enum('type', ['booking', 'portal', 'website', 'custom']);
            $table->boolean('is_primary')->default(false);
            $table->enum('ssl_status', ['pending', 'active', 'failed'])->nullable();
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
            $table->index(['clinic_id', 'type']);
        });

        Schema::create('user_branch_map', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->boolean('is_default')->default(false);
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['user_id', 'branch_id']);
            $table->index(['clinic_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_branch_map');
        Schema::dropIfExists('domains');
        Schema::dropIfExists('branches');

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['clinic_id']);
        });

        Schema::dropIfExists('clinics');
    }
};
