<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Requests\StoreClinicRequest;
use App\Http\Requests\UpdateClinicRequest;
use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\ClinicSubscription;
use App\Models\Doctor;
use App\Models\Service;
use App\Models\User;
use App\Services\ClinicCreationService;
use Illuminate\Http\Request;

class ClinicController extends BaseCrudController
{
    protected string $modelClass = Clinic::class;

    protected array $searchable = ['name', 'slug', 'owner_name', 'owner_email'];

    protected array $filterable = ['status'];

    public function block(int $id)
    {
        return $this->toggleBlock($id, 'suspended');
    }

    public function unblock(int $id)
    {
        return $this->toggleBlock($id, 'active');
    }

    public function __construct(private readonly ClinicCreationService $clinicCreationService) {}

    public function store(Request $request)
    {
        $data = validator($request->all(), (new StoreClinicRequest())->rules())->validate();
        $clinic = $this->clinicCreationService->create($data, $request->user()?->id);

        return $this->success('Clinic created successfully', $clinic, 201);
    }

    public function overview(int $id)
    {
        $clinic = $this->findModel($id);

        $admins = User::query()
            ->where('clinic_id', $clinic->id)
            ->where('role', 'clinic_admin')
            ->orderBy('id')
            ->get(['id', 'full_name', 'email', 'phone', 'status', 'last_login_at']);

        return $this->success('Clinic overview fetched', [
            'clinic' => $clinic,
            'settings' => ClinicSetting::query()->where('clinic_id', $clinic->id)->first(),
            'subscription' => ClinicSubscription::query()->with('plan')->where('clinic_id', $clinic->id)->first(),
            'admins' => $admins,
            'counts' => [
                'doctors' => Doctor::query()->where('clinic_id', $clinic->id)->count(),
                'staff' => User::query()->where('clinic_id', $clinic->id)->where('role', '!=', 'doctor')->count(),
                'services' => Service::query()->where('clinic_id', $clinic->id)->count(),
            ],
        ]);
    }

    public function update(Request $request, int $id)
    {
        $clinic = $this->findModel($id);
        $data = validator($request->all(), UpdateClinicRequest::rulesFor($id))->validate();
        $clinic->update($data);

        return $this->success('Clinic updated successfully', $clinic->refresh());
    }
}
