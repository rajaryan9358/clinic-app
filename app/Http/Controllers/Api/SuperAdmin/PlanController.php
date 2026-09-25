<?php
// app/Http/Controllers/Api/SuperAdmin/PlanController.php
namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Plan;
use Illuminate\Http\Request;

class PlanController
{
    use ApiResponse;

    private function rules(bool $partial): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return [
            'name' => [$req, 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:2000'],
            'monthly_price' => [$req, 'integer', 'min:100'],
            'yearly_price' => ['nullable', 'integer', 'min:100'],
            'max_doctors' => ['nullable', 'integer', 'min:1'],
            'max_staff' => ['nullable', 'integer', 'min:1'],
            'max_appointments_per_month' => ['nullable', 'integer', 'min:1'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function index(Request $request)
    {
        $plans = Plan::query()
            ->withCount('subscriptions as subscribers_count')
            ->when($request->boolean('active'), fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')->orderBy('id')
            ->get();

        return $this->success('Plans fetched', $plans);
    }

    public function store(Request $request)
    {
        $plan = Plan::create($request->validate($this->rules(false)));

        return $this->success('Plan created', $plan, 201);
    }

    public function update(Request $request, int $id)
    {
        $plan = Plan::findOrFail($id);
        $data = $request->validate($this->rules(true));

        if (array_key_exists('monthly_price', $data) && (int) $data['monthly_price'] !== (int) $plan->monthly_price) {
            $data['razorpay_plan_id_monthly'] = null;
        }
        if (array_key_exists('yearly_price', $data) && $data['yearly_price'] !== $plan->yearly_price) {
            $data['razorpay_plan_id_yearly'] = null;
        }
        $plan->update($data);

        return $this->success('Plan updated', $plan->refresh());
    }

    public function destroy(int $id)
    {
        $plan = Plan::findOrFail($id);
        if ($plan->subscriptions()->exists()) {
            return $this->error('This plan has clinics on it. Deactivate it instead.', ['plan' => ['in use']], 422);
        }
        $plan->delete();

        return $this->success('Plan deleted', null);
    }
}
