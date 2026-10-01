<?php

namespace Tests\Feature\Waitlist;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Patient;
use App\Models\PatientLoginLink;
use App\Models\User;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use App\Services\AppointmentService;
use App\Services\Portal\PortalBookingPolicy;
use App\Services\Waitlist\WaitlistService;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PortalConsent;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Feature\Portal\PortalTestHelpers;
use Tests\TestCase;

/**
 * Task 2 of the waitlist (E3) plan: WaitlistService join/remove rules,
 * offers when a slot frees (portal/staff cancel, staff reschedule-away),
 * and holds blocking other patients in the portal's free slots and
 * booking check. See app/Services/Waitlist/WaitlistService.php,
 * app/Services/AppointmentService.php and
 * app/Services/Portal/PortalBookingPolicy.php.
 *
 * Clock frozen at 2026-10-01 10:15 Asia/Kolkata: the doctor works every
 * day 09:00-12:00 in 30-minute slots, so tomorrow's slots are all inside
 * the portal's window, while today's 10:30 is inside the default
 * 30-minute notice (portal-only) and 09:00 is in the past.
 */
class WaitlistServiceTest extends TestCase
{
    use RefreshDatabase;
    use PortalTestHelpers;

    private FakeWhatsAppGateway $fake;

    private Clinic $clinic;

    private Doctor $doctor;

    private Carbon $now;

    private string $tomorrow;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->now = Carbon::parse('2026-10-01 10:15:00', 'Asia/Kolkata');
        // Freeze in UTC (the app timezone): Carbon parses zone-less DB
        // timestamps in the test-now's zone, so an IST test-now would
        // misread every stored datetime.
        $this->travelTo($this->now->copy()->utc());
        $this->tomorrow = $this->now->copy()->addDay()->toDateString();

        // No clinic_settings row: the waitlist must default to on, 30 minutes.
        $this->clinic = $this->makeClinic();
        $this->doctor = $this->makeDoctorWithSchedule($this->clinic);
    }

    private function makeDoctorWithSchedule(Clinic $clinic): Doctor
    {
        $doctor = Doctor::create([
            'clinic_id' => $clinic->id,
            'full_name' => 'Dr Asha Rao',
            'status' => 'active',
            'slot_duration_minutes' => 30,
        ]);

        for ($day = 0; $day <= 6; $day++) {
            DoctorSchedule::create([
                'clinic_id' => $clinic->id,
                'doctor_id' => $doctor->id,
                'day_of_week' => $day,
                'start_time' => '09:00:00',
                'end_time' => '12:00:00',
                'consultation_mode' => 'in_person',
                'slot_duration_minutes' => 30,
                'is_active' => true,
            ]);
        }

        return $doctor;
    }

    private function consentedPatient(array $attrs = [], ?Clinic $clinic = null): Patient
    {
        $patient = $this->makePatient($clinic ?? $this->clinic, array_merge([
            'phone' => '90000'.random_int(10000, 99999),
            'full_name' => 'Patient '.Str::random(4),
        ], $attrs));
        $patient->forceFill(['consent_given_at' => now(), 'consent_version' => PortalConsent::VERSION])->save();

        return $patient;
    }

    private function appointment(Patient $patient, string $date, string $start, array $overrides = [], ?Doctor $doctor = null): Appointment
    {
        $startAt = Carbon::parse($date.' '.$start);

        return Appointment::create(array_merge([
            'clinic_id' => $patient->clinic_id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => ($doctor ?? $this->doctor)->id,
            'appointment_date' => $date,
            'start_time' => $startAt->format('H:i:s'),
            'end_time' => $startAt->copy()->addMinutes(30)->format('H:i:s'),
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ], $overrides));
    }

    private function receptionist(): User
    {
        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Rita Reception',
            'email' => 'rita-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'receptionist',
            'status' => 'active',
        ]);
        $user->assignRole('receptionist');

        return $user;
    }

    private function service(): WaitlistService
    {
        return app(WaitlistService::class);
    }

    private function join(Patient $patient, string $date, string $start, string $source = 'portal'): WaitlistEntry
    {
        return $this->service()->join($patient, $this->doctor->id, $date, $start, $source);
    }

    /** An entry already holding the slot for $patient (as slotFreed would leave it). */
    private function offeredEntry(Patient $patient, string $date, string $start, int $holdMinutes = 30): WaitlistEntry
    {
        return WaitlistEntry::create([
            'clinic_id' => $patient->clinic_id,
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $date,
            'start_time' => Carbon::parse($start)->format('H:i:s'),
            'end_time' => Carbon::parse($start)->addMinutes(30)->format('H:i:s'),
            'status' => 'offered',
            'source' => 'portal',
            'offered_at' => now(),
            'hold_expires_at' => now()->addMinutes($holdMinutes),
        ]);
    }

    private function assertValidationMessage(string $expected, \Closure $callback): void
    {
        try {
            $callback();
            $this->fail('Expected a ValidationException: '.$expected);
        } catch (ValidationException $e) {
            $this->assertSame($expected, collect($e->errors())->flatten()->first());
        }
    }

    private function assertHttpError(int $status, string $expected, \Closure $callback): void
    {
        try {
            $callback();
            $this->fail('Expected an HttpException: '.$expected);
        } catch (HttpException $e) {
            $this->assertSame($status, $e->getStatusCode());
            $this->assertSame($expected, $e->getMessage());
        }
    }

    private function waitlistMessages(): Builder
    {
        return WhatsappMessage::where('notification_type', 'waitlist_slot_open');
    }

    // --- Join rules -----------------------------------------------------

    public function test_join_creates_waiting_entry_for_a_taken_slot(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();

        $entry = $this->join($patient, $this->tomorrow, '09:00');

        $this->assertSame('waiting', $entry->status);
        $this->assertSame('portal', $entry->source);
        $this->assertSame($this->clinic->id, $entry->clinic_id);
        $this->assertSame($this->tomorrow, $entry->appointment_date->toDateString());
        $this->assertSame('09:00:00', $entry->start_time);
        $this->assertSame('09:30:00', $entry->end_time);
    }

    public function test_join_requires_waitlist_enabled(): void
    {
        $clinic = $this->makeClinic(['waitlist_enabled' => false]);
        $this->doctor = $this->makeDoctorWithSchedule($clinic);
        $this->appointment($this->consentedPatient([], $clinic), $this->tomorrow, '09:00');

        $this->assertValidationMessage('Waitlist is not available at this clinic.',
            fn () => $this->join($this->consentedPatient([], $clinic), $this->tomorrow, '09:00'));
    }

    public function test_join_rejects_a_free_slot(): void
    {
        $this->assertValidationMessage('This slot is free — book it directly.',
            fn () => $this->join($this->consentedPatient(), $this->tomorrow, '09:00'));
        $this->assertSame(0, WaitlistEntry::count());
    }

    public function test_join_allowed_for_a_free_slot_held_for_someone_else(): void
    {
        $this->offeredEntry($this->consentedPatient(), $this->tomorrow, '09:00');

        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        $this->assertSame('waiting', $entry->status);
    }

    public function test_join_duplicate_is_409(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();
        $this->join($patient, $this->tomorrow, '09:00');

        $this->assertHttpError(409, 'Already on the waitlist for this time.',
            fn () => $this->join($patient, $this->tomorrow, '09:00:00', 'staff'));
        $this->assertSame(1, WaitlistEntry::count());
    }

    public function test_join_limit_of_three_counts_staff_entries(): void
    {
        $other = $this->consentedPatient();
        foreach (['09:00', '09:30', '10:00', '10:30'] as $start) {
            $this->appointment($other, $this->tomorrow, $start);
        }
        $patient = $this->consentedPatient();

        $this->join($patient, $this->tomorrow, '09:00', 'portal');
        $this->join($patient, $this->tomorrow, '09:30', 'staff');
        $this->join($patient, $this->tomorrow, '10:00', 'portal');

        $this->assertValidationMessage('You can be on up to 3 waitlists at a time.',
            fn () => $this->join($patient, $this->tomorrow, '10:30', 'staff'));

        // A finished entry no longer counts.
        WaitlistEntry::where('patient_id', $patient->id)->where('start_time', '09:00:00')->update(['status' => 'removed']);
        $this->assertSame('waiting', $this->join($patient, $this->tomorrow, '10:30', 'portal')->status);
    }

    public static function offGridOrPastProvider(): array
    {
        return [
            'portal off grid' => ['portal', 1, '09:10'],
            'staff off grid' => ['staff', 1, '09:10'],
            'portal past' => ['portal', 0, '09:00'],
            'staff past' => ['staff', 0, '09:00'],
            'portal inside notice' => ['portal', 0, '10:30'],
        ];
    }

    #[DataProvider('offGridOrPastProvider')]
    public function test_join_rejects_off_grid_or_past_slots(string $source, int $dayOffset, string $start): void
    {
        $date = $this->now->copy()->addDays($dayOffset)->toDateString();
        $this->appointment($this->consentedPatient(), $date, $start);

        $this->assertValidationMessage('Please choose one of the available times.',
            fn () => $this->join($this->consentedPatient(), $date, $start, $source));
    }

    public function test_join_rejects_patient_who_already_has_the_slot(): void
    {
        $patient = $this->consentedPatient();
        $this->appointment($patient, $this->tomorrow, '09:00');

        foreach (['portal', 'staff'] as $source) {
            $this->assertValidationMessage('This patient already has this slot.',
                fn () => $this->join($patient, $this->tomorrow, '09:00', $source));
        }
    }

    public function test_staff_join_outside_portal_window_is_allowed(): void
    {
        $other = $this->consentedPatient();
        $farDate = $this->now->copy()->addDays(40)->toDateString();
        $today = $this->now->toDateString();
        $this->appointment($other, $farDate, '09:00');
        $this->appointment($other, $today, '10:30');
        $patient = $this->consentedPatient();

        // Beyond max_advance_booking_days (30) and inside the notice window:
        // the portal refuses both, staff can add either.
        $this->assertValidationMessage("Choose a date within the clinic's booking window.",
            fn () => $this->join($patient, $farDate, '09:00', 'portal'));
        $this->assertValidationMessage('Please choose one of the available times.',
            fn () => $this->join($patient, $today, '10:30', 'portal'));

        $this->assertSame('staff', $this->join($patient, $farDate, '09:00', 'staff')->source);
        $this->assertSame('waiting', $this->join($patient, $today, '10:30', 'staff')->status);
    }

    // --- Offers on freed slots -------------------------------------------

    public function test_portal_cancel_offers_oldest_waiting_entry(): void
    {
        $booker = $this->consentedPatient();
        $appointment = $this->appointment($booker, $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        $this->portalPost("/api/portal/appointments/{$appointment->id}/cancel", $this->portalToken($booker), $booker->id)
            ->assertOk();

        $first->refresh();
        $this->assertSame('offered', $first->status);
        $this->assertTrue($first->offered_at->equalTo(now()));
        // No settings row ⇒ 30-minute hold.
        $this->assertTrue($first->hold_expires_at->equalTo(now()->addMinutes(30)));
        $this->assertSame('waiting', $second->fresh()->status);

        $link = PatientLoginLink::findOrFail($first->login_link_id);
        $this->assertSame($first->patient_id, $link->patient_id);
        $this->assertSame("/waitlist/{$first->id}?profile={$first->patient_id}", $link->redirect_path);
        $this->assertTrue($link->expires_at->equalTo($first->hold_expires_at));
        $this->assertNull($link->consumed_at);

        $messages = $this->waitlistMessages()->get();
        $this->assertCount(1, $messages);
        $this->assertSame($first->patient_id, $messages[0]->patient_id);

        $sent = collect($this->fake->sent)->firstWhere('template', 'waitlist_slot_open');
        $button = collect($sent['components'])->firstWhere('type', 'button');
        $this->assertSame($link->token_hash, hash('sha256', $button['parameters'][0]['text']));
    }

    public function test_staff_cancel_offers_the_slot(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'cancelled'])
            ->assertOk();

        $this->assertSame('offered', $entry->fresh()->status);
        $this->assertSame(1, $this->waitlistMessages()->count());
    }

    public function test_staff_reschedule_away_offers_the_old_slot(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/appointments/{$appointment->id}/reschedule", [
            'appointment_date' => $this->tomorrow,
            'start_time' => '11:00',
            'end_time' => '11:30',
        ])->assertOk();

        $this->assertSame('offered', $entry->fresh()->status);
        $this->assertSame(1, $this->waitlistMessages()->count());
    }

    public function test_slot_freed_twice_offers_once(): void
    {
        // Two (staff double-booked) appointments in the same slot: the
        // first cancel leaves it occupied, the second frees it.
        $a = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $b = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        $appointments = app(AppointmentService::class);
        $appointments->changeStatus($a, AppointmentStatus::CANCELLED);
        $this->assertSame('waiting', $first->fresh()->status);

        $appointments->changeStatus($b, AppointmentStatus::CANCELLED);
        $this->assertSame('offered', $first->fresh()->status);

        // A repeat cancel of the same appointment, and a direct second
        // slotFreed (e.g. racing the expiry command), change nothing.
        $appointments->changeStatus($b->fresh(), AppointmentStatus::CANCELLED);
        $this->assertNull($this->service()->slotFreed($this->clinic->id, $this->doctor->id, $this->tomorrow, '09:00'));

        $this->assertSame('offered', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(1, WaitlistEntry::where('status', 'offered')->count());
        $this->assertSame(1, $this->waitlistMessages()->count());
        $this->assertSame(1, PatientLoginLink::whereNotNull('redirect_path')->count());
    }

    public function test_hold_is_capped_at_slot_start(): void
    {
        $today = $this->now->toDateString();
        $appointment = $this->appointment($this->consentedPatient(), $today, '10:30');
        $entry = $this->join($this->consentedPatient(), $today, '10:30', 'staff');

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);

        $entry->refresh();
        $slotStart = Carbon::parse($today.' 10:30:00', 'Asia/Kolkata');
        $this->assertSame('offered', $entry->status);
        $this->assertTrue($entry->hold_expires_at->equalTo($slotStart), 'hold must end at the slot start, not now + 30');
        $this->assertTrue($entry->loginLink->expires_at->equalTo($slotStart));

        $sent = collect($this->fake->sent)->firstWhere('template', 'waitlist_slot_open');
        $body = collect($sent['components'])->firstWhere('type', 'body');
        $this->assertSame('15', $body['parameters'][5]['text']);
    }

    public function test_freed_slot_in_the_past_offers_nothing(): void
    {
        $today = $this->now->toDateString();
        $appointment = $this->appointment($this->consentedPatient(), $today, '10:30');
        $entry = $this->join($this->consentedPatient(), $today, '10:30', 'staff');

        $this->travelTo($this->now->copy()->setTime(10, 30)->utc());
        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED, null, null, true);

        $this->assertSame('waiting', $entry->fresh()->status);
        $this->assertSame(0, $this->waitlistMessages()->count());
    }

    public function test_dependent_offer_goes_to_holder_with_profile_redirect(): void
    {
        $holder = $this->consentedPatient(['phone' => '9123456789', 'full_name' => 'Asha Kumar']);
        $dependent = $this->consentedPatient([
            'phone' => '9555555555',
            'full_name' => 'Baby Kumar',
            'managed_by_patient_id' => $holder->id,
        ]);
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($dependent, $this->tomorrow, '09:00');

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);

        $entry->refresh();
        $this->assertSame('offered', $entry->status);

        $link = $entry->loginLink;
        $this->assertSame($holder->id, $link->patient_id);
        $this->assertSame("/waitlist/{$entry->id}?profile={$dependent->id}", $link->redirect_path);

        $message = $this->waitlistMessages()->sole();
        $this->assertSame($dependent->id, $message->patient_id);
        $this->assertSame('919123456789', $message->to_phone);
    }

    public function test_cancel_with_nobody_waiting_sends_no_offer(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);

        $this->assertSame(0, $this->waitlistMessages()->count());
        $this->assertSame(0, PatientLoginLink::count());
    }

    public function test_slot_freed_does_nothing_when_waitlist_disabled(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'waitlist_enabled' => false]);

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);

        $this->assertSame('waiting', $entry->fresh()->status);
        $this->assertSame(0, $this->waitlistMessages()->count());
    }

    public function test_slot_freed_uses_clinic_hold_minutes(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'waitlist_hold_minutes' => 45]);
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00', 'staff');

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);

        $this->assertTrue($entry->fresh()->hold_expires_at->equalTo(now()->addMinutes(45)));
    }

    public function test_slot_freed_works_without_an_authenticated_user(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $appointment->update(['status' => 'cancelled']);

        $this->assertNull(auth()->user());
        $offered = $this->service()->slotFreed($this->clinic->id, $this->doctor->id, $this->tomorrow, '09:00:00');

        $this->assertNotNull($offered);
        $this->assertSame($entry->id, $offered->id);
        $this->assertSame('offered', $offered->status);
        $this->assertNull($offered->loginLink->created_by_user_id);
        $this->assertSame(1, $this->waitlistMessages()->count());
    }

    // --- Holds block others ----------------------------------------------

    public function test_held_slot_is_hidden_from_free_slots_for_others_only(): void
    {
        $heldFor = $this->consentedPatient();
        $this->offeredEntry($heldFor, $this->tomorrow, '09:00');
        $policy = app(PortalBookingPolicy::class);

        $forOther = array_column($policy->freeSlots($this->clinic->id, $this->doctor->id, $this->tomorrow, null, $this->consentedPatient()->id), 'start_time');
        $forHolder = array_column($policy->freeSlots($this->clinic->id, $this->doctor->id, $this->tomorrow, null, $heldFor->id), 'start_time');

        $this->assertNotContains('09:00', $forOther);
        $this->assertContains('09:30', $forOther);
        $this->assertContains('09:00', $forHolder);

        // An expired hold no longer blocks anyone.
        $this->travel(31)->minutes();
        $forOther = array_column(app(PortalBookingPolicy::class)->freeSlots($this->clinic->id, $this->doctor->id, $this->tomorrow, null, $this->consentedPatient()->id), 'start_time');
        $this->assertContains('09:00', $forOther);
    }

    public function test_portal_booking_of_slot_held_for_another_patient_is_409(): void
    {
        $this->offeredEntry($this->consentedPatient(), $this->tomorrow, '09:00');
        $other = $this->consentedPatient();

        $response = $this->portalPost('/api/portal/appointments', $this->portalToken($other), $other->id, [
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
        ]);

        $response->assertStatus(409);
        $this->assertSame('That slot was just taken. Please pick another.', $response->json('message'));
        $this->assertSame(0, Appointment::count());
    }

    public function test_portal_reschedule_into_slot_held_for_another_patient_is_409(): void
    {
        $this->offeredEntry($this->consentedPatient(), $this->tomorrow, '09:00');
        $other = $this->consentedPatient();
        $appointment = $this->appointment($other, $this->tomorrow, '11:00', ['status' => 'pending']);

        $response = $this->portalPost("/api/portal/appointments/{$appointment->id}/reschedule", $this->portalToken($other), $other->id, [
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
        ]);

        $response->assertStatus(409);
        $this->assertSame('11:00:00', $appointment->fresh()->start_time);
    }

    public function test_staff_create_of_held_slot_succeeds(): void
    {
        $this->offeredEntry($this->consentedPatient(), $this->tomorrow, '09:00');

        Sanctum::actingAs($this->receptionist());
        $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->consentedPatient()->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ])->assertCreated();
    }

    public function test_taken_slots_lists_booked_and_held_for_others_excluding_joined(): void
    {
        $patient = $this->consentedPatient();
        $other = $this->consentedPatient();
        $this->appointment($other, $this->tomorrow, '09:00');
        $this->appointment($other, $this->tomorrow, '09:30');
        $this->appointment($patient, $this->tomorrow, '11:30');
        $this->offeredEntry($other, $this->tomorrow, '10:00');
        $this->offeredEntry($patient, $this->tomorrow, '10:30');
        $this->join($patient, $this->tomorrow, '09:30');

        $taken = app(PortalBookingPolicy::class)->takenSlots($this->clinic->id, $this->doctor->id, $this->tomorrow, $patient->id);

        // 09:00 booked, 10:00 held for someone else; 09:30 already joined,
        // 10:30 held for P (free to P), 11:30 is P's own visit.
        $this->assertSame([
            ['start_time' => '09:00', 'end_time' => '09:30'],
            ['start_time' => '10:00', 'end_time' => '10:30'],
        ], $taken);
    }

    public function test_taken_slots_respects_the_notice_window(): void
    {
        $today = $this->now->toDateString();
        $other = $this->consentedPatient();
        $this->appointment($other, $today, '10:30');
        $this->appointment($other, $today, '11:00');

        $taken = app(PortalBookingPolicy::class)->takenSlots($this->clinic->id, $this->doctor->id, $today, $this->consentedPatient()->id);

        $this->assertSame([['start_time' => '11:00', 'end_time' => '11:30']], $taken);
    }

    // --- Remove ------------------------------------------------------------

    public function test_remove_offered_entry_offers_the_next(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);
        $this->assertSame('offered', $first->fresh()->status);

        $this->service()->remove($first->fresh());

        $this->assertSame('removed', $first->fresh()->status);
        $this->assertSame('offered', $second->fresh()->status);
        $this->assertSame(2, $this->waitlistMessages()->count());
    }

    public function test_remove_waiting_entry_offers_nothing(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        $this->service()->remove($first);

        $this->assertSame('removed', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(0, $this->waitlistMessages()->count());
    }
}
