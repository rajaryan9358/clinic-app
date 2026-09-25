<?php

namespace App\Http\Controllers\Api;

use App\Models\RazorpayWebhookEvent;
use App\Services\Billing\RazorpayGateway;
use App\Services\Billing\RazorpayWebhookHandler;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RazorpayWebhookController
{
    public function __construct(private readonly RazorpayGateway $gateway, private readonly RazorpayWebhookHandler $handler) {}

    public function __invoke(Request $request)
    {
        $body = $request->getContent();
        if (! $this->gateway->verifyWebhookSignature($body, (string) $request->header('X-Razorpay-Signature', ''))) {
            return response()->json(['ok' => false, 'message' => 'Invalid signature'], 400);
        }

        $payload = json_decode($body, true) ?: [];
        $eventId = (string) ($request->header('X-Razorpay-Event-Id') ?: 'hash_'.hash('sha256', $body));

        DB::transaction(function () use ($eventId, $payload) {
            $record = RazorpayWebhookEvent::query()->lockForUpdate()->firstOrCreate(
                ['event_id' => $eventId],
                ['event' => (string) ($payload['event'] ?? ''), 'payload' => $payload],
            );
            if ($record->processed_at) {
                return;
            }
            $this->handler->handle((string) ($payload['event'] ?? ''), $payload['payload'] ?? []);
            $record->update(['processed_at' => now()]);
        });

        return response()->json(['ok' => true]);
    }
}
