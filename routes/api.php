<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\Clinic\AppointmentController as ClinicAppointmentController;
use App\Http\Controllers\Api\Clinic\AuditLogController as ClinicAuditLogController;
use App\Http\Controllers\Api\Clinic\ClinicSettingController as ClinicClinicSettingController;
use App\Http\Controllers\Api\Clinic\DashboardController as ClinicDashboardController;
use App\Http\Controllers\Api\Clinic\DoctorController as ClinicDoctorController;
use App\Http\Controllers\Api\Clinic\DoctorProfileController as ClinicDoctorProfileController;
use App\Http\Controllers\Api\Clinic\DomainController as ClinicDomainController;
use App\Http\Controllers\Api\Clinic\FollowupTaskController as ClinicFollowupTaskController;
use App\Http\Controllers\Api\Clinic\InvoiceController as ClinicInvoiceController;
use App\Http\Controllers\Api\Clinic\MeController as ClinicMeController;
use App\Http\Controllers\Api\Clinic\PatientController as ClinicPatientController;
use App\Http\Controllers\Api\Clinic\PatientProfileController as ClinicPatientProfileController;
use App\Http\Controllers\Api\Clinic\PaymentController as ClinicPaymentController;
use App\Http\Controllers\Api\Clinic\ReminderLogController as ClinicReminderLogController;
use App\Http\Controllers\Api\Clinic\ReportController as ClinicReportController;
use App\Http\Controllers\Api\Clinic\ReviewController as ClinicReviewController;
use App\Http\Controllers\Api\Clinic\RolePermissionController as ClinicRolePermissionController;
use App\Http\Controllers\Api\Clinic\ServiceController as ClinicServiceController;
use App\Http\Controllers\Api\Clinic\UserController as ClinicUserController;
use App\Http\Controllers\Api\Clinic\WhatsappAccountController as ClinicWhatsappAccountController;
use App\Http\Controllers\Api\Clinic\WhatsappConversationController as ClinicWhatsappConversationController;
use App\Http\Controllers\Api\Clinic\WhatsappFlowSessionController as ClinicWhatsappFlowSessionController;
use App\Http\Controllers\Api\Clinic\WhatsappMessageController as ClinicWhatsappMessageController;
use App\Http\Controllers\Api\Clinic\ClinicProfileController as ClinicClinicProfileController;
use App\Http\Controllers\Api\Clinic\WhatsappTemplateController as ClinicWhatsappTemplateController;
use App\Http\Controllers\Api\SuperAdmin\AppointmentController as SuperAdminAppointmentController;
use App\Http\Controllers\Api\SuperAdmin\AuditLogController as SuperAdminAuditLogController;
use App\Http\Controllers\Api\SuperAdmin\ClinicController as SuperAdminClinicController;
use App\Http\Controllers\Api\SuperAdmin\PlanController as SuperAdminPlanController;
use App\Http\Controllers\Api\SuperAdmin\ClinicSettingController as SuperAdminClinicSettingController;
use App\Http\Controllers\Api\SuperAdmin\DashboardController as SuperAdminDashboardController;
use App\Http\Controllers\Api\SuperAdmin\DoctorController as SuperAdminDoctorController;
use App\Http\Controllers\Api\SuperAdmin\DoctorProfileController as SuperAdminDoctorProfileController;
use App\Http\Controllers\Api\SuperAdmin\DomainController as SuperAdminDomainController;
use App\Http\Controllers\Api\SuperAdmin\FollowupTaskController as SuperAdminFollowupTaskController;
use App\Http\Controllers\Api\SuperAdmin\InvoiceController as SuperAdminInvoiceController;
use App\Http\Controllers\Api\SuperAdmin\PatientController as SuperAdminPatientController;
use App\Http\Controllers\Api\SuperAdmin\PatientProfileController as SuperAdminPatientProfileController;
use App\Http\Controllers\Api\SuperAdmin\PaymentController as SuperAdminPaymentController;
use App\Http\Controllers\Api\SuperAdmin\ReminderLogController as SuperAdminReminderLogController;
use App\Http\Controllers\Api\SuperAdmin\ReportController as SuperAdminReportController;
use App\Http\Controllers\Api\SuperAdmin\ReviewController as SuperAdminReviewController;
use App\Http\Controllers\Api\SuperAdmin\RolePermissionController as SuperAdminRolePermissionController;
use App\Http\Controllers\Api\SuperAdmin\ServiceController as SuperAdminServiceController;
use App\Http\Controllers\Api\SuperAdmin\SystemSettingController as SuperAdminSystemSettingController;
use App\Http\Controllers\Api\SuperAdmin\UserController as SuperAdminUserController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappAccountController as SuperAdminWhatsappAccountController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappConversationController as SuperAdminWhatsappConversationController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappFlowSessionController as SuperAdminWhatsappFlowSessionController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappMessageController as SuperAdminWhatsappMessageController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappTemplateController as SuperAdminWhatsappTemplateController;
use App\Http\Controllers\Api\UploadController;
use Illuminate\Support\Facades\Route;

if (! function_exists('registerCrudRoutes')) {
    function registerCrudRoutes(string $prefix, string $controller): void {
        Route::prefix($prefix)->group(function () use ($controller) {
            Route::get('/', [$controller, 'index']);
            Route::post('/', [$controller, 'store']);
            Route::get('/{id}', [$controller, 'show']);
            Route::put('/{id}', [$controller, 'update']);
            Route::delete('/{id}', [$controller, 'destroy']);
            Route::post('/{id}/restore', [$controller, 'restore']);
            Route::post('/{id}/status', [$controller, 'changeStatus']);
            Route::post('/{id}/block', [$controller, 'block']);
            Route::post('/{id}/unblock', [$controller, 'unblock']);
        });
    }
}

Route::prefix('auth')->group(function () {
    Route::post('login', [AuthController::class, 'login']);

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
    });
});

Route::middleware(['auth:sanctum', 'role:super_admin'])->prefix('super-admin')->group(function () {
    Route::get('dashboard/summary', [SuperAdminDashboardController::class, 'summary']);

    Route::get('settings/system', [SuperAdminSystemSettingController::class, 'show']);
    Route::post('settings/system', [SuperAdminSystemSettingController::class, 'store']);

    Route::get('plans', [SuperAdminPlanController::class, 'index']);
    Route::post('plans', [SuperAdminPlanController::class, 'store']);
    Route::put('plans/{id}', [SuperAdminPlanController::class, 'update']);
    Route::delete('plans/{id}', [SuperAdminPlanController::class, 'destroy']);

    Route::get('reports/appointments.pdf', [SuperAdminReportController::class, 'appointmentsPdf']);
    Route::get('reports/patients.pdf', [SuperAdminReportController::class, 'patientsPdf']);
    Route::get('reports/doctors.pdf', [SuperAdminReportController::class, 'doctorsPdf']);

    registerCrudRoutes('clinics', SuperAdminClinicController::class);
    Route::get('clinics/{id}/overview', [SuperAdminClinicController::class, 'overview']);
    registerCrudRoutes('domains', SuperAdminDomainController::class);
    registerCrudRoutes('users', SuperAdminUserController::class);
    registerCrudRoutes('doctors', SuperAdminDoctorController::class);
    registerCrudRoutes('services', SuperAdminServiceController::class);
    registerCrudRoutes('patients', SuperAdminPatientController::class);
    Route::get('appointments/availability', [SuperAdminAppointmentController::class, 'availability']);
    Route::post('appointments/generate-tokens', [SuperAdminAppointmentController::class, 'generateTokens']);
    registerCrudRoutes('appointments', SuperAdminAppointmentController::class);
    registerCrudRoutes('followups', SuperAdminFollowupTaskController::class);
    registerCrudRoutes('reminders', SuperAdminReminderLogController::class);
    registerCrudRoutes('whatsapp/accounts', SuperAdminWhatsappAccountController::class);
    registerCrudRoutes('whatsapp/templates', SuperAdminWhatsappTemplateController::class);
    registerCrudRoutes('whatsapp/conversations', SuperAdminWhatsappConversationController::class);
    registerCrudRoutes('whatsapp/messages', SuperAdminWhatsappMessageController::class);
    registerCrudRoutes('whatsapp/sessions', SuperAdminWhatsappFlowSessionController::class);
    registerCrudRoutes('invoices', SuperAdminInvoiceController::class);
    registerCrudRoutes('payments', SuperAdminPaymentController::class);
    registerCrudRoutes('settings/clinic', SuperAdminClinicSettingController::class);
    registerCrudRoutes('audit-logs', SuperAdminAuditLogController::class);
    registerCrudRoutes('reviews', SuperAdminReviewController::class);

    Route::post('users/{id}/reset-password', [SuperAdminUserController::class, 'resetPassword']);
    Route::post('reviews/{id}/generate-reply', [SuperAdminReviewController::class, 'generateReply']);
    Route::post('reviews/{id}/reply', [SuperAdminReviewController::class, 'saveReply']);
    Route::post('appointments/{id}/lifecycle', [SuperAdminAppointmentController::class, 'lifecycle']);
    Route::post('appointments/{id}/reschedule', [SuperAdminAppointmentController::class, 'reschedule']);
    Route::get('appointments/{id}/detail', [SuperAdminAppointmentController::class, 'detail']);
    Route::get('appointments/{id}/prescription', [SuperAdminAppointmentController::class, 'prescription']);
    Route::get('appointments/{id}/report.pdf', [SuperAdminAppointmentController::class, 'reportPdf']);
    Route::get('appointments/{id}/prescription.pdf', [SuperAdminAppointmentController::class, 'prescriptionPdf']);
    Route::post('appointments/{id}/prescription/voice', [SuperAdminAppointmentController::class, 'generatePrescriptionFromVoice']);
    Route::get('appointments/{id}/summary', [SuperAdminAppointmentController::class, 'summary']);
    Route::post('appointments/{id}/summary/voice', [SuperAdminAppointmentController::class, 'generateSummaryFromVoice']);

    Route::get('patients/{id}/profile', [SuperAdminPatientProfileController::class, 'profile']);
    Route::get('patients/{id}/notes', [SuperAdminPatientProfileController::class, 'notes']);
    Route::post('patients/{id}/notes', [SuperAdminPatientProfileController::class, 'storeNote']);
    Route::put('patients/{id}/medical-profile', [SuperAdminPatientProfileController::class, 'updateMedicalProfile']);
    Route::get('patients/{id}/activity', [SuperAdminPatientProfileController::class, 'activity']);
    Route::get('patients/{id}/global-summary', [SuperAdminPatientProfileController::class, 'globalSummary']);
    Route::post('patients/{id}/global-summary', [SuperAdminPatientProfileController::class, 'generateGlobalSummary']);
    Route::get('patients/{id}/report.pdf', [SuperAdminPatientProfileController::class, 'reportPdf']);

    Route::get('doctors/{id}/profile', [SuperAdminDoctorProfileController::class, 'profile']);
    Route::put('doctors/{id}/profile', [SuperAdminDoctorProfileController::class, 'updateProfile']);
    Route::post('doctors/{id}/schedules', [SuperAdminDoctorProfileController::class, 'storeSchedule']);
    Route::put('doctors/{id}/schedules/{scheduleId}', [SuperAdminDoctorProfileController::class, 'updateSchedule']);
    Route::delete('doctors/{id}/schedules/{scheduleId}', [SuperAdminDoctorProfileController::class, 'destroySchedule']);
    Route::post('doctors/{id}/exceptions', [SuperAdminDoctorProfileController::class, 'storeException']);
    Route::delete('doctors/{id}/exceptions/{exceptionId}', [SuperAdminDoctorProfileController::class, 'destroyException']);

    Route::get('roles', [SuperAdminRolePermissionController::class, 'roles']);
    Route::post('roles', [SuperAdminRolePermissionController::class, 'createRole']);
    Route::post('roles/{roleId}/permissions', [SuperAdminRolePermissionController::class, 'syncRolePermissions']);
    Route::get('permissions', [SuperAdminRolePermissionController::class, 'permissions']);

    Route::post('uploads/image', [UploadController::class, 'storeImage']);
});

Route::middleware(['auth:sanctum', 'clinic.scope', 'clinic.context', 'clinic.subscription'])->prefix('clinic')->group(function () {
    Route::get('me/context', [ClinicMeController::class, 'context']);

    Route::get('dashboard/summary', [ClinicDashboardController::class, 'summary']);
    Route::get('dashboard/clinic-admin', [ClinicDashboardController::class, 'clinicAdmin']);
    Route::get('dashboard/receptionist', [ClinicDashboardController::class, 'receptionist']);
    Route::get('dashboard/assistant', [ClinicDashboardController::class, 'assistant']);

    Route::get('reports/appointments.pdf', [ClinicReportController::class, 'appointmentsPdf']);
    Route::get('reports/patients.pdf', [ClinicReportController::class, 'patientsPdf']);
    Route::get('reports/doctors.pdf', [ClinicReportController::class, 'doctorsPdf']);

    registerCrudRoutes('domains', ClinicDomainController::class);
    registerCrudRoutes('users', ClinicUserController::class);
    registerCrudRoutes('doctors', ClinicDoctorController::class);
    registerCrudRoutes('services', ClinicServiceController::class);
    registerCrudRoutes('patients', ClinicPatientController::class);
    Route::get('appointments/availability', [ClinicAppointmentController::class, 'availability']);
    Route::post('appointments/generate-tokens', [ClinicAppointmentController::class, 'generateTokens']);
    registerCrudRoutes('appointments', ClinicAppointmentController::class);
    registerCrudRoutes('followups', ClinicFollowupTaskController::class);
    registerCrudRoutes('reminders', ClinicReminderLogController::class);
    registerCrudRoutes('whatsapp/accounts', ClinicWhatsappAccountController::class);
    registerCrudRoutes('whatsapp/templates', ClinicWhatsappTemplateController::class);
    registerCrudRoutes('whatsapp/conversations', ClinicWhatsappConversationController::class);
    registerCrudRoutes('whatsapp/messages', ClinicWhatsappMessageController::class);
    registerCrudRoutes('whatsapp/sessions', ClinicWhatsappFlowSessionController::class);
    registerCrudRoutes('invoices', ClinicInvoiceController::class);
    registerCrudRoutes('payments', ClinicPaymentController::class);
    registerCrudRoutes('settings/clinic', ClinicClinicSettingController::class);
    registerCrudRoutes('audit-logs', ClinicAuditLogController::class);
    registerCrudRoutes('reviews', ClinicReviewController::class);

    Route::post('appointments/{id}/lifecycle', [ClinicAppointmentController::class, 'lifecycle']);
    Route::post('reviews/{id}/generate-reply', [ClinicReviewController::class, 'generateReply']);
    Route::post('reviews/{id}/reply', [ClinicReviewController::class, 'saveReply']);
    Route::post('appointments/{id}/reschedule', [ClinicAppointmentController::class, 'reschedule']);
    Route::get('appointments/{id}/detail', [ClinicAppointmentController::class, 'detail']);
    Route::get('appointments/{id}/prescription', [ClinicAppointmentController::class, 'prescription']);
    Route::get('appointments/{id}/report.pdf', [ClinicAppointmentController::class, 'reportPdf']);
    Route::get('appointments/{id}/prescription.pdf', [ClinicAppointmentController::class, 'prescriptionPdf']);
    Route::post('appointments/{id}/prescription/voice', [ClinicAppointmentController::class, 'generatePrescriptionFromVoice']);
    Route::get('appointments/{id}/summary', [ClinicAppointmentController::class, 'summary']);
    Route::post('appointments/{id}/summary/voice', [ClinicAppointmentController::class, 'generateSummaryFromVoice']);

    Route::get('patients/{id}/profile', [ClinicPatientProfileController::class, 'profile']);
    Route::get('patients/{id}/notes', [ClinicPatientProfileController::class, 'notes']);
    Route::post('patients/{id}/notes', [ClinicPatientProfileController::class, 'storeNote']);
    Route::put('patients/{id}/medical-profile', [ClinicPatientProfileController::class, 'updateMedicalProfile']);
    Route::get('patients/{id}/activity', [ClinicPatientProfileController::class, 'activity']);
    Route::get('patients/{id}/global-summary', [ClinicPatientProfileController::class, 'globalSummary']);
    Route::post('patients/{id}/global-summary', [ClinicPatientProfileController::class, 'generateGlobalSummary']);
    Route::get('patients/{id}/report.pdf', [ClinicPatientProfileController::class, 'reportPdf']);

    Route::get('doctors/{id}/profile', [ClinicDoctorProfileController::class, 'profile']);
    Route::put('doctors/{id}/profile', [ClinicDoctorProfileController::class, 'updateProfile']);
    Route::post('doctors/{id}/schedules', [ClinicDoctorProfileController::class, 'storeSchedule']);
    Route::put('doctors/{id}/schedules/{scheduleId}', [ClinicDoctorProfileController::class, 'updateSchedule']);
    Route::delete('doctors/{id}/schedules/{scheduleId}', [ClinicDoctorProfileController::class, 'destroySchedule']);
    Route::post('doctors/{id}/exceptions', [ClinicDoctorProfileController::class, 'storeException']);
    Route::delete('doctors/{id}/exceptions/{exceptionId}', [ClinicDoctorProfileController::class, 'destroyException']);

    Route::get('roles', [ClinicRolePermissionController::class, 'roles']);
    Route::get('permissions', [ClinicRolePermissionController::class, 'permissions']);
    Route::post('roles/{roleId}/permissions', [ClinicRolePermissionController::class, 'syncRolePermissions']);

    Route::post('uploads/image', [UploadController::class, 'storeImage']);

    Route::get('clinic/profile', [ClinicClinicProfileController::class, 'show']);
    Route::put('clinic/profile', [ClinicClinicProfileController::class, 'update']);
});
