<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\ClinicSetting;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class ClinicSettingController extends BaseCrudController
{
    protected string $modelClass = ClinicSetting::class;
    protected array $searchable = [];
    protected array $filterable = ['clinic_id'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with(['clinic:id,name']);
    }

    public function store(Request $request)
    {
        $clinicId = $request->input('clinic_id');
        if (! $clinicId) {
            return $this->error('clinic_id is required', null, 422);
        }

        $request->validate([
            'walkin_enabled' => ['sometimes', 'boolean'],
            'token_system_enabled' => ['sometimes', 'boolean'],
            'max_advance_booking_days' => ['sometimes', 'integer', 'min:0', 'max:365'],
            'min_booking_notice_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
        ]);

        $data = $request->all();
        $data['clinic_id'] = (int) $clinicId;

        $model = ClinicSetting::query()->updateOrCreate(
            ['clinic_id' => (int) $clinicId],
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
