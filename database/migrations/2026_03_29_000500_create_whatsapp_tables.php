<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->string('business_name')->nullable();
            $table->string('phone_number', 20);
            $table->enum('provider', ['meta', 'twilio', 'gupshup', 'interakt', 'other']);
            $table->string('phone_number_id')->nullable();
            $table->string('waba_id')->nullable();
            $table->text('access_token_encrypted')->nullable();
            $table->string('webhook_verify_token')->nullable();
            $table->enum('status', ['active', 'inactive', 'pending'])->default('pending');
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
        });

        Schema::create('whatsapp_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('whatsapp_account_id')->nullable()->constrained('whatsapp_accounts')->nullOnDelete();
            $table->string('name');
            $table->string('template_key')->nullable();
            $table->enum('category', ['utility', 'marketing', 'authentication']);
            $table->string('language')->default('en');
            $table->string('header_text')->nullable();
            $table->text('body_text');
            $table->string('footer_text')->nullable();
            $table->json('variables_json')->nullable();
            $table->enum('status', ['draft', 'submitted', 'approved', 'rejected', 'active', 'inactive'])->default('draft');
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
        });

        Schema::create('whatsapp_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->nullable()->constrained('patients')->nullOnDelete();
            $table->foreignId('whatsapp_account_id')->nullable()->constrained('whatsapp_accounts')->nullOnDelete();
            $table->string('customer_phone', 20);
            $table->timestamp('last_message_at')->nullable();
            $table->timestamp('last_incoming_at')->nullable();
            $table->timestamp('last_outgoing_at')->nullable();
            $table->enum('conversation_status', ['open', 'closed', 'bot_active', 'staff_active'])->default('open');
            $table->enum('current_owner_type', ['bot', 'staff', 'system'])->default('system');
            $table->foreignId('current_owner_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('tags_json')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'conversation_status'], 'wc_clinic_status_idx');
            $table->index(['clinic_id', 'customer_phone'], 'wc_clinic_phone_idx');
        });

        Schema::create('whatsapp_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained('whatsapp_conversations')->cascadeOnDelete();
            $table->foreignId('patient_id')->nullable()->constrained('patients')->nullOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('appointments')->nullOnDelete();
            $table->enum('direction', ['incoming', 'outgoing']);
            $table->enum('message_type', ['text', 'template', 'image', 'document', 'interactive', 'button', 'location', 'other']);
            $table->foreignId('template_id')->nullable()->constrained('whatsapp_templates')->nullOnDelete();
            $table->string('provider_message_id')->nullable();
            $table->string('from_phone', 20)->nullable();
            $table->string('to_phone', 20)->nullable();
            $table->text('content_text')->nullable();
            $table->json('payload_json')->nullable();
            $table->enum('delivery_status', ['queued', 'sent', 'delivered', 'read', 'failed', 'received'])->default('queued');
            $table->text('error_message')->nullable();
            $table->foreignId('sent_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['clinic_id', 'conversation_id', 'created_at'], 'wm_clinic_conv_created_idx');
            $table->index(['clinic_id', 'delivery_status'], 'wm_clinic_delivery_idx');
        });

        Schema::create('whatsapp_flow_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained('whatsapp_conversations')->cascadeOnDelete();
            $table->foreignId('patient_id')->nullable()->constrained('patients')->nullOnDelete();
            $table->enum('flow_type', ['appointment_booking', 'confirmation', 'reschedule', 'cancellation', 'review_request', 'support']);
            $table->string('current_step');
            $table->json('state_json')->nullable();
            $table->enum('status', ['active', 'completed', 'expired', 'cancelled', 'handover'])->default('active');
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            $table->index(['clinic_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_flow_sessions');
        Schema::dropIfExists('whatsapp_messages');
        Schema::dropIfExists('whatsapp_conversations');
        Schema::dropIfExists('whatsapp_templates');
        Schema::dropIfExists('whatsapp_accounts');
    }
};
