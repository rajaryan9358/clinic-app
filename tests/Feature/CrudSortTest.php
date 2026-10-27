<?php

namespace Tests\Feature;

use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\Feature\Patients\PatientTestHelpers;
use Tests\TestCase;

/** BaseCrudController::applySort() must not sort by a model's $hidden attributes. */
class CrudSortTest extends TestCase
{
    use RefreshDatabase, PatientTestHelpers;

    #[Test]
    public function users_list_ignores_sort_by_hidden_columns(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);
        $clinic = $this->makeClinic('Sunrise');
        $admin = $this->makeUser($clinic);
        $staff = collect(range(1, 3))->map(fn () => $this->makeUser($clinic, 'receptionist'));

        // Password order deliberately differs from id order.
        foreach ([$admin, ...$staff] as $i => $user) {
            DB::table('users')->where('id', $user->id)->update(['password' => ['m', 'z', 'a', 'q'][$i], 'remember_token' => ['m', 'z', 'a', 'q'][$i]]);
        }
        Sanctum::actingAs($admin);

        $ids = fn (string $query) => collect($this->getJson('/api/clinic/users'.$query)->assertOk()->json('data'))->pluck('id')->all();

        $default = $ids('');
        $this->assertCount(4, $default);
        $this->assertSame($default, $ids('?sort_by=password'));
        $this->assertSame($default, $ids('?sort_by=remember_token'));
        $this->assertSame($ids('?sort_by=id&sort_dir=asc'), $ids('?sort_by=password&sort_dir=asc'));
    }
}
