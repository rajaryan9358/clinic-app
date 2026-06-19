<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Enums\UserRole;
use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Models\User;
use App\Models\WhatsappConversation;

class DashboardController extends BaseCrudController
{
    protected string $modelClass = Clinic::class;

    public function summary()
    {
        $today = now()->toDateString();

        return $this->success('Dashboard summary fetched successfully', [
            'total_clinics' => Clinic::count(),
            'today_clinic_onboarding' => Clinic::whereDate('created_at', $today)->count(),
            'total_branches' => Branch::count(),
            'total_staff' => User::query()
                ->where('role', '!=', UserRole::SUPER_ADMIN->value)
                ->where('role', '!=', UserRole::DOCTOR->value)
                ->count(),
            'total_doctors' => Doctor::count(),
            'total_patients' => Patient::count(),
            'today_patients' => Patient::whereDate('created_at', $today)->count(),
            'total_appointments' => Appointment::count(),
            'today_appointments' => Appointment::whereDate('appointment_date', $today)->count(),

            'total_whatsapp_conversations' => WhatsappConversation::count(),
            'today_whatsapp_conversations' => WhatsappConversation::whereDate('last_message_at', $today)->count(),
            'total_whatsapp_appointments' => Appointment::where('booking_channel', 'whatsapp')->count(),
            'today_whatsapp_appointments' => Appointment::where('booking_channel', 'whatsapp')
                ->whereDate('appointment_date', $today)
                ->count(),

            'pending_followups' => FollowupTask::where('status', 'pending')->count(),
        ]);
    }
}
