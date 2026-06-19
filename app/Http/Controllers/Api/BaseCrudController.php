<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Http\Requests\StatusChangeRequest;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\SoftDeletes;

abstract class BaseCrudController extends Controller
{
    use ApiResponse;

    protected string $modelClass;

    protected array $searchable = [];

    protected array $filterable = [];

    protected string $defaultSort = 'id';

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

        $sortBy = $request->input('sort_by', $this->defaultSort);
        $sortDir = $request->input('sort_dir', 'desc');
        $query->orderBy($sortBy, $sortDir);

        $result = $query->paginate((int) $request->input('per_page', 15));

        return $this->paginated('Records fetched successfully', $result);
    }

    public function store(Request $request)
    {
        $model = ($this->modelClass)::create($request->all());

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
        $model->update($request->all());

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
        $model->update(['status' => $request->validated('status')]);

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
