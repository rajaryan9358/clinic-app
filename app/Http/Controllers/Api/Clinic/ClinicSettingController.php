<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\ClinicSetting;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class ClinicSettingController extends BaseClinicCrudController
{
    protected string $modelClass = ClinicSetting::class;
    protected array $searchable = [];
    protected array $filterable = [];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with(['clinic:id,name']);
    }

    public function index(Request $request)
    {
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);
        ClinicSetting::query()->firstOrCreate(['clinic_id' => $clinicId], ['clinic_id' => $clinicId]);

        return parent::index($request);
    }

    public function store(Request $request)
    {
        $clinicId = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;
        $clinicId = (int) $clinicId;

        $data = $request->all();
        $data['clinic_id'] = $clinicId;

        $model = ClinicSetting::query()->updateOrCreate(
            ['clinic_id' => $clinicId],
            $data
        );

        return $this->success(
            $model->wasRecentlyCreated ? 'Record created successfully' : 'Record updated successfully',
            $model,
            $model->wasRecentlyCreated ? 201 : 200
        );
    }

    public function destroy(int $id)
    {
        return $this->error('Clinic settings cannot be deleted directly', null, 403);
    }
}
