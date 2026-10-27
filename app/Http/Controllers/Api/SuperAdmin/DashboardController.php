<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Models\Role;
use App\Models\User;
use App\Models\WhatsappConversation;
use Illuminate\Support\Carbon;

class DashboardController extends BaseCrudController
{
    protected string $modelClass = Clinic::class;

    public function summary()
    {
        $today = now()->toDateString();
        $clinicToday = Carbon::now(config('app.clinic_timezone', 'Asia/Kolkata'))->toDateString();

        return $this->success('Dashboard summary fetched successfully', [
            'total_clinics' => Clinic::count(),
            'today_clinic_onboarding' => Clinic::whereDate('created_at', $today)->count(),
            'total_staff' => User::query()
                ->whereNotIn('role', Role::whereIn('kind', ['super_admin', 'doctor'])->pluck('name'))
                ->count(),
            'total_doctors' => Doctor::count(),
            'total_patients' => Patient::count(),
            'today_patients' => Patient::whereDate('created_at', $today)->count(),
            'total_appointments' => Appointment::count(),
            'today_appointments' => Appointment::whereDate('appointment_date', $clinicToday)->count(),

            'total_whatsapp_conversations' => WhatsappConversation::count(),
            'today_whatsapp_conversations' => WhatsappConversation::whereDate('last_message_at', $today)->count(),
            'total_whatsapp_appointments' => Appointment::where('booking_channel', 'whatsapp')->count(),
            'today_whatsapp_appointments' => Appointment::where('booking_channel', 'whatsapp')
                ->whereDate('appointment_date', $clinicToday)
                ->count(),

            'pending_followups' => FollowupTask::where('status', 'pending')->count(),
        ]);
    }
}
