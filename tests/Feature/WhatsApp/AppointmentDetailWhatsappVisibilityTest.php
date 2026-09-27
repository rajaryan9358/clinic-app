<?php

namespace Tests\Feature\WhatsApp;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\Role;
use App\Models\User;
use App\Models\WhatsappMessage;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * `GET appointments/{id}/detail` (clinic) is gated only by
 * `perm:appointments.view`, but its `communication.whatsapp` block returns
 * full WhatsappMessage rows (to_phone, content_text, payload_json — which
 * for prescriptions includes a signed PDF link). Doctors have
 * appointments.view but not whatsapp.view, so that block must be omitted
 * (as an empty-but-shaped structure) unless the caller also has
 * whatsapp.view.
 */
class AppointmentDetailWhatsappVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    private Doctor $doctor;

    private Appointment $appointment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);

        $this->clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Visibility Clinic',
            'slug' => 'visibility-clinic-'.Str::random(6),
            'status' => 'active',
        ]);

        $this->doctor = Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr House']);

        $patient = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'full_name' => 'Ravi Kumar',
            'phone' => '9876543210',
        ]);

        $this->appointment = Appointment::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => now()->addDay()->toDateString(),
            'start_time' => '10:00:00',
            'visit_type' => 'new',
            'booking_channel' => 'staff',
            'status' => 'confirmed',
        ]);

        WhatsappMessage::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'direction' => 'outgoing',
            'message_type' => 'template',
            'notification_type' => 'booking_confirmed',
            'to_phone' => '919876543210',
            'content_text' => 'Your appointment is confirmed.',
            'delivery_status' => 'sent',
        ]);
    }

    private function staffWith(array $permissions): User
    {
        $role = Role::create(['name' => 'r'.Str::random(8), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);

        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Staffer',
            'email' => Str::random(8).'@x.test',
            'password' => 'x',
            'role' => $role->name,
            'status' => 'active',
        ]);
        $user->syncRoles([$role->name]);

        return $user;
    }

    public function test_user_without_whatsapp_view_gets_no_whatsapp_data(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.view']));

        $res = $this->getJson("/api/clinic/appointments/{$this->appointment->id}/detail")->assertOk();

        $this->assertSame(0, $res->json('data.communication.whatsapp.count'));
        $this->assertSame([], $res->json('data.communication.whatsapp.recent'));
    }

    public function test_user_with_whatsapp_view_gets_whatsapp_data(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.view', 'whatsapp.view']));

        $res = $this->getJson("/api/clinic/appointments/{$this->appointment->id}/detail")->assertOk();

        $this->assertSame(1, $res->json('data.communication.whatsapp.count'));
        $recent = $res->json('data.communication.whatsapp.recent');
        $this->assertCount(1, $recent);
        $this->assertSame('919876543210', $recent[0]['to_phone']);
    }

    public function test_doctor_role_has_no_whatsapp_view_by_default_and_gets_no_whatsapp_data(): void
    {
        $doctorUser = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Dr House',
            'email' => Str::random(8).'@x.test',
            'password' => 'x',
            'role' => 'doctor',
            'status' => 'active',
        ]);
        $doctorUser->syncRoles(['doctor']);
        $this->doctor->update(['user_id' => $doctorUser->id]);
        Sanctum::actingAs($doctorUser);

        $res = $this->getJson("/api/clinic/appointments/{$this->appointment->id}/detail")->assertOk();

        $this->assertSame(0, $res->json('data.communication.whatsapp.count'));
        $this->assertSame([], $res->json('data.communication.whatsapp.recent'));
    }
}
