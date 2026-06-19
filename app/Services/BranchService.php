<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\BranchSetting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BranchService
{
    public function create(array $data): Branch
    {
        return DB::transaction(function () use ($data) {
            if (! empty($data['is_main_branch'])) {
                Branch::where('clinic_id', $data['clinic_id'])->update(['is_main_branch' => false]);
            }

            $branch = Branch::create([
                ...$data,
                'uuid' => (string) Str::uuid(),
            ]);

            BranchSetting::firstOrCreate(
                ['branch_id' => $branch->id],
                ['clinic_id' => $branch->clinic_id, 'branch_id' => $branch->id]
            );

            return $branch;
        });
    }

    public function update(Branch $branch, array $data): Branch
    {
        return DB::transaction(function () use ($branch, $data) {
            if (($data['is_main_branch'] ?? false) === true) {
                Branch::where('clinic_id', $branch->clinic_id)->update(['is_main_branch' => false]);
            }

            $branch->update($data);

            return $branch->refresh();
        });
    }
}
