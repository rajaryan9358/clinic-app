<?php

namespace App\Services\WhatsApp;

use App\Jobs\SendWhatsAppTemplate;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\ReminderLog;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use App\Services\Billing\InvoiceService;
use Carbon\Carbon;
use Illuminate\Support\Facades\URL;

/**
 * Builds a `whatsapp_messages` row for every patient-facing notification,
 * then hands the actual send off to the queued SendWhatsAppTemplate job.
 *
 * Skips (template disabled, no phone number) are recorded on the row and
 * never dispatched. Whether WhatsApp itself is configured is decided by the
 * job (see SendWhatsAppTemplate::handle) so that turning it on later, after
 * a row was already queued, still works.
 */
class PatientNotifier
{
    public function bookingConfirmed(Appointment $appointment): WhatsappMessage
    {
        $appointment->loadMissing(['clinic:id,name', 'doctor:id,full_name', 'patient:id,full_name,phone']);
        [$date, $time] = $this->formatDateTime($appointment->appointment_date, $appointment->start_time);
        $clinicName = (string) ($appointment->clinic?->name ?? '');

        return $this->send(
            type: 'booking_confirmed',
            clinicId: $appointment->clinic_id,
            patientId: $appointment->patient_id,
            appointmentId: $appointment->id,
            phone: $appointment->patient?->phone,
            bodyParams: [
                (string) ($appointment->patient?->full_name ?? ''),
                $clinicName,
                (string) ($appointment->doctor?->full_name ?? ''),
                $date,
                $time,
            ],
            preview: "Your appointment at {$clinicName} is confirmed for {$date} {$time}.",
        );
    }

    /** @param  string  $change  'rescheduled'|'cancelled' */
    public function appointmentUpdated(Appointment $appointment, string $change): WhatsappMessage
    {
        $appointment->loadMissing(['clinic:id,name', 'doctor:id,full_name', 'patient:id,full_name,phone']);
        [$date, $time] = $this->formatDateTime($appointment->appointment_date, $appointment->start_time);
        $clinicName = (string) ($appointment->clinic?->name ?? '');
        $statusLine = $change === 'cancelled' ? 'has been cancelled' : 'has been rescheduled to';

        return $this->send(
            type: 'appointment_updated',
            clinicId: $appointment->clinic_id,
            patientId: $appointment->patient_id,
            appointmentId: $appointment->id,
            phone: $appointment->patient?->phone,
            bodyParams: [
                (string) ($appointment->patient?->full_name ?? ''),
                $clinicName,
                $statusLine,
                $date,
                $time,
            ],
            preview: "Your appointment at {$clinicName} {$statusLine} {$date} {$time}.",
        );
    }

    public function appointmentReminder(Appointment $appointment, ?ReminderLog $log = null): WhatsappMessage
    {
        $appointment->loadMissing(['clinic:id,name', 'doctor:id,full_name', 'patient:id,full_name,phone']);
        [$date, $time] = $this->formatDateTime($appointment->appointment_date, $appointment->start_time);
        $clinicName = (string) ($appointment->clinic?->name ?? '');

        return $this->send(
            type: 'appointment_reminder',
            clinicId: $appointment->clinic_id,
            patientId: $appointment->patient_id,
            appointmentId: $appointment->id,
            phone: $appointment->patient?->phone,
            bodyParams: [
                (string) ($appointment->patient?->full_name ?? ''),
                $clinicName,
                (string) ($appointment->doctor?->full_name ?? ''),
                $date,
                $time,
            ],
            preview: "Reminder: your appointment at {$clinicName} is on {$date} {$time}.",
            reminderLogId: $log?->id,
        );
    }

    public function prescriptionReady(AppointmentPrescription $rx): WhatsappMessage
    {
        $appointment = $rx->relationLoaded('appointment')
            ? $rx->appointment
            : Appointment::find($rx->appointment_id);
        $appointment?->loadMissing(['clinic:id,name', 'doctor:id,full_name', 'patient:id,full_name,phone']);
        $clinicName = (string) ($appointment?->clinic?->name ?? '');

        $url = URL::temporarySignedRoute(
            'whatsapp.prescription-pdf',
            now()->addDays(7),
            ['prescription' => $rx->id],
        );

        return $this->send(
            type: 'prescription_ready',
            clinicId: $rx->clinic_id ?? $appointment?->clinic_id,
            patientId: $appointment?->patient_id,
            appointmentId: $rx->appointment_id,
            phone: $appointment?->patient?->phone,
            bodyParams: [
                (string) ($appointment?->patient?->full_name ?? ''),
                $clinicName,
                (string) ($appointment?->doctor?->full_name ?? ''),
            ],
            preview: "Your prescription from {$clinicName} is ready.",
            header: [
                'link' => $url,
                'filename' => 'prescription-'.$rx->appointment_id.'.pdf',
            ],
        );
    }

    public function loginOtp(string $phone, string $code, ?int $clinicId = null): WhatsappMessage
    {
        return $this->send(
            type: 'login_otp',
            clinicId: $clinicId,
            patientId: null,
            appointmentId: null,
            phone: $phone,
            bodyParams: [$code],
            preview: "Your login code is {$code}.",
            buttonCode: $code,
            sanitiseBody: false,
        );
    }

    /**
     * Sends a staff-issued single-use magic login link. $token is the raw
     * (unhashed) `patient_login_links` token; the URL button parameter is
     * the token itself, matching the Meta template's dynamic URL suffix.
     */
    public function portalLink(Patient $patient, string $token): WhatsappMessage
    {
        $patient->loadMissing('clinic:id,name');
        $clinicName = (string) ($patient->clinic?->name ?? '');
        $url = rtrim((string) config('app.url'), '/').'/portal/login/'.$token;

        return $this->send(
            type: 'portal_link',
            clinicId: $patient->clinic_id,
            patientId: $patient->id,
            appointmentId: null,
            phone: $patient->phone,
            bodyParams: [
                (string) ($patient->full_name ?? ''),
                $clinicName,
            ],
            preview: "Sign in to {$clinicName}'s patient portal: {$url}",
            buttonCode: $token,
        );
    }

    /**
     * Sends the "a slot opened up" offer for a held waitlist entry. $token
     * is the raw redirecting login-link token; the WhatsApp goes to the
     * entry patient's account holder (itself, unless it's a dependent),
     * while the message row is still attributed to the waitlisted patient.
     */
    public function waitlistOffer(WaitlistEntry $entry, string $token): WhatsappMessage
    {
        $entry->loadMissing(['clinic:id,name', 'doctor:id,full_name', 'patient:id,full_name,phone,managed_by_patient_id']);
        $holder = $entry->patient?->managed_by_patient_id !== null
            ? Patient::where('clinic_id', $entry->clinic_id)->find($entry->patient->managed_by_patient_id)
            : $entry->patient;

        $clinicName = (string) ($entry->clinic?->name ?? '');
        [$date, $time] = $this->formatDateTime($entry->appointment_date, $entry->start_time);
        $holdMinutes = ($entry->offered_at !== null && $entry->hold_expires_at !== null)
            ? (string) (int) ceil($entry->offered_at->diffInSeconds($entry->hold_expires_at) / 60)
            : '0';

        return $this->send(
            type: 'waitlist_slot_open',
            clinicId: $entry->clinic_id,
            patientId: $entry->patient_id,
            appointmentId: null,
            phone: $holder?->phone,
            bodyParams: [
                (string) ($entry->patient?->full_name ?? ''),
                $clinicName,
                (string) ($entry->doctor?->full_name ?? ''),
                $date,
                $time,
                $holdMinutes,
            ],
            preview: "A slot opened up at {$clinicName} on {$date} {$time}.",
            buttonCode: $token,
        );
    }

    /**
     * Sends the "your invoice is ready" pay-link. $token is the raw redirecting login-link
     * token (issued for the account holder); the WhatsApp goes to that holder while the row
     * stays attributed to the invoiced patient.
     */
    public function invoiceReady(Invoice $invoice, string $token): WhatsappMessage
    {
        $invoice->loadMissing(['clinic:id,name', 'patient' => fn ($q) => $q->withTrashed()]);
        $patient = $invoice->patient;
        $holder = $patient?->managed_by_patient_id !== null
            ? Patient::withTrashed()->where('clinic_id', $invoice->clinic_id)->find($patient->managed_by_patient_id)
            : $patient;

        $clinicName = (string) ($invoice->clinic?->name ?? '');
        $total = round((float) $invoice->total_amount, 2);
        $balance = round($total - app(InvoiceService::class)->amountPaid($invoice), 2);
        $totalText = '₹'.number_format($total, 2);
        $due = match (true) {
            $balance <= 0 => 'Paid in full',
            $balance < $total => 'Balance due: ₹'.number_format($balance, 2),
            default => 'Amount due: ₹'.number_format($balance, 2),
        };

        return $this->send(
            type: 'invoice_ready',
            clinicId: $invoice->clinic_id,
            patientId: $invoice->patient_id,
            appointmentId: $invoice->appointment_id,
            phone: $holder?->phone,
            bodyParams: [
                (string) ($patient?->full_name ?? ''),
                $clinicName,
                (string) $invoice->invoice_number,
                $totalText,
                $due,
            ],
            preview: "Invoice {$invoice->invoice_number} from {$clinicName}: {$totalText}. {$due}.",
            buttonCode: $token,
        );
    }

    /** @return array{0: string, 1: string} [date, time] */
    private function formatDateTime(Carbon $date, string $startTime): array
    {
        $moment = Carbon::parse($date->toDateString().' '.$startTime);

        return [$moment->format('D, d M Y'), $moment->format('g:i A')];
    }

    /**
     * @param  string[]  $bodyParams
     * @param  array{link: string, filename: string}|null  $header
     */
    private function send(
        string $type,
        ?int $clinicId,
        ?int $patientId,
        ?int $appointmentId,
        ?string $phone,
        array $bodyParams,
        string $preview,
        ?array $header = null,
        ?string $buttonCode = null,
        ?int $reminderLogId = null,
        bool $sanitiseBody = true,
    ): WhatsappMessage {
        $settings = TemplateSettings::for($type);

        $row = new WhatsappMessage([
            'clinic_id' => $clinicId,
            'patient_id' => $patientId,
            'appointment_id' => $appointmentId,
            'direction' => 'outgoing',
            'message_type' => 'template',
            'notification_type' => $type,
            'template_name' => $settings['name'],
            'content_text' => $preview,
        ]);

        if (! $settings['enabled']) {
            $row->to_phone = PhoneNumber::normalise($phone);
            $row->delivery_status = 'skipped';
            $row->error_message = 'template disabled';
            $row->save();

            return $row;
        }

        $normalisedPhone = PhoneNumber::normalise($phone);

        if ($normalisedPhone === null) {
            $row->delivery_status = 'skipped';
            $row->error_message = 'no phone number';
            $row->save();

            return $row;
        }

        $payload = [
            'template' => $settings['name'],
            'language' => $settings['language'],
            'components' => $this->buildComponents($bodyParams, $header, $buttonCode, $sanitiseBody),
        ];

        if ($reminderLogId !== null) {
            $payload['reminder_log_id'] = $reminderLogId;
        }

        $row->to_phone = $normalisedPhone;
        $row->delivery_status = 'queued';
        $row->payload_json = $payload;
        $row->save();

        SendWhatsAppTemplate::dispatch($row->id)->afterCommit();

        return $row;
    }

    /**
     * @param  string[]  $bodyParams
     * @param  array{link: string, filename: string}|null  $header
     */
    private function buildComponents(array $bodyParams, ?array $header, ?string $buttonCode, bool $sanitiseBody = true): array
    {
        $components = [];

        if ($header !== null) {
            $components[] = [
                'type' => 'header',
                'parameters' => [[
                    'type' => 'document',
                    'document' => [
                        'link' => $header['link'],
                        'filename' => $header['filename'],
                    ],
                ]],
            ];
        }

        $components[] = [
            'type' => 'body',
            'parameters' => array_map(
                fn (string $param) => ['type' => 'text', 'text' => $sanitiseBody ? $this->sanitiseTextParam($param) : $param],
                $bodyParams,
            ),
        ];

        if ($buttonCode !== null) {
            $components[] = [
                'type' => 'button',
                'sub_type' => 'url',
                'index' => '0',
                'parameters' => [[
                    'type' => 'text',
                    'text' => $buttonCode,
                ]],
            ];
        }

        return $components;
    }

    /**
     * Meta rejects template text parameters that contain newlines/tabs, runs
     * of more than 4 consecutive spaces, or are empty. Collapse any run of
     * whitespace (including \r \n \t) to a single space, trim, and fall back
     * to '-' for an empty result (e.g. a missing doctor name); cap length so
     * we never exceed Meta's limit.
     */
    private function sanitiseTextParam(string $value): string
    {
        $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');

        if ($value === '') {
            return '-';
        }

        return mb_substr($value, 0, 1024);
    }
}
