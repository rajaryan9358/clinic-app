<?php

namespace Tests\Feature\WhatsApp;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Models\WhatsappMessage;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The admin appointment drawer (Task 6) fetches
 * `GET .../whatsapp/messages?appointment_id=<id>` to show only the WhatsApp
 * messages linked to the appointment being viewed. Both the clinic and
 * super-admin CRUD controllers must honour that filter.
 */
class MessagesAppointmentFilterTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function clinic(): Clinic
    {
        return Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Filter Clinic',
            'slug' => 'filter-clinic-'.Str::random(6),
            'status' => 'active',
        ]);
    }

    private function appointment(Clinic $clinic, Doctor $doctor): Appointment
    {
        $patient = Patient::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Pat',
            'full_name' => 'Pat',
            'phone' => '9876543210',
        ]);

        return Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => now()->addDay()->toDateString(),
            'start_time' => '10:00:00',
            'visit_type' => 'new',
            'booking_channel' => 'staff',
            'status' => 'confirmed',
        ]);
    }

    private function message(Clinic $clinic, Appointment $appointment): WhatsappMessage
    {
        return WhatsappMessage::create([
            'clinic_id' => $clinic->id,
            'appointment_id' => $appointment->id,
            'direction' => 'outgoing',
            'message_type' => 'template',
            'notification_type' => 'booking_confirmed',
            'delivery_status' => 'sent',
        ]);
    }

    public function test_clinic_endpoint_filters_messages_by_appointment_id(): void
    {
        $clinic = $this->clinic();
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr F']);

        $target = $this->appointment($clinic, $doctor);
        $other = $this->appointment($clinic, $doctor);

        $targetMessage = $this->message($clinic, $target);
        $this->message($clinic, $other);

        $user = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Clinic Admin',
            'email' => Str::random(8).'@x.test',
            'password' => 'x',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');
        Sanctum::actingAs($user);

        $res = $this->getJson('/api/clinic/whatsapp/messages?appointment_id='.$target->id)->assertOk();

        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertSame([$targetMessage->id], $ids);
    }

    public function test_super_admin_endpoint_filters_messages_by_appointment_id(): void
    {
        $clinic = $this->clinic();
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr G']);

        $target = $this->appointment($clinic, $doctor);
        $other = $this->appointment($clinic, $doctor);

        $targetMessage = $this->message($clinic, $target);
        $this->message($clinic, $other);

        $superAdmin = User::create([
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => Str::random(8).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $superAdmin->assignRole('super_admin');
        Sanctum::actingAs($superAdmin);

        $res = $this->getJson('/api/super-admin/whatsapp/messages?appointment_id='.$target->id)->assertOk();

        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertSame([$targetMessage->id], $ids);
    }
}
