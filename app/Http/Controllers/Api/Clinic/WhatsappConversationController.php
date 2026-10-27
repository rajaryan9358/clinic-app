<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappConversation;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class WhatsappConversationController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappConversation::class;
    protected array $searchable = ['customer_phone', 'conversation_status'];
    protected array $filterable = ['conversation_status', 'current_owner_type'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $clinicId = $this->clinicId($request);
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'patient_id' => ['nullable', 'integer', Rule::exists('patients', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'customer_phone' => [...$required, 'string', 'max:20'],
            'conversation_status' => ['sometimes', 'in:open,closed,bot_active,staff_active'],
            'current_owner_type' => ['sometimes', 'in:bot,staff,system'],
            'current_owner_user_id' => ['nullable', 'integer', Rule::exists('users', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
        ];
    }
}
