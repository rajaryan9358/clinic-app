<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RazorpayWebhookEvent extends Model
{
    protected $fillable = ['event_id', 'event', 'payload', 'processed_at'];

    protected $casts = ['payload' => 'array', 'processed_at' => 'datetime'];
}
