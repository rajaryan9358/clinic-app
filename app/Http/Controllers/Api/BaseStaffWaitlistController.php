<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Concerns\WaitlistResponses;
use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\WaitlistEntry;
use App\Services\Waitlist\WaitlistService;
use App\Support\Waitlist\StaffWaitlistPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Staff waitlist endpoints shared by the clinic and super-admin APIs:
 * list (filters doctor/date/status, default the active statuses), add a
 * patient for a taken slot (source `staff` — no portal window/notice) and
 * remove (an offered entry passes the slot to the next in line). Rules
 * live in WaitlistService; subclasses only say which clinic a request is
 * scoped to. Entries outside that scope — another clinic, or another
 * doctor for doctor-scoped roles (`active_doctor_id`) — are a 404.
 */
abstract class BaseStaffWaitlistController extends Controller
{
    use ApiResponse;
    use WaitlistResponses;

    private const STATUSES = ['waiting', 'offered', 'booked', 'declined', 'expired', 'removed'];

    public function __construct(protected readonly WaitlistService $waitlist) {}

    /** The clinic this request is limited to; null = every clinic (super admin without a filter). */
    abstract protected function clinicId(Request $request): ?int;

    public function index(Request $request)
    {
        $data = $request->validate([
            'doctor_id' => ['nullable', 'integer'],
            'date' => ['nullable', 'date_format:Y-m-d'],
            'status' => ['nullable', Rule::in([...self::STATUSES, 'active', 'all'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $status = $data['status'] ?? 'active';

        $result = $this->entries($request)
            ->with(['patient' => fn ($q) => $q->withTrashed(), 'doctor'])
            ->when(isset($data['doctor_id']), fn (Builder $q) => $q->where('doctor_id', (int) $data['doctor_id']))
            ->when(isset($data['date']), fn (Builder $q) => $q->whereDate('appointment_date', $data['date']))
            ->when($status === 'active', fn (Builder $q) => $q->active())
            ->when(in_array($status, self::STATUSES, true), fn (Builder $q) => $q->where('status', $status))
            ->orderBy('appointment_date')
            ->orderBy('start_time')
            ->orderBy('id')
            ->paginate((int) ($data['per_page'] ?? 20));

        $result->setCollection(collect(StaffWaitlistPresenter::items($result->getCollection())));

        return $this->paginated('Waitlist fetched successfully', $result);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'patient_id' => ['required', 'integer'],
            'doctor_id' => ['required', 'integer'],
            'appointment_date' => ['required', 'date_format:Y-m-d'],
            'start_time' => ['required', 'string'],
        ]);

        $clinicId = $this->clinicId($request);
        if ($clinicId === null) {
            throw ValidationException::withMessages(['clinic_id' => 'The clinic id field is required.']);
        }

        $patient = Patient::query()->forClinic($clinicId)->find((int) $data['patient_id']);
        $doctor = Doctor::query()->forClinic($clinicId)->find((int) $data['doctor_id']);
        if (! $patient || ! $doctor) {
            abort(404);
        }

        try {
            $entry = $this->waitlist->join(
                $patient,
                $doctor->id,
                (string) $data['appointment_date'],
                (string) $data['start_time'],
                'staff',
                $request->user()?->id,
            );
        } catch (ConflictHttpException|ValidationException $e) {
            return $this->waitlistError($e);
        }

        return $this->success('Added to the waitlist.', StaffWaitlistPresenter::item($entry->load(['patient', 'doctor'])), 201);
    }

    public function destroy(Request $request, int $id)
    {
        $entry = $this->entries($request)->find($id);
        if (! $entry) {
            abort(404);
        }

        $this->waitlist->remove($entry);

        return $this->success('Removed from the waitlist.', StaffWaitlistPresenter::item(
            $entry->refresh()->load(['patient' => fn ($q) => $q->withTrashed(), 'doctor']),
        ));
    }

    /** Entries this request may see: its clinic (if any) and active doctor (if doctor-scoped). */
    private function entries(Request $request): Builder
    {
        $clinicId = $this->clinicId($request);
        $activeDoctorId = $request->attributes->get('active_doctor_id');

        return WaitlistEntry::query()
            ->when($clinicId !== null, fn (Builder $q) => $q->forClinic($clinicId))
            ->when($activeDoctorId, fn (Builder $q) => $q->where('doctor_id', (int) $activeDoctorId));
    }
}
