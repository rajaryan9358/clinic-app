<?php

namespace Tests\Feature\Billing;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\Service;
use App\Services\Billing\InvoiceService;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** Shared fixtures for the billing service tests. */
trait BillingTestHelpers
{
    protected function makeBillingClinic(array $settings = []): Clinic
    {
        $clinic = Clinic::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Bill Clinic', 'slug' => 'bill-'.Str::random(6), 'status' => 'active',
        ]);

        if ($settings !== []) {
            ClinicSetting::create(array_merge(['clinic_id' => $clinic->id], $settings));
        }

        return $clinic;
    }

    protected function makeBillingDoctor(Clinic $clinic, array $attrs = []): Doctor
    {
        return Doctor::create(array_merge([
            'clinic_id' => $clinic->id, 'full_name' => 'Dr Bill', 'status' => 'active',
            'slot_duration_minutes' => 30,
        ], $attrs));
    }

    protected function makeBillingService(Clinic $clinic, array $attrs = []): Service
    {
        return Service::create(array_merge([
            'clinic_id' => $clinic->id, 'name' => 'General Checkup', 'status' => 'active',
        ], $attrs));
    }

    protected function makeBillingPatient(Clinic $clinic): Patient
    {
        return Patient::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Pat',
            'full_name' => 'Pat Ient', 'phone' => '9'.random_int(100000000, 999999999),
        ]);
    }

    protected function makeBillingAppointment(Patient $patient, Doctor $doctor, ?Service $service = null, string $visitType = 'new'): Appointment
    {
        return Appointment::create([
            'clinic_id' => $patient->clinic_id, 'uuid' => (string) Str::uuid(), 'patient_id' => $patient->id,
            'doctor_id' => $doctor->id, 'service_id' => $service?->id, 'appointment_date' => '2026-10-20',
            'start_time' => '09:00:00', 'end_time' => '09:30:00', 'visit_type' => $visitType,
            'booking_channel' => 'walk_in', 'status' => 'confirmed',
        ]);
    }

    protected function invoiceService(): InvoiceService
    {
        return app(InvoiceService::class);
    }

    /** @return array<string, mixed> */
    protected function draftData(Patient $patient, array $overrides = []): array
    {
        return array_merge([
            'patient_id' => $patient->id,
            'invoice_date' => '2026-10-16',
            'items' => [
                ['description' => 'Consultation', 'quantity' => 1, 'unit_amount' => 500],
                ['description' => 'Dressing', 'quantity' => 2, 'unit_amount' => 150.50],
            ],
        ], $overrides);
    }

    protected function assertValidationMessage(string $expected, \Closure $callback): void
    {
        try {
            $callback();
            $this->fail('Expected a ValidationException: '.$expected);
        } catch (ValidationException $e) {
            $this->assertSame($expected, collect($e->errors())->flatten()->first());
        }
    }
}
