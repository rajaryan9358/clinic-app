<?php

namespace Tests\Feature\Portal;

use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PortalConsent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Patient-portal prescriptions: list/detail/pdf, all scoped to the acting
 * profile's own appointments and to *finalized* rows only — a draft, no
 * matter how recent, must never surface here. See
 * App\Support\Prescriptions\PrescriptionResolver and
 * App\Http\Controllers\Api\Portal\PrescriptionController.
 */
class PortalPrescriptionsTest extends TestCase
{
    use PortalTestHelpers;
    use RefreshDatabase;

    private Clinic $clinic;

    private Doctor $doctor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app->instance(WhatsAppGateway::class, new FakeWhatsAppGateway);

        $this->clinic = $this->makeClinic();
        $this->doctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Asha Rao',
            'specialization' => 'General Medicine',
            'status' => 'active',
            'slot_duration_minutes' => 30,
        ]);
    }

    private function consentedPatient(Clinic $clinic, array $attrs = []): Patient
    {
        $patient = $this->makePatient($clinic, $attrs);
        $patient->forceFill(['consent_given_at' => now(), 'consent_version' => PortalConsent::VERSION])->save();

        return $patient;
    }

    private function appointment(Patient $patient, array $overrides = []): Appointment
    {
        return Appointment::create(array_merge([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => Carbon::now()->subDays(2)->toDateString(),
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'completed',
        ], $overrides));
    }

    private function rx(Appointment $appointment, array $overrides = []): AppointmentPrescription
    {
        return AppointmentPrescription::create(array_merge([
            'clinic_id' => $appointment->clinic_id,
            'appointment_id' => $appointment->id,
            'data' => ['medicines' => [['name' => 'Paracetamol'], ['name' => 'Cetirizine']]],
            'status' => 'draft',
        ], $overrides));
    }

    public function test_list_shows_only_latest_final_per_appointment(): void
    {
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        // Appointment A: an older final superseded by a newer final — the
        // list must show the newer one only.
        $apptA = $this->appointment($patient);
        $olderFinal = $this->rx($apptA, ['status' => 'final', 'finalized_at' => now(), 'data' => ['medicines' => [['name' => 'Old Med']]]]);
        $newerFinal = $this->rx($apptA, ['status' => 'final', 'finalized_at' => now(), 'data' => ['medicines' => [['name' => 'New Med']]]]);

        // Appointment B: a final row, then a later unreviewed draft — the
        // draft must be ignored and the existing final still shown.
        $apptB = $this->appointment($patient, ['appointment_date' => Carbon::now()->subDays(5)->toDateString()]);
        $finalB = $this->rx($apptB, ['status' => 'final', 'finalized_at' => now(), 'data' => ['medicines' => [['name' => 'Amoxicillin']]]]);
        $this->rx($apptB, ['status' => 'draft', 'data' => ['medicines' => [['name' => 'Draft Only Med']]]]);

        // Appointment C: draft only — must not appear at all.
        $apptC = $this->appointment($patient, ['appointment_date' => Carbon::now()->subDays(1)->toDateString()]);
        $this->rx($apptC, ['status' => 'draft']);

        // Another patient's appointment/prescription must never leak in.
        $other = $this->consentedPatient($this->clinic, ['phone' => '9000000111']);
        $apptOther = $this->appointment($other);
        $this->rx($apptOther, ['status' => 'final', 'finalized_at' => now()]);

        $response = $this->portalGet('/api/portal/prescriptions', $token, $patient->id);

        $response->assertOk();
        $items = $response->json('data');

        $this->assertCount(2, $items);

        $byAppointment = collect($items)->keyBy('appointment_id');

        $this->assertSame($newerFinal->id, $byAppointment[$apptA->id]['id']);
        $this->assertSame(['New Med'], $byAppointment[$apptA->id]['medicines']);
        $this->assertSame($this->doctor->full_name, $byAppointment[$apptA->id]['doctor_name']);
        $this->assertSame($apptA->appointment_date->toDateString(), $byAppointment[$apptA->id]['date']);

        $this->assertSame($finalB->id, $byAppointment[$apptB->id]['id']);
        $this->assertSame(['Amoxicillin'], $byAppointment[$apptB->id]['medicines']);
    }

    public function test_detail_returns_final_prescription_shape(): void
    {
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $appt = $this->appointment($patient);
        $final = $this->rx($appt, [
            'status' => 'final',
            'finalized_at' => now(),
            'data' => ['medicines' => [['name' => 'Paracetamol']], 'diagnosis' => 'Common cold'],
        ]);

        $response = $this->portalGet("/api/portal/prescriptions/{$final->id}", $token, $patient->id);

        $response->assertOk();
        $data = $response->json('data');

        $this->assertSame($final->id, $data['id']);
        $this->assertSame($appt->id, $data['appointment_id']);
        $this->assertSame($appt->appointment_date->toDateString(), $data['date']);
        $this->assertSame($this->doctor->full_name, $data['doctor']['name']);
        $this->assertSame($this->doctor->specialization, $data['doctor']['specialization']);
        $this->assertSame($this->clinic->name, $data['clinic']['name']);
        $this->assertSame('Common cold', $data['data']['diagnosis']);
        $this->assertNotNull($data['finalized_at']);
    }

    public function test_detail_404_for_draft_and_other_patient(): void
    {
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $appt = $this->appointment($patient);
        $draft = $this->rx($appt, ['status' => 'draft']);

        $this->portalGet("/api/portal/prescriptions/{$draft->id}", $token, $patient->id)->assertNotFound();

        $other = $this->consentedPatient($this->clinic, ['phone' => '9000000222']);
        $apptOther = $this->appointment($other);
        $finalOther = $this->rx($apptOther, ['status' => 'final', 'finalized_at' => now()]);

        $this->portalGet("/api/portal/prescriptions/{$finalOther->id}", $token, $patient->id)->assertNotFound();
    }

    public function test_pdf_streams_final_prescription_and_404_for_draft_and_other_patient(): void
    {
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $appt = $this->appointment($patient);
        $final = $this->rx($appt, ['status' => 'final', 'finalized_at' => now()]);
        $draft = $this->rx($appt, ['status' => 'draft']);

        $pdfResponse = $this->portalGet("/api/portal/prescriptions/{$final->id}/pdf", $token, $patient->id);
        $pdfResponse->assertOk();
        $pdfResponse->assertHeader('Content-Type', 'application/pdf');

        $this->portalGet("/api/portal/prescriptions/{$draft->id}/pdf", $token, $patient->id)->assertNotFound();

        $other = $this->consentedPatient($this->clinic, ['phone' => '9000000333']);
        $apptOther = $this->appointment($other);
        $finalOther = $this->rx($apptOther, ['status' => 'final', 'finalized_at' => now()]);

        $this->portalGet("/api/portal/prescriptions/{$finalOther->id}/pdf", $token, $patient->id)->assertNotFound();
    }
}
