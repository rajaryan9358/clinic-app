<?php

namespace Tests\Feature\Portal;

use App\Support\Portal\PortalProfiles;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Profile resolution for a portal account: which clinics' account-holder
 * rows a phone number reaches, and how many queries that costs.
 */
class PortalProfilesTest extends TestCase
{
    use PortalTestHelpers, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    public function test_account_holders_for_phone_reads_portal_settings_once_for_many_clinics(): void
    {
        foreach (range(1, 5) as $i) {
            $clinic = $this->makeClinic(['portal_enabled' => true]);
            $this->makePatient($clinic, ['phone' => '9876500011']);
        }

        $queries = 0;
        DB::listen(function ($query) use (&$queries) {
            if (str_contains($query->sql, 'clinic_settings')) {
                $queries++;
            }
        });

        $holders = PortalProfiles::accountHoldersForPhone('919876500011');

        $this->assertCount(5, $holders);
        $this->assertSame(1, $queries, 'clinic_settings should be read once, not once per candidate patient');
    }

    public function test_account_holders_for_phone_excludes_clinics_with_the_portal_disabled(): void
    {
        $on = $this->makeClinic(['portal_enabled' => true]);
        $off = $this->makeClinic(['portal_enabled' => false]);
        $noRow = $this->makeClinic();

        $this->makePatient($on, ['phone' => '9876500022']);
        $this->makePatient($off, ['phone' => '9876500022']);
        $this->makePatient($noRow, ['phone' => '9876500022']);

        $clinicIds = PortalProfiles::accountHoldersForPhone('919876500022')->pluck('clinic_id')->all();

        sort($clinicIds);
        $expected = [$on->id, $noRow->id];
        sort($expected);

        $this->assertSame($expected, $clinicIds, 'a missing settings row means the portal is on; portal_enabled=false excludes the clinic');
    }
}
