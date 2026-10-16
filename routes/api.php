<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\Clinic\AppointmentController as ClinicAppointmentController;
use App\Http\Controllers\Api\Clinic\AuditLogController as ClinicAuditLogController;
use App\Http\Controllers\Api\Clinic\ClinicProfileController as ClinicClinicProfileController;
use App\Http\Controllers\Api\Clinic\ClinicSettingController as ClinicClinicSettingController;
use App\Http\Controllers\Api\Clinic\DashboardController as ClinicDashboardController;
use App\Http\Controllers\Api\Clinic\DoctorController as ClinicDoctorController;
use App\Http\Controllers\Api\Clinic\DoctorProfileController as ClinicDoctorProfileController;
use App\Http\Controllers\Api\Clinic\DomainController as ClinicDomainController;
use App\Http\Controllers\Api\Clinic\FollowupTaskController as ClinicFollowupTaskController;
use App\Http\Controllers\Api\Clinic\InvoiceController as ClinicInvoiceController;
use App\Http\Controllers\Api\Clinic\MeController as ClinicMeController;
use App\Http\Controllers\Api\Clinic\PatientController as ClinicPatientController;
use App\Http\Controllers\Api\Clinic\PatientFamilyController as ClinicPatientFamilyController;
use App\Http\Controllers\Api\Clinic\PatientPortalLinkController as ClinicPatientPortalLinkController;
use App\Http\Controllers\Api\Clinic\WaitlistController as ClinicWaitlistController;
use App\Http\Controllers\Api\Clinic\PatientProfileController as ClinicPatientProfileController;
use App\Http\Controllers\Api\Clinic\ReminderLogController as ClinicReminderLogController;
use App\Http\Controllers\Api\Clinic\ReportController as ClinicReportController;
use App\Http\Controllers\Api\Clinic\ReviewController as ClinicReviewController;
use App\Http\Controllers\Api\Clinic\RolePermissionController as ClinicRolePermissionController;
use App\Http\Controllers\Api\Clinic\ServiceController as ClinicServiceController;
use App\Http\Controllers\Api\Clinic\SubscriptionController as ClinicSubscriptionController;
use App\Http\Controllers\Api\Clinic\UserController as ClinicUserController;
use App\Http\Controllers\Api\Clinic\WhatsappConversationController as ClinicWhatsappConversationController;
use App\Http\Controllers\Api\Clinic\WhatsappFlowSessionController as ClinicWhatsappFlowSessionController;
use App\Http\Controllers\Api\Clinic\WhatsappMessageController as ClinicWhatsappMessageController;
use App\Http\Controllers\Api\Portal\AppointmentController as PortalAppointmentController;
use App\Http\Controllers\Api\Portal\AuthController as PortalAuthController;
use App\Http\Controllers\Api\Portal\ConsentController as PortalConsentController;
use App\Http\Controllers\Api\Portal\DashboardController as PortalDashboardController;
use App\Http\Controllers\Api\Portal\DoctorController as PortalDoctorController;
use App\Http\Controllers\Api\Portal\FamilyController as PortalFamilyController;
use App\Http\Controllers\Api\Portal\LinkController as PortalLinkController;
use App\Http\Controllers\Api\Portal\OtpController as PortalOtpController;
use App\Http\Controllers\Api\Portal\PrescriptionController as PortalPrescriptionController;
use App\Http\Controllers\Api\Portal\WaitlistController as PortalWaitlistController;
use App\Http\Controllers\Api\PublicPrescriptionPdfController;
use App\Http\Controllers\Api\RazorpayWebhookController;
use App\Http\Controllers\Api\SuperAdmin\AppointmentController as SuperAdminAppointmentController;
use App\Http\Controllers\Api\SuperAdmin\AuditLogController as SuperAdminAuditLogController;
use App\Http\Controllers\Api\SuperAdmin\ClinicController as SuperAdminClinicController;
use App\Http\Controllers\Api\SuperAdmin\ClinicSettingController as SuperAdminClinicSettingController;
use App\Http\Controllers\Api\SuperAdmin\ClinicSubscriptionController as SuperAdminClinicSubscriptionController;
use App\Http\Controllers\Api\SuperAdmin\DashboardController as SuperAdminDashboardController;
use App\Http\Controllers\Api\SuperAdmin\DoctorController as SuperAdminDoctorController;
use App\Http\Controllers\Api\SuperAdmin\DoctorProfileController as SuperAdminDoctorProfileController;
use App\Http\Controllers\Api\SuperAdmin\DomainController as SuperAdminDomainController;
use App\Http\Controllers\Api\SuperAdmin\FollowupTaskController as SuperAdminFollowupTaskController;
use App\Http\Controllers\Api\SuperAdmin\InvoiceController as SuperAdminInvoiceController;
use App\Http\Controllers\Api\SuperAdmin\PatientController as SuperAdminPatientController;
use App\Http\Controllers\Api\SuperAdmin\PatientFamilyController as SuperAdminPatientFamilyController;
use App\Http\Controllers\Api\SuperAdmin\PatientPortalLinkController as SuperAdminPatientPortalLinkController;
use App\Http\Controllers\Api\SuperAdmin\WaitlistController as SuperAdminWaitlistController;
use App\Http\Controllers\Api\SuperAdmin\PatientProfileController as SuperAdminPatientProfileController;
use App\Http\Controllers\Api\SuperAdmin\PlanController as SuperAdminPlanController;
use App\Http\Controllers\Api\SuperAdmin\ReminderLogController as SuperAdminReminderLogController;
use App\Http\Controllers\Api\SuperAdmin\ReportController as SuperAdminReportController;
use App\Http\Controllers\Api\SuperAdmin\ReviewController as SuperAdminReviewController;
use App\Http\Controllers\Api\SuperAdmin\RoleController as SuperAdminRoleController;
use App\Http\Controllers\Api\SuperAdmin\ServiceController as SuperAdminServiceController;
use App\Http\Controllers\Api\SuperAdmin\SubscriptionTransactionController as SuperAdminSubscriptionTransactionController;
use App\Http\Controllers\Api\SuperAdmin\SystemSettingController as SuperAdminSystemSettingController;
use App\Http\Controllers\Api\SuperAdmin\UserController as SuperAdminUserController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappConversationController as SuperAdminWhatsappConversationController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappFlowSessionController as SuperAdminWhatsappFlowSessionController;
use App\Http\Controllers\Api\SuperAdmin\WhatsappMessageController as SuperAdminWhatsappMessageController;
use App\Http\Controllers\Api\UploadController;
use App\Http\Controllers\Api\WhatsAppWebhookController;
use Illuminate\Support\Facades\Route;

if (! function_exists('registerCrudRoutes')) {
    function registerCrudRoutes(string $prefix, string $controller, ?string $module = null): void
    {
        $p = fn (string $action) => $module ? ["perm:{$module}.{$action}"] : [];
        Route::prefix($prefix)->group(function () use ($controller, $p) {
            Route::get('/', [$controller, 'index'])->middleware($p('view'));
            Route::post('/', [$controller, 'store'])->middleware($p('create'));
            Route::get('/{id}', [$controller, 'show'])->middleware($p('view'));
            Route::put('/{id}', [$controller, 'update'])->middleware($p('edit'));
            Route::delete('/{id}', [$controller, 'destroy'])->middleware($p('delete'));
            Route::post('/{id}/restore', [$controller, 'restore'])->middleware($p('edit'));
            Route::post('/{id}/status', [$controller, 'changeStatus'])->middleware($p('edit'));
            Route::post('/{id}/block', [$controller, 'block'])->middleware($p('edit'));
            Route::post('/{id}/unblock', [$controller, 'unblock'])->middleware($p('edit'));
        });
    }
}

Route::post('webhooks/razorpay', RazorpayWebhookController::class);

Route::get('webhooks/whatsapp', [WhatsAppWebhookController::class, 'verify']);
Route::post('webhooks/whatsapp', [WhatsAppWebhookController::class, 'handle']);

Route::get('public/prescriptions/{prescription}/pdf', PublicPrescriptionPdfController::class)
    ->name('whatsapp.prescription-pdf')
    ->middleware('signed');

Route::prefix('auth')->group(function () {
    Route::post('login', [AuthController::class, 'login']);

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
    });
});

Route::prefix('portal')->group(function () {
    Route::post('auth/request-code', [PortalOtpController::class, 'requestCode'])->middleware('throttle:portal-otp');
    Route::post('auth/verify', [PortalOtpController::class, 'verify'])->middleware('throttle:portal-verify');
    Route::post('auth/link', [PortalLinkController::class, 'exchange'])->middleware('throttle:portal-link');

    Route::middleware('portal.auth')->group(function () {
        Route::get('auth/me', [PortalAuthController::class, 'me']);
        Route::post('auth/logout', [PortalAuthController::class, 'logout']);
        Route::post('auth/switch-clinic', [PortalAuthController::class, 'switchClinic']);

        Route::get('consent', [PortalConsentController::class, 'show']);
        Route::post('consent', [PortalConsentController::class, 'store']);

        // Every feature route from here on requires an up-to-date
        // privacy-notice acceptance on the acting profile.
        Route::middleware('portal.consent')->group(function () {
            Route::get('dashboard', [PortalDashboardController::class, 'show']);

            Route::get('family', [PortalFamilyController::class, 'index']);
            Route::post('family', [PortalFamilyController::class, 'store']);

            Route::get('appointments', [PortalAppointmentController::class, 'index']);
            Route::get('appointments/{id}', [PortalAppointmentController::class, 'show']);
            Route::post('appointments', [PortalAppointmentController::class, 'store']);
            Route::post('appointments/{id}/cancel', [PortalAppointmentController::class, 'cancel']);
            Route::post('appointments/{id}/reschedule', [PortalAppointmentController::class, 'reschedule']);

            Route::get('doctors', [PortalDoctorController::class, 'index']);
            Route::get('doctors/{id}/slots', [PortalDoctorController::class, 'slots']);

            Route::get('waitlist', [PortalWaitlistController::class, 'index']);
            Route::post('waitlist', [PortalWaitlistController::class, 'store']);
            Route::get('waitlist/{id}', [PortalWaitlistController::class, 'show']);
            Route::delete('waitlist/{id}', [PortalWaitlistController::class, 'destroy']);
            Route::post('waitlist/{id}/book', [PortalWaitlistController::class, 'book']);
            Route::post('waitlist/{id}/decline', [PortalWaitlistController::class, 'decline']);

            Route::get('prescriptions', [PortalPrescriptionController::class, 'index']);
            Route::get('prescriptions/{id}', [PortalPrescriptionController::class, 'show']);
            Route::get('prescriptions/{id}/pdf', [PortalPrescriptionController::class, 'pdf']);
        });
    });
});

Route::middleware(['auth:sanctum', 'role:super_admin'])->prefix('super-admin')->group(function () {
    Route::get('dashboard/summary', [SuperAdminDashboardController::class, 'summary']);

    Route::get('settings/system', [SuperAdminSystemSettingController::class, 'show']);
    Route::post('settings/system', [SuperAdminSystemSettingController::class, 'store']);
    Route::post('settings/whatsapp/test', [SuperAdminSystemSettingController::class, 'testWhatsApp']);

    Route::get('plans', [SuperAdminPlanController::class, 'index']);
    Route::post('plans', [SuperAdminPlanController::class, 'store']);
    Route::put('plans/{id}', [SuperAdminPlanController::class, 'update']);
    Route::delete('plans/{id}', [SuperAdminPlanController::class, 'destroy']);

    Route::get('reports/appointments.pdf', [SuperAdminReportController::class, 'appointmentsPdf']);
    Route::get('reports/patients.pdf', [SuperAdminReportController::class, 'patientsPdf']);
    Route::get('reports/doctors.pdf', [SuperAdminReportController::class, 'doctorsPdf']);

    registerCrudRoutes('clinics', SuperAdminClinicController::class);
    Route::get('clinics/{id}/overview', [SuperAdminClinicController::class, 'overview']);
    Route::post('clinics/{id}/subscription', [SuperAdminClinicSubscriptionController::class, 'store']);
    Route::put('clinics/{id}/subscription', [SuperAdminClinicSubscriptionController::class, 'update']);
    Route::post('clinics/{id}/subscription/extend-trial', [SuperAdminClinicSubscriptionController::class, 'extendTrial']);
    Route::post('clinics/{id}/subscription/extend-grace', [SuperAdminClinicSubscriptionController::class, 'extendGrace']);
    Route::post('clinics/{id}/subscription/offline-payment', [SuperAdminClinicSubscriptionController::class, 'offlinePayment']);
    Route::post('clinics/{id}/subscription/cancel', [SuperAdminClinicSubscriptionController::class, 'cancel']);
    Route::get('subscription-transactions', [SuperAdminSubscriptionTransactionController::class, 'index']);
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
    registerCrudRoutes('whatsapp/conversations', SuperAdminWhatsappConversationController::class);
    registerCrudRoutes('whatsapp/messages', SuperAdminWhatsappMessageController::class);
    registerCrudRoutes('whatsapp/sessions', SuperAdminWhatsappFlowSessionController::class);
    Route::get('invoices', [SuperAdminInvoiceController::class, 'index']);
    Route::post('invoices', [SuperAdminInvoiceController::class, 'store']);
    Route::get('invoices/{id}', [SuperAdminInvoiceController::class, 'show']);
    Route::put('invoices/{id}', [SuperAdminInvoiceController::class, 'update']);
    Route::post('invoices/{id}/issue', [SuperAdminInvoiceController::class, 'issue']);
    Route::post('invoices/{id}/cancel', [SuperAdminInvoiceController::class, 'cancel']);
    Route::post('invoices/{id}/payments', [SuperAdminInvoiceController::class, 'recordPayment']);
    Route::post('payments/{id}/refund', [SuperAdminInvoiceController::class, 'refund']);
    Route::get('appointments/{id}/invoice-prefill', [SuperAdminInvoiceController::class, 'prefill']);
    registerCrudRoutes('settings/clinic', SuperAdminClinicSettingController::class);
    registerCrudRoutes('audit-logs', SuperAdminAuditLogController::class);
    registerCrudRoutes('reviews', SuperAdminReviewController::class);

    Route::post('users/{id}/reset-password', [SuperAdminUserController::class, 'resetPassword']);
    Route::post('reviews/{id}/generate-reply', [SuperAdminReviewController::class, 'generateReply']);
    Route::post('reviews/{id}/reply', [SuperAdminReviewController::class, 'saveReply']);
    Route::post('appointments/{id}/lifecycle', [SuperAdminAppointmentController::class, 'lifecycle']);
    Route::post('appointments/{id}/reschedule', [SuperAdminAppointmentController::class, 'reschedule']);
    Route::get('appointments/{id}/detail', [SuperAdminAppointmentController::class, 'detail']);

    Route::get('waitlist', [SuperAdminWaitlistController::class, 'index']);
    Route::post('waitlist', [SuperAdminWaitlistController::class, 'store']);
    Route::delete('waitlist/{id}', [SuperAdminWaitlistController::class, 'destroy']);

    Route::get('appointments/{id}/prescription', [SuperAdminAppointmentController::class, 'prescription']);
    Route::get('appointments/{id}/report.pdf', [SuperAdminAppointmentController::class, 'reportPdf']);
    Route::get('appointments/{id}/prescription.pdf', [SuperAdminAppointmentController::class, 'prescriptionPdf']);
    Route::post('appointments/{id}/prescription/voice', [SuperAdminAppointmentController::class, 'generatePrescriptionFromVoice']);
    Route::post('appointments/{id}/prescription/finalize', [SuperAdminAppointmentController::class, 'finalizePrescription']);
    Route::post('appointments/{id}/prescription/send', [SuperAdminAppointmentController::class, 'sendPrescription']);
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
    Route::post('patients/{id}/portal-link', [SuperAdminPatientPortalLinkController::class, 'store']);
    Route::put('patients/{id}/managed-by', [SuperAdminPatientFamilyController::class, 'updateManagedBy']);
    Route::post('patients/{id}/family-links', [SuperAdminPatientFamilyController::class, 'storeFamilyLink']);
    Route::delete('patients/{id}/family-links/{linkId}', [SuperAdminPatientFamilyController::class, 'destroyFamilyLink']);

    Route::get('doctors/{id}/profile', [SuperAdminDoctorProfileController::class, 'profile']);
    Route::put('doctors/{id}/profile', [SuperAdminDoctorProfileController::class, 'updateProfile']);
    Route::post('doctors/{id}/schedules', [SuperAdminDoctorProfileController::class, 'storeSchedule']);
    Route::put('doctors/{id}/schedules/{scheduleId}', [SuperAdminDoctorProfileController::class, 'updateSchedule']);
    Route::delete('doctors/{id}/schedules/{scheduleId}', [SuperAdminDoctorProfileController::class, 'destroySchedule']);
    Route::post('doctors/{id}/exceptions', [SuperAdminDoctorProfileController::class, 'storeException']);
    Route::delete('doctors/{id}/exceptions/{exceptionId}', [SuperAdminDoctorProfileController::class, 'destroyException']);

    Route::get('roles', [SuperAdminRoleController::class, 'index']);
    Route::post('roles', [SuperAdminRoleController::class, 'store']);
    Route::put('roles/{id}', [SuperAdminRoleController::class, 'update']);
    Route::delete('roles/{id}', [SuperAdminRoleController::class, 'destroy']);
    Route::get('permission-catalogue', [SuperAdminRoleController::class, 'catalogue']);

    Route::post('uploads/image', [UploadController::class, 'storeImage']);
});

Route::middleware(['auth:sanctum', 'clinic.scope', 'clinic.context', 'clinic.subscription'])->prefix('clinic')->group(function () {
    Route::get('me/context', [ClinicMeController::class, 'context']);

    Route::get('subscription', [ClinicSubscriptionController::class, 'show'])->middleware('perm:subscription.view');
    Route::post('subscription/checkout', [ClinicSubscriptionController::class, 'checkout'])->middleware('perm:subscription.manage');
    Route::post('subscription/verify', [ClinicSubscriptionController::class, 'verify'])->middleware('perm:subscription.manage');

    Route::get('dashboard/summary', [ClinicDashboardController::class, 'summary']);
    Route::get('dashboard/clinic-admin', [ClinicDashboardController::class, 'clinicAdmin']);
    Route::get('dashboard/receptionist', [ClinicDashboardController::class, 'receptionist']);
    Route::get('dashboard/assistant', [ClinicDashboardController::class, 'assistant']);

    Route::get('reports/appointments.pdf', [ClinicReportController::class, 'appointmentsPdf'])->middleware('perm:reports.view');
    Route::get('reports/patients.pdf', [ClinicReportController::class, 'patientsPdf'])->middleware('perm:reports.view');
    Route::get('reports/doctors.pdf', [ClinicReportController::class, 'doctorsPdf'])->middleware('perm:reports.view');

    registerCrudRoutes('domains', ClinicDomainController::class, 'clinic_settings');
    registerCrudRoutes('users', ClinicUserController::class, 'staff');
    registerCrudRoutes('doctors', ClinicDoctorController::class, 'doctors');
    registerCrudRoutes('services', ClinicServiceController::class, 'services');
    registerCrudRoutes('patients', ClinicPatientController::class, 'patients');
    Route::get('appointments/availability', [ClinicAppointmentController::class, 'availability'])->middleware('perm:appointments.view');
    Route::post('appointments/generate-tokens', [ClinicAppointmentController::class, 'generateTokens'])->middleware('perm:appointments.edit');
    registerCrudRoutes('appointments', ClinicAppointmentController::class, 'appointments');
    registerCrudRoutes('followups', ClinicFollowupTaskController::class, 'followups');
    registerCrudRoutes('reminders', ClinicReminderLogController::class, 'reminders');
    registerCrudRoutes('whatsapp/conversations', ClinicWhatsappConversationController::class, 'whatsapp');
    registerCrudRoutes('whatsapp/messages', ClinicWhatsappMessageController::class, 'whatsapp');
    registerCrudRoutes('whatsapp/sessions', ClinicWhatsappFlowSessionController::class, 'whatsapp');
    // Invoices and payments are never generic CRUD: every write goes through InvoiceService.
    Route::get('invoices', [ClinicInvoiceController::class, 'index'])->middleware('perm:billing.view');
    Route::post('invoices', [ClinicInvoiceController::class, 'store'])->middleware('perm:billing.create');
    Route::get('invoices/{id}', [ClinicInvoiceController::class, 'show'])->middleware('perm:billing.view');
    Route::put('invoices/{id}', [ClinicInvoiceController::class, 'update'])->middleware('perm:billing.create');
    Route::post('invoices/{id}/issue', [ClinicInvoiceController::class, 'issue'])->middleware('perm:billing.create');
    Route::post('invoices/{id}/payments', [ClinicInvoiceController::class, 'recordPayment'])->middleware('perm:billing.create');
    Route::post('invoices/{id}/cancel', [ClinicInvoiceController::class, 'cancel'])->middleware('perm:billing.edit');
    Route::post('payments/{id}/refund', [ClinicInvoiceController::class, 'refund'])->middleware('perm:billing.edit');
    Route::get('appointments/{id}/invoice-prefill', [ClinicInvoiceController::class, 'prefill'])->middleware('perm:billing.view');
    Route::prefix('settings/clinic')->group(function () {
        // Clinic settings are a singleton per clinic: "create" counts as edit.
        Route::get('/', [ClinicClinicSettingController::class, 'index'])->middleware('perm:clinic_settings.view');
        Route::post('/', [ClinicClinicSettingController::class, 'store'])->middleware('perm:clinic_settings.edit');
        Route::get('/{id}', [ClinicClinicSettingController::class, 'show'])->middleware('perm:clinic_settings.view');
        Route::put('/{id}', [ClinicClinicSettingController::class, 'update'])->middleware('perm:clinic_settings.edit');
        Route::delete('/{id}', [ClinicClinicSettingController::class, 'destroy'])->middleware('perm:clinic_settings.delete');
        Route::post('/{id}/restore', [ClinicClinicSettingController::class, 'restore'])->middleware('perm:clinic_settings.edit');
        Route::post('/{id}/status', [ClinicClinicSettingController::class, 'changeStatus'])->middleware('perm:clinic_settings.edit');
        Route::post('/{id}/block', [ClinicClinicSettingController::class, 'block'])->middleware('perm:clinic_settings.edit');
        Route::post('/{id}/unblock', [ClinicClinicSettingController::class, 'unblock'])->middleware('perm:clinic_settings.edit');
    });
    registerCrudRoutes('audit-logs', ClinicAuditLogController::class, 'audit_logs');
    registerCrudRoutes('reviews', ClinicReviewController::class, 'reviews');

    Route::post('appointments/{id}/lifecycle', [ClinicAppointmentController::class, 'lifecycle'])->middleware('perm:appointments.view');
    Route::post('reviews/{id}/generate-reply', [ClinicReviewController::class, 'generateReply'])->middleware('perm:reviews.edit');
    Route::post('reviews/{id}/reply', [ClinicReviewController::class, 'saveReply'])->middleware('perm:reviews.edit');
    Route::post('appointments/{id}/reschedule', [ClinicAppointmentController::class, 'reschedule'])->middleware('perm:appointments.edit');
    Route::get('appointments/{id}/detail', [ClinicAppointmentController::class, 'detail'])->middleware('perm:appointments.view');

    Route::get('waitlist', [ClinicWaitlistController::class, 'index'])->middleware('perm:appointments.view');
    Route::post('waitlist', [ClinicWaitlistController::class, 'store'])->middleware('perm:appointments.create');
    Route::delete('waitlist/{id}', [ClinicWaitlistController::class, 'destroy'])->middleware('perm:appointments.create');

    Route::get('appointments/{id}/prescription', [ClinicAppointmentController::class, 'prescription'])->middleware('perm:appointments.view');
    Route::get('appointments/{id}/report.pdf', [ClinicAppointmentController::class, 'reportPdf'])->middleware('perm:appointments.view');
    Route::get('appointments/{id}/prescription.pdf', [ClinicAppointmentController::class, 'prescriptionPdf'])->middleware('perm:appointments.view');
    Route::post('appointments/{id}/prescription/voice', [ClinicAppointmentController::class, 'generatePrescriptionFromVoice'])->middleware('perm:appointments.prescribe');
    Route::post('appointments/{id}/prescription/finalize', [ClinicAppointmentController::class, 'finalizePrescription'])->middleware('perm:appointments.prescribe');
    Route::post('appointments/{id}/prescription/send', [ClinicAppointmentController::class, 'sendPrescription'])->middleware('perm:appointments.prescribe');
    Route::get('appointments/{id}/summary', [ClinicAppointmentController::class, 'summary'])->middleware('perm:appointments.view');
    Route::post('appointments/{id}/summary/voice', [ClinicAppointmentController::class, 'generateSummaryFromVoice'])->middleware('perm:appointments.prescribe');

    Route::get('patients/{id}/profile', [ClinicPatientProfileController::class, 'profile'])->middleware('perm:patients.view');
    Route::get('patients/{id}/notes', [ClinicPatientProfileController::class, 'notes'])->middleware('perm:patients.view');
    Route::post('patients/{id}/notes', [ClinicPatientProfileController::class, 'storeNote'])->middleware('perm:patients.edit');
    Route::put('patients/{id}/medical-profile', [ClinicPatientProfileController::class, 'updateMedicalProfile'])->middleware('perm:patients.edit');
    Route::get('patients/{id}/activity', [ClinicPatientProfileController::class, 'activity'])->middleware('perm:patients.view');
    Route::get('patients/{id}/global-summary', [ClinicPatientProfileController::class, 'globalSummary'])->middleware('perm:patients.view');
    Route::post('patients/{id}/global-summary', [ClinicPatientProfileController::class, 'generateGlobalSummary'])->middleware('perm:patients.edit');
    Route::get('patients/{id}/report.pdf', [ClinicPatientProfileController::class, 'reportPdf'])->middleware('perm:patients.view');
    Route::post('patients/{id}/portal-link', [ClinicPatientPortalLinkController::class, 'store'])->middleware('perm:patients.portal_link');
    Route::put('patients/{id}/managed-by', [ClinicPatientFamilyController::class, 'updateManagedBy'])->middleware('perm:patients.edit');
    Route::post('patients/{id}/family-links', [ClinicPatientFamilyController::class, 'storeFamilyLink'])->middleware('perm:patients.edit');
    Route::delete('patients/{id}/family-links/{linkId}', [ClinicPatientFamilyController::class, 'destroyFamilyLink'])->middleware('perm:patients.edit');

    Route::get('doctors/{id}/profile', [ClinicDoctorProfileController::class, 'profile'])->middleware('perm:doctors.view');
    Route::put('doctors/{id}/profile', [ClinicDoctorProfileController::class, 'updateProfile'])->middleware('perm:doctors.edit');
    Route::post('doctors/{id}/schedules', [ClinicDoctorProfileController::class, 'storeSchedule'])->middleware('perm:doctor_schedules.create');
    Route::put('doctors/{id}/schedules/{scheduleId}', [ClinicDoctorProfileController::class, 'updateSchedule'])->middleware('perm:doctor_schedules.edit');
    Route::delete('doctors/{id}/schedules/{scheduleId}', [ClinicDoctorProfileController::class, 'destroySchedule'])->middleware('perm:doctor_schedules.delete');
    Route::post('doctors/{id}/exceptions', [ClinicDoctorProfileController::class, 'storeException'])->middleware('perm:doctor_schedules.create');
    Route::delete('doctors/{id}/exceptions/{exceptionId}', [ClinicDoctorProfileController::class, 'destroyException'])->middleware('perm:doctor_schedules.delete');

    Route::get('roles', [ClinicRolePermissionController::class, 'roles'])->middleware('perm:staff.view');

    Route::post('uploads/image', [UploadController::class, 'storeImage']);

    Route::get('clinic/profile', [ClinicClinicProfileController::class, 'show'])->middleware('perm:clinic_profile.view');
    Route::put('clinic/profile', [ClinicClinicProfileController::class, 'update'])->middleware('perm:clinic_profile.edit');
});
