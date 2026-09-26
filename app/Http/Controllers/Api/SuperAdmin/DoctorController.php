<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Requests\StoreDoctorRequest;
use App\Models\Doctor;
use App\Services\DoctorManagementService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class DoctorController extends BaseCrudController
{
    protected string $modelClass = Doctor::class;

    protected array $searchable = ['full_name', 'specialization', 'phone', 'email'];

    protected array $filterable = ['clinic_id', 'status', 'specialization'];

    public function __construct(private readonly DoctorManagementService $doctorManagementService) {}

    public function index(Request $request)
    {
        $query = $this->baseQuery($request);

        $search = trim($request->string('search')->toString());
        if ($search !== '') {
            $query->where(function (Builder $builder) use ($search) {
                foreach ($this->searchable as $column) {
                    $builder->orWhere($column, 'like', "%{$search}%");
                }
            });
        }

        foreach ($this->filterable as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->input($filter));
            }
        }

        $sortBy = $request->input('sort_by', $this->defaultSort);
        $sortDir = $request->input('sort_dir', 'desc');
        $query->orderBy($sortBy, $sortDir);

        $result = $query->paginate((int) $request->input('per_page', 15));

        return $this->paginated('Records fetched successfully', $result);
    }

    public function store(Request $request)
    {
        $data = validator($request->all(), (new StoreDoctorRequest())->rules())->validate();
        $doctor = $this->doctorManagementService->create($data, $request->user());

        return $this->success('Doctor created successfully', $doctor, 201);
    }
}
