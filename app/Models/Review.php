<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Review extends Model
{
    protected $fillable = [
        'clinic_id',
        'branch_id',
        'reviewer_name',
        'message',
        'rating',
        'review_date',
        'sentiment',
        'sentiment_message',
        'improvement_suggestion',
        'reply_text',
        'reply_meta',
        'replied_at',
    ];

    protected $casts = [
        'review_date' => 'datetime',
        'replied_at' => 'datetime',
        'reply_meta' => 'array',
        'rating' => 'integer',
    ];

    public function clinic()
    {
        return $this->belongsTo(Clinic::class);
    }

    public function branch()
    {
        return $this->belongsTo(Branch::class);
    }
}
