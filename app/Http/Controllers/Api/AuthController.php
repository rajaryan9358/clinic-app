<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    use ApiResponse;

    public function login(Request $request)
    {
        $validated = $request->validate([
            'email' => ['nullable', 'email', 'required_without:phone'],
            'phone' => ['nullable', 'string', 'required_without:email'],
            'password' => ['required', 'string'],
        ]);

        $query = User::query()->where('status', 'active');

        if (! empty($validated['email'])) {
            $query->where('email', $validated['email']);
        }

        if (! empty($validated['phone'])) {
            $query->where('phone', $validated['phone']);
        }

        $user = $query->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            return $this->error('Invalid credentials', null, 401);
        }

        $user->update([
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
        ]);

        AuditLog::create([
            'clinic_id' => $user->clinic_id,
            'user_id' => $user->id,
            'module' => 'auth',
            'entity_type' => User::class,
            'entity_id' => $user->id,
            'action' => 'login',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        $token = $user->createToken('api-token')->plainTextToken;

        return $this->success('Login successful', [
            'token' => $token,
            'user' => $user,
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()?->currentAccessToken()?->delete();

        return $this->success('Logout successful');
    }
}
