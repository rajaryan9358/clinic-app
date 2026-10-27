<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Service;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

class ServiceController extends BaseClinicCrudController
{
    protected string $modelClass = Service::class;
    protected array $searchable = ['name', 'code'];
    protected array $filterable = ['status'];
    protected array $statuses = ['active', 'inactive'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'name' => [...$required, 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'duration_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'fee' => ['nullable', 'numeric', 'min:0'],
            'image_url' => ['nullable', 'string', 'max:2048'],
            'status' => ['sometimes', 'in:active,inactive'],
        ];
    }
}
