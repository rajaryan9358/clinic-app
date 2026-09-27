<?php

namespace App\Jobs;

use App\Models\ReminderLog;
use App\Models\WhatsappMessage;
use App\Services\WhatsApp\WhatsAppGateway;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Sends the template recorded on a `whatsapp_messages` row (payload_json:
 * template, language, components) via the bound WhatsAppGateway, then
 * updates the row (and, when linked, the originating reminder_logs row)
 * with the outcome.
 */
class SendWhatsAppTemplate implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /** @var array<int, int> */
    public array $backoff = [30, 120, 600];

    public function __construct(public int $messageId) {}

    public function handle(WhatsAppGateway $gateway): void
    {
        $row = WhatsappMessage::find($this->messageId);

        if (! $row || $row->delivery_status !== 'queued') {
            // Nothing to do, or another run already resolved this row.
            return;
        }

        if (! $gateway->isConfigured()) {
            $row->delivery_status = 'skipped';
            $row->error_message = 'WhatsApp not configured';
            $row->save();

            $this->mirrorReminderLog($row, function (ReminderLog $log) {
                $log->delivery_status = 'skipped';
                $log->failure_reason = 'WhatsApp not configured';
            });

            return;
        }

        $payload = is_array($row->payload_json) ? $row->payload_json : [];
        $template = (string) ($payload['template'] ?? $row->template_name);
        $language = (string) ($payload['language'] ?? 'en');
        $components = is_array($payload['components'] ?? null) ? $payload['components'] : [];

        // Let a gateway failure bubble up so the queue retries per $tries/$backoff.
        $providerMessageId = $gateway->sendTemplate((string) $row->to_phone, $template, $language, $components);

        $row->provider_message_id = $providerMessageId;
        $row->delivery_status = 'sent';
        $row->error_message = null;
        $row->save();

        $this->mirrorReminderLog($row, function (ReminderLog $log) use ($row) {
            $log->sent_at = Carbon::now();
            $log->delivery_status = 'sent';
            $log->provider_message_id = $row->provider_message_id;
        });
    }

    public function failed(Throwable $e): void
    {
        $row = WhatsappMessage::find($this->messageId);

        if (! $row) {
            return;
        }

        $message = mb_substr($e->getMessage(), 0, 500);

        $row->delivery_status = 'failed';
        $row->error_message = $message;
        $row->save();

        $this->mirrorReminderLog($row, function (ReminderLog $log) use ($message) {
            $log->delivery_status = 'failed';
            $log->failure_reason = $message;
        });
    }

    private function mirrorReminderLog(WhatsappMessage $row, callable $apply): void
    {
        $payload = is_array($row->payload_json) ? $row->payload_json : [];
        $reminderLogId = $payload['reminder_log_id'] ?? null;

        if (! $reminderLogId) {
            return;
        }

        $log = ReminderLog::where('id', $reminderLogId)->whereNull('provider_message_id')->first();

        if (! $log) {
            return;
        }

        $apply($log);
        $log->save();
    }
}
