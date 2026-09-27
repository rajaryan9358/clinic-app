<?php

namespace App\Services\Portal;

use App\Models\Patient;
use App\Models\PatientLoginLink;
use App\Models\WhatsappMessage;
use App\Services\WhatsApp\PatientNotifier;
use App\Support\Portal\PortalProfiles;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Staff-issued single-use magic login links for the patient portal.
 *
 * issue() creates the `patient_login_links` row (7-day expiry, sha256
 * token hash) and always sends the `portal_link` WhatsApp template via
 * PatientNotifier — the row is written even when that send is itself
 * skipped (disabled template, no phone), so the caller can still report
 * the link's URL and the message's delivery status.
 *
 * consume() resolves and single-use-consumes a raw token for the public
 * exchange endpoint. Every failure — unknown/consumed/expired token,
 * soft-deleted patient, portal disabled for the clinic — collapses to
 * the same "This link has expired." message, matching the OTP service's
 * no-enumeration stance.
 */
final class PortalLinkService
{
    private const EXPIRED = 'This link has expired.';

    public function __construct(private PatientNotifier $notifier) {}

    /**
     * @return array{url: string, expires_at: Carbon, whatsapp: WhatsappMessage}
     */
    public function issue(Patient $patient, ?int $createdByUserId): array
    {
        if ($patient->managed_by_patient_id !== null) {
            throw ValidationException::withMessages([
                'patient_id' => 'Send the link to the account holder.',
            ]);
        }

        $token = Str::random(40);
        $expiresAt = now()->addDays(7);

        PatientLoginLink::create([
            'clinic_id' => $patient->clinic_id,
            'patient_id' => $patient->id,
            'token_hash' => hash('sha256', $token),
            'expires_at' => $expiresAt,
            'created_by_user_id' => $createdByUserId,
            'created_at' => now(),
        ]);

        $whatsapp = $this->notifier->portalLink($patient, $token);

        // The sync queue worker updates this row's delivery status via a
        // separate model instance (SendWhatsAppTemplate loads it by id);
        // refresh so the caller sees the post-send status, not the
        // pre-dispatch 'queued' value still held on this instance.
        $whatsapp->refresh();

        return [
            'url' => rtrim((string) config('app.url'), '/').'/portal/login/'.$token,
            'expires_at' => $expiresAt,
            'whatsapp' => $whatsapp,
        ];
    }

    public function consume(string $rawToken): Patient
    {
        $link = PatientLoginLink::where('token_hash', hash('sha256', $rawToken))->first();

        if ($link === null || $link->consumed_at !== null || $link->expires_at->isPast()) {
            throw ValidationException::withMessages(['token' => self::EXPIRED]);
        }

        // Atomically reserve the single use: only one concurrent request
        // can win this conditional UPDATE, mirroring the OTP attempt cap.
        $affected = DB::table('patient_login_links')
            ->where('id', $link->id)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => now()]);

        if ($affected === 0) {
            throw ValidationException::withMessages(['token' => self::EXPIRED]);
        }

        $patient = Patient::withTrashed()->find($link->patient_id);

        if ($patient === null || $patient->trashed() || ! PortalProfiles::portalEnabled($patient->clinic_id)) {
            throw ValidationException::withMessages(['token' => self::EXPIRED]);
        }

        return $patient;
    }
}
