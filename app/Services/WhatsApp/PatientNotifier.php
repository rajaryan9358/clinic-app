<?php

namespace App\Services\WhatsApp;

use App\Jobs\SendWhatsAppTemplate;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\ReminderLog;
use App\Models\WhatsappMessage;
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
        [$date, $time] = $this->formatDateTime($appointment);
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
        [$date, $time] = $this->formatDateTime($appointment);
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
        [$date, $time] = $this->formatDateTime($appointment);
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
        );
    }

    /** @return array{0: string, 1: string} [date, time] */
    private function formatDateTime(Appointment $appointment): array
    {
        $moment = Carbon::parse($appointment->appointment_date->toDateString().' '.$appointment->start_time);

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
            'components' => $this->buildComponents($bodyParams, $header, $buttonCode),
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
    private function buildComponents(array $bodyParams, ?array $header, ?string $buttonCode): array
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
                static fn (string $param) => ['type' => 'text', 'text' => $param],
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
}
