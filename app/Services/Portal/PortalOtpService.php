<?php

namespace App\Services\Portal;

use App\Models\LoginOtp;
use App\Models\Patient;
use App\Services\WhatsApp\PatientNotifier;
use App\Services\WhatsApp\PhoneNumber;
use App\Support\Portal\PortalProfiles;
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
            throw ValidationException::withMessages(['code' => 'Code expired. Request a new code.']);
        }

        if ($otp->attempts >= 5) {
            throw ValidationException::withMessages(['code' => 'Too many attempts. Request a new code.']);
        }

        if (! hash_equals($otp->otp_code, hash('sha256', $code))) {
            $otp->attempts++;
            $otp->save();

            $message = $otp->attempts >= 5 ? 'Too many attempts. Request a new code.' : 'Incorrect code.';

            throw ValidationException::withMessages(['code' => $message]);
        }

        $holders = PortalProfiles::accountHoldersForPhone((string) $normalised);

        if ($holders->count() > 1 && $patientId === null) {
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
}
