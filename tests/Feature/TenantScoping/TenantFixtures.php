<?php

namespace Tests\Feature\TenantScoping;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Invoice;
use App\Models\User;
use App\Models\WhatsappConversation;
use Illuminate\Support\Str;
use Tests\Feature\Patients\PatientTestHelpers;

/**
 * Two clinics with one of each referencable record (patient, doctor, staff
 * user, appointment, invoice, WhatsApp conversation), keyed by FK column.
 */
trait TenantFixtures
{
    use PatientTestHelpers;

    protected Clinic $clinic;

    protected Clinic $otherClinic;

    /** @var array<string, int> FK column => id in $clinic */
    protected array $local = [];

    /** @var array<string, int> FK column => id in $otherClinic */
    protected array $foreign = [];

    protected function setUpTenants(): void
    {
        $this->clinic = $this->makeClinic('Home');
        $this->otherClinic = $this->makeClinic('Other');
        $this->local = $this->recordsFor($this->clinic);
        $this->foreign = $this->recordsFor($this->otherClinic);
    }

    private function recordsFor(Clinic $clinic): array
    {
        $patient = $this->makePatient($clinic, ['first_name' => 'Secret', 'last_name' => 'Person '.$clinic->id]);
        $doctor = $this->makeDoctor($clinic);
        $user = $this->makeUser($clinic, 'receptionist');
        $appointment = $this->makeAppointmentFor($clinic, $patient->id, $doctor->id);
        $invoice = Invoice::create([
            'clinic_id' => $clinic->id,
            'patient_id' => $patient->id,
            'invoice_number' => 'INV-'.Str::random(8),
            'invoice_date' => '2026-10-01',
            'subtotal' => 500,
            'total_amount' => 500,
        ]);
        $conversation = WhatsappConversation::create([
            'clinic_id' => $clinic->id,
            'patient_id' => $patient->id,
            'customer_phone' => $patient->phone,
        ]);

        return [
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'assigned_to_user_id' => $user->id,
            'current_owner_user_id' => $user->id,
            'appointment_id' => $appointment->id,
            'invoice_id' => $invoice->id,
            'conversation_id' => $conversation->id,
        ];
    }

    protected function makeAppointmentFor(Clinic $clinic, int $patientId, int $doctorId): Appointment
    {
        return Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patientId,
            'doctor_id' => $doctorId,
            'appointment_date' => '2026-10-02',
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'staff',
            'status' => 'confirmed',
        ]);
    }

    protected function superAdmin(): User
    {
        $user = User::create([
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => 'super-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }
}
