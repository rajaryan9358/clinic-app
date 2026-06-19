<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class SuperAdminSeeder extends Seeder
{
    public function run(): void
    {
        $email = config('saas.super_admin_email');
        $password = config('saas.super_admin_password');

        if (!$email || !$password) {
            if ($this->command) {
                $this->command->warn('Skipping SuperAdminSeeder: set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to seed a super admin user.');
            }
            return;
        }

        $user = User::firstOrCreate(
            ['email' => $email],
            [
                'uuid' => (string) Str::uuid(),
                'full_name' => 'Super Admin',
                'password' => Hash::make($password),
                'role' => 'super_admin',
                'status' => 'active',
                'login_type' => 'password',
                'email_verified_at' => now(),
            ]
        );

        $user->syncRoles(['super_admin']);
    }
}
