<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Domain;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DomainController extends BaseClinicCrudController
{
    protected string $modelClass = Domain::class;
    protected array $searchable = ['host', 'type'];
    protected array $filterable = ['status', 'type'];
    protected array $statuses = ['active', 'inactive'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'host' => [...$required, 'string', 'max:255', Rule::unique('domains', 'host')->ignore($model?->getKey())],
            'type' => [...$required, 'in:booking,portal,website,custom'],
            'is_primary' => ['sometimes', 'boolean'],
            'ssl_status' => ['nullable', 'in:pending,active,failed'],
            'status' => ['sometimes', 'in:active,inactive'],
        ];
    }
}
