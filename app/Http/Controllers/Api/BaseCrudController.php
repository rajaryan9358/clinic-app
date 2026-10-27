<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Http\Requests\StatusChangeRequest;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

abstract class BaseCrudController extends Controller
{
    use ApiResponse;

    protected string $modelClass;

    protected array $searchable = [];

    protected array $filterable = [];

    protected string $defaultSort = 'id';

    /** Allowed values for changeStatus/block/unblock; empty means no extra check. */
    protected array $statuses = [];

    private static array $columnListingCache = [];

    /** Validation rules for store/update; empty means the raw payload is persisted. */
    protected function rules(Request $request, ?Model $model = null): array
    {
        return [];
    }

    protected function validatedPayload(Request $request, ?Model $model = null): array
    {
        $rules = $this->rules($request, $model);

        return $rules === [] ? $request->all() : $request->validate($rules);
    }

    protected function applySort(Builder $query, Request $request): Builder
    {
        $sortBy = (string) $request->input('sort_by', $this->defaultSort);
        if (! in_array($sortBy, $this->sortableColumns($query), true)) {
            $sortBy = $this->defaultSort;
        }

        $sortDir = strtolower((string) $request->input('sort_dir', 'desc'));
        if (! in_array($sortDir, ['asc', 'desc'], true)) {
            $sortDir = 'desc';
        }

        return $query->orderBy($sortBy, $sortDir);
    }

    private function sortableColumns(Builder $query): array
    {
        $model = $query->getModel();
        $columns = $this->tableColumns($query);

        // Sorting by a hidden attribute (password, OTP hashes, ...) would leak its ordering.
        return array_values(array_diff($columns, $model->getHidden()));
    }

    private function tableColumns(Builder $query): array
    {
        $table = $query->getModel()->getTable();

        return self::$columnListingCache[$table] ??= Schema::getColumnListing($table);
    }

    protected function baseQuery(Request $request): Builder
    {
        return ($this->modelClass)::query();
    }

    public function index(Request $request)
    {
        $query = $this->baseQuery($request);

        if ($search = $request->string('search')->toString()) {
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

        if ($request->boolean('with_trashed') && $this->supportsSoftDeletes()) {
            $query->withTrashed();
        }

        $this->applySort($query, $request);

        $result = $query->paginate((int) $request->input('per_page', 15));

        return $this->paginated('Records fetched successfully', $result);
    }

    public function store(Request $request)
    {
        $model = ($this->modelClass)::create($this->validatedPayload($request));

        return $this->success('Record created successfully', $model, 201);
    }

    public function show(int $id)
    {
        $model = $this->findModel($id);

        return $this->success('Record fetched successfully', $model);
    }

    public function update(Request $request, int $id)
    {
        $model = $this->findModel($id);
        $model->update($this->validatedPayload($request, $model));

        return $this->success('Record updated successfully', $model->refresh());
    }

    public function destroy(int $id)
    {
        $model = $this->findModel($id);
        $model->delete();

        return $this->success('Record deleted successfully');
    }

    public function restore(int $id)
    {
        if (! $this->supportsSoftDeletes()) {
            return $this->error('Restore is not supported for this module', null, 422);
        }

        /** @var Model $model */
        $model = ($this->modelClass)::withTrashed()->findOrFail($id);
        $model->restore();

        return $this->success('Record restored successfully', $model->refresh());
    }

    public function changeStatus(StatusChangeRequest $request, int $id)
    {
        $model = $this->findModel($id);
        $status = $request->validated('status');

        if (! in_array('status', $this->tableColumns($model->newQuery()), true)) {
            return $this->error('Status field not available on model', null, 422);
        }

        if ($this->statuses !== [] && ! in_array($status, $this->statuses, true)) {
            throw ValidationException::withMessages(['status' => ['The selected status is invalid.']]);
        }

        $model->update(['status' => $status]);

        return $this->success('Status updated successfully', $model->refresh());
    }

    public function block(int $id)
    {
        return $this->toggleBlock($id, 'blocked');
    }

    public function unblock(int $id)
    {
        return $this->toggleBlock($id, 'active');
    }

    protected function toggleBlock(int $id, string $status)
    {
        $model = $this->findModel($id);

        if (! isset($model->status)) {
            return $this->error('Status field not available on model', null, 422);
        }

        if ($this->statuses !== [] && ! in_array($status, $this->statuses, true)) {
            return $this->error("Status '{$status}' is not supported for this module", null, 422);
        }

        $model->update(['status' => $status]);

        return $this->success('Record status updated', $model->refresh());
    }

    protected function findModel(int $id): Model
    {
        if ($this->supportsSoftDeletes()) {
            return ($this->modelClass)::withTrashed()->findOrFail($id);
        }

        return ($this->modelClass)::findOrFail($id);
    }

    protected function supportsSoftDeletes(): bool
    {
        return in_array(SoftDeletes::class, class_uses_recursive($this->modelClass), true);
    }
}
