<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class NoBranchSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_branch_tables_do_not_exist(): void
    {
        foreach (['branches', 'branch_settings', 'user_branch_map', 'doctor_branch_map', 'branch_service_map'] as $table) {
            $this->assertFalse(Schema::hasTable($table), "{$table} should not exist");
        }
    }

    public function test_no_table_has_a_branch_id_column(): void
    {
        $tables = array_map(fn ($t) => $t['name'], Schema::getTables());
        foreach ($tables as $table) {
            $this->assertFalse(Schema::hasColumn($table, 'branch_id'), "{$table}.branch_id should not exist");
        }
    }

    public function test_clinics_have_location_fields_and_settings_have_booking_fields(): void
    {
        $this->assertTrue(Schema::hasColumns('clinics', [
            'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'latitude', 'longitude', 'phone', 'email',
        ]));
        $this->assertTrue(Schema::hasColumns('clinic_settings', [
            'walkin_enabled', 'token_system_enabled', 'max_advance_booking_days', 'min_booking_notice_minutes',
        ]));
    }
}
