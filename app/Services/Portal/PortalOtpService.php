<?php

namespace App\Services\Portal;

use App\Models\LoginOtp;
use App\Models\Patient;
use App\Services\WhatsApp\PatientNotifier;
use App\Services\WhatsApp\PhoneNumber;
use App\Support\Portal\PortalProfiles;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * WhatsApp one-time-code login for the patient portal.
 *
 * request() always replies the same way regardless of whether the phone
 * is registered (no enumeration); a `login_otps` row and a WhatsApp send
 * only happen when the phone matches at least one portal account holder.
 * verify() resolves the stored, hashed code for that phone and either
 * logs the sole matching account holder in, or — when several account
 * holders (across clinics) share the phone — asks the caller to pick one
 * without consuming the code.
 */
final class PortalOtpService
{
    private const TOO_MANY_REQUESTS = 'Too many code requests. Try again later.';

    private const TOO_MANY_ATTEMPTS = 'Too many attempts. Request a new code.';

    private const CODE_EXPIRED = 'Code expired. Request a new code.';

    public function __construct(private PatientNotifier $notifier) {}

    public function request(string $rawPhone): void
    {
        $normalised = PhoneNumber::normalise($rawPhone);

        if ($normalised === null) {
            return;
        }

        $recent = LoginOtp::where('phone_or_email', $normalised)
            ->where('purpose', 'login');

        if ((clone $recent)->where('created_at', '>=', now()->subSeconds(60))->exists()) {
            abort(429, self::TOO_MANY_REQUESTS);
        }

        if ((clone $recent)->where('created_at', '>=', now()->subHour())->count() >= 5) {
            abort(429, self::TOO_MANY_REQUESTS);
        }

        $holders = PortalProfiles::accountHoldersForPhone($normalised);

        if ($holders->isEmpty()) {
            return;
        }

        $code = (string) random_int(100000, 999999);

        LoginOtp::create([
            'clinic_id' => null,
            'phone_or_email' => $normalised,
            'otp_code' => hash('sha256', $code),
            'purpose' => 'login',
            'attempts' => 0,
            'expires_at' => now()->addMinutes(10),
            'created_at' => now(),
        ]);

        $this->notifier->loginOtp($normalised, $code);
    }

    /**
     * @return array{status: 'ok', patient: Patient}|array{status: 'choose', choices: array}
     */
    public function verify(string $rawPhone, string $code, ?int $patientId): array
    {
        $normalised = PhoneNumber::normalise($rawPhone);

        $otp = $normalised === null ? null : LoginOtp::where('phone_or_email', $normalised)
            ->where('purpose', 'login')
            ->whereNull('verified_at')
            ->latest('id')
            ->first();

        if ($otp === null || $otp->expires_at->isPast()) {
            throw ValidationException::withMessages(['code' => self::CODE_EXPIRED]);
        }

        // Atomically reserve an attempt slot before evaluating the code: a
        // single conditional UPDATE (only succeeds while attempts < 5) is
        // what actually enforces the cap under concurrent guesses, since a
        // separate read-then-write (SELECT attempts, then save()) could let
        // several concurrent requests all observe a stale count and each
        // slip past the check.
        if (! $this->reserveAttempt($otp)) {
            throw ValidationException::withMessages(['code' => self::TOO_MANY_ATTEMPTS]);
        }

        $otp->refresh();

        if (! hash_equals($otp->otp_code, hash('sha256', $code))) {
            $message = $otp->attempts >= 5 ? self::TOO_MANY_ATTEMPTS : 'Incorrect code.';

            throw ValidationException::withMessages(['code' => $message]);
        }

        $holders = PortalProfiles::accountHoldersForPhone((string) $normalised);

        if ($holders->count() > 1 && $patientId === null) {
            $holders->load('clinic');

            return [
                'status' => 'choose',
                'choices' => $holders->map(fn (Patient $p) => [
                    'patient_id' => $p->id,
                    'patient_name' => $p->full_name,
                    'clinic_id' => $p->clinic_id,
                    'clinic_name' => $p->clinic?->name,
                ])->values()->all(),
            ];
        }

        $patient = $patientId === null
            ? $holders->first()
            : $holders->first(fn (Patient $p) => $p->id === $patientId);

        if ($patient === null) {
            throw ValidationException::withMessages(['patient_id' => 'Choose one of the profiles linked to this number.']);
        }

        $otp->verified_at = now();
        $otp->save();

        return ['status' => 'ok', 'patient' => $patient];
    }

    /**
     * Consumes one of the OTP's 5 allowed attempts via a single
     * conditional UPDATE, so the cap holds even when guesses race each
     * other: only one such statement can win when attempts is already 4,
     * and any request that finds attempts already at 5 gets 0 affected
     * rows instead of a stale, already-exceeded count.
     */
    private function reserveAttempt(LoginOtp $otp): bool
    {
        $affected = DB::table('login_otps')
            ->where('id', $otp->id)
            ->where('attempts', '<', 5)
            ->update(['attempts' => DB::raw('attempts + 1')]);

        return $affected > 0;
    }
}
