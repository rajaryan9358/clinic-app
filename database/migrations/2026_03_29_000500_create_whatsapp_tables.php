<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('patient_id')->nullable()->constrained('patients')->nullOnDelete();
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
            $table->string('template_name')->nullable();
            $table->string('notification_type')->nullable();
            $table->string('provider_message_id')->nullable();
            $table->string('from_phone', 20)->nullable();
            $table->string('to_phone', 20)->nullable();
            $table->text('content_text')->nullable();
            $table->json('payload_json')->nullable();
            $table->enum('delivery_status', ['queued', 'sent', 'delivered', 'read', 'failed', 'received', 'skipped'])->default('queued');
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
    }
};
