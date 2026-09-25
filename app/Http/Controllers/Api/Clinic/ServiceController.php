<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Service;
use Illuminate\Http\Request;

class ServiceController extends BaseClinicCrudController
{
    protected string $modelClass = Service::class;
    protected array $searchable = ['name', 'code'];
    protected array $filterable = ['status'];

    public function store(Request $request)
    {
        $data = $request->all();
        $data['clinic_id'] = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;

        $service = Service::create($data);

        return $this->success('Record created successfully', $service, 201);
    }
}
