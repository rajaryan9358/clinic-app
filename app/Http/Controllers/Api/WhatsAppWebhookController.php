<?php

namespace App\Http\Controllers\Api;

use App\Models\ReminderLog;
use App\Models\WhatsappMessage;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PlatformSettings;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Public Meta WhatsApp webhook: the `GET` handshake Meta performs when the
 * webhook URL is configured, and the `POST` delivery-status callbacks it
 * sends afterwards (sent/delivered/read/failed) for outbound template
 * messages. No auth: the verify token (handshake) and HMAC signature (POST)
 * are the access control. See docs/superpowers/specs/2026-09-27-whatsapp-notifications-design.md §4.
 */
class WhatsAppWebhookController
{
    /** Delivery-status progression; higher rank cannot be overwritten by a lower one. */
    private const RANK = ['queued' => 0, 'sent' => 1, 'delivered' => 2, 'read' => 3];

    public function verify(Request $request): Response
    {
        $expectedToken = PlatformSettings::get('whatsapp_webhook_verify_token');

        $modeOk = $request->query('hub_mode') === 'subscribe';
        $tokenOk = filled($expectedToken) && hash_equals((string) $expectedToken, (string) $request->query('hub_verify_token'));

        if (! $modeOk || ! $tokenOk) {
            return response('Forbidden', 403);
        }

        return response((string) $request->query('hub_challenge'), 200)->header('Content-Type', 'text/plain');
    }

    public function handle(Request $request, WhatsAppGateway $gateway)
    {
        $rawBody = $request->getContent();

        if (! $gateway->verifySignature($rawBody, $request->header('X-Hub-Signature-256'))) {
            return response()->json(['ok' => false], 401);
        }

        $payload = json_decode($rawBody, true);
        $payload = is_array($payload) ? $payload : [];

        $entries = is_array($payload['entry'] ?? null) ? $payload['entry'] : [];

        foreach ($entries as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $changes = is_array($entry['changes'] ?? null) ? $entry['changes'] : [];

            foreach ($changes as $change) {
                if (! is_array($change)) {
                    continue;
                }

                $value = is_array($change['value'] ?? null) ? $change['value'] : [];
                $statuses = is_array($value['statuses'] ?? null) ? $value['statuses'] : [];

                foreach ($statuses as $status) {
                    if (is_array($status)) {
                        $this->applyStatus($status);
                    }
                }
            }
        }

        return response()->json(['ok' => true]);
    }

    private function applyStatus(array $status): void
    {
        $providerMessageId = $status['id'] ?? null;
        $newStatus = $status['status'] ?? null;

        if (! $providerMessageId || ! $newStatus) {
            return;
        }

        $message = WhatsappMessage::where('provider_message_id', $providerMessageId)->first();

        if (! $message) {
            return;
        }

        // Rows in an unranked status (failed, skipped, received, or anything
        // outside queued/sent/delivered/read) are terminal for this webhook:
        // neither a later "failed" nor a later delivered/read/sent event may
        // move them.
        $currentRank = self::RANK[$message->delivery_status] ?? null;

        if ($newStatus === 'failed') {
            if ($currentRank === null || $currentRank > 1) {
                return; // failed only overwrites a queued/sent row, not a delivered/read one.
            }

            $message->delivery_status = 'failed';
            $message->error_message = $this->extractErrorTitle($status);
            $message->save();

            $this->mirrorReminderLog($message, 'failed', $message->error_message);

            return;
        }

        $newRank = self::RANK[$newStatus] ?? null;

        if ($newRank === null || $currentRank === null || $newRank <= $currentRank) {
            return; // unknown status, current row is unranked/terminal, or moving backward/staying put.
        }

        $message->delivery_status = $newStatus;
        $message->save();

        $this->mirrorReminderLog($message, $newStatus, null);
    }

    private function extractErrorTitle(array $status): ?string
    {
        $errors = $status['errors'] ?? null;
        if (! is_array($errors) || ! is_array($errors[0] ?? null)) {
            return null;
        }

        $title = $errors[0]['title'] ?? null;

        return is_string($title) ? $title : null;
    }

    private function mirrorReminderLog(WhatsappMessage $message, string $status, ?string $failureReason): void
    {
        $log = $this->findLinkedReminderLog($message);

        if (! $log) {
            return;
        }

        $log->delivery_status = $status;
        if ($failureReason !== null) {
            $log->failure_reason = $failureReason;
        }
        $log->save();
    }

    /**
     * Locates the reminder_logs row a whatsapp_messages row belongs to, the
     * same way SendWhatsAppTemplate::mirrorReminderLog() links them —
     * primarily via payload_json.reminder_log_id (stamped by
     * PatientNotifier::appointmentReminder) — with a fallback match on
     * appointment + reminder type + provider id for rows that don't carry it.
     */
    private function findLinkedReminderLog(WhatsappMessage $message): ?ReminderLog
    {
        $payload = is_array($message->payload_json) ? $message->payload_json : [];
        $reminderLogId = $payload['reminder_log_id'] ?? null;

        if ($reminderLogId) {
            $log = ReminderLog::find($reminderLogId);
            if ($log) {
                return $log;
            }
        }

        if (! $message->appointment_id || ! $message->provider_message_id) {
            return null;
        }

        return ReminderLog::where('appointment_id', $message->appointment_id)
            ->where('reminder_type', 'appointment_reminder')
            ->where('provider_message_id', $message->provider_message_id)
            ->first();
    }
}
