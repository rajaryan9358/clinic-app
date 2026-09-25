<?php

namespace Database\Seeders;

use App\Models\Plan;
use App\Services\ClinicCreationService;
use Illuminate\Database\Seeder;

class DemoClinicSeeder extends Seeder
{
    public function run(): void
    {
        /** @var ClinicCreationService $service */
        $service = app(ClinicCreationService::class);

        $starter = Plan::firstOrCreate(
            ['name' => 'Starter'],
            [
                'monthly_price' => 99900,
                'yearly_price' => 999000,
                'max_doctors' => 2,
                'max_staff' => 3,
                'max_appointments_per_month' => 300,
                'sort_order' => 1,
            ]
        );

        Plan::firstOrCreate(
            ['name' => 'Pro'],
            [
                'monthly_price' => 249900,
                'yearly_price' => 2499000,
                'max_doctors' => 10,
                'max_staff' => 15,
                'max_appointments_per_month' => null,
                'sort_order' => 2,
            ]
        );

        $service->create([
            'name' => 'Demo Clinic',
            'slug' => 'demo-clinic',
            'status' => 'active',
            'owner_name' => 'Demo Owner',
            'owner_email' => 'owner@demo-clinic.test',
            'city' => 'Bengaluru',
            'state' => 'Karnataka',
            'clinic_admin' => [
                'full_name' => 'Clinic Admin',
                'email' => 'clinic-admin@demo-clinic.test',
                'password' => 'Admin@12345',
            ],
            'subscription' => [
                'plan_id' => $starter->id,
                'billing_cycle' => 'monthly',
                'start_mode' => 'trial',
                'trial_days' => 14,
            ],
        ]);
    }
}
