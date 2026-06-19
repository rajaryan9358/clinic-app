<?php

namespace Database\Seeders;

use App\Services\ClinicCreationService;
use Illuminate\Database\Seeder;

class DemoClinicSeeder extends Seeder
{
    public function run(): void
    {
        /** @var ClinicCreationService $service */
        $service = app(ClinicCreationService::class);

        $service->create([
            'name' => 'Demo Clinic',
            'slug' => 'demo-clinic',
            'status' => 'trial',
            'owner_name' => 'Demo Owner',
            'owner_email' => 'owner@demo-clinic.test',
            'main_branch' => [
                'name' => 'Main Branch',
                'city' => 'Bengaluru',
                'state' => 'Karnataka',
                'status' => 'active',
            ],
            'clinic_admin' => [
                'full_name' => 'Clinic Admin',
                'email' => 'clinic-admin@demo-clinic.test',
                'password' => 'Admin@12345',
            ],
        ]);
    }
}
