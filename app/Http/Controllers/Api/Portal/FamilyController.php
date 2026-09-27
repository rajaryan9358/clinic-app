<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Support\Portal\PortalAccount;
use App\Support\PortalConsent;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Family/dependent profiles for the signed-in portal account.
 *
 * Both actions operate on the *account* (`portal_account`, the token
 * owner), not the acting profile (`portal_patient`): the family list is
 * the whole account's roster, and a newly added dependent is always
 * managed by the account holder even when the request was made while
 * acting as an existing dependent.
 */
class FamilyController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        /** @var Patient $account */
        $account = $request->attributes->get('portal_account');

        return $this->success('OK', PortalAccount::profiles($account));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'dob' => ['nullable', 'date'],
            'gender' => ['nullable', 'in:male,female,other'],
        ]);

        /** @var Patient $account */
        $account = $request->attributes->get('portal_account');

        [$firstName, $lastName] = self::splitName($data['full_name']);

        $dependent = Patient::create([
            'clinic_id' => $account->clinic_id,
            'uuid' => (string) Str::uuid(),
            'first_name' => $firstName,
            'last_name' => $lastName,
            'full_name' => $data['full_name'],
            'dob' => $data['dob'] ?? null,
            'gender' => $data['gender'] ?? null,
            'phone' => $account->phone,
            'managed_by_patient_id' => $account->id,
        ]);

        return $this->success('Profile added.', [
            'id' => $dependent->id,
            'full_name' => $dependent->full_name,
            'dob' => $dependent->dob?->toDateString(),
            'gender' => $dependent->gender,
            'relation' => 'dependent',
            'consent_current' => $dependent->consent_version === PortalConsent::VERSION,
        ], 201);
    }

    /**
     * @return array{0: string, 1: ?string}
     */
    private static function splitName(string $fullName): array
    {
        $parts = preg_split('/\s+/', trim($fullName), 2);

        return [$parts[0], $parts[1] ?? null];
    }
}
