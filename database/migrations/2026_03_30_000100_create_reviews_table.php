<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();

            $table->string('reviewer_name')->nullable();
            $table->text('message');
            $table->unsignedTinyInteger('rating');
            $table->timestamp('review_date')->useCurrent();

            $table->string('sentiment')->nullable();
            $table->text('sentiment_message')->nullable();
            $table->text('improvement_suggestion')->nullable();

            $table->text('reply_text')->nullable();
            $table->json('reply_meta')->nullable();
            $table->timestamp('replied_at')->nullable();

            $table->timestamps();

            $table->index(['clinic_id', 'review_date']);
            $table->index(['clinic_id', 'sentiment']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};
