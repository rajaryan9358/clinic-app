import React from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import SubscriptionLockScreen from './components/billing/SubscriptionLockScreen.jsx';
import { useAuth } from './context/AuthContext';
import { useScope } from './context/ScopeContext';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ModuleFormPage from './pages/ModuleFormPage';
import ModuleListPage from './pages/ModuleListPage';
import ModuleViewPage from './pages/ModuleViewPage';
import CreateStaffWizardPage from './pages/workflows/CreateStaffWizardPage';
import OnboardClinicWizardPage from './pages/workflows/OnboardClinicWizardPage';
import SetupDoctorWizardPage from './pages/workflows/SetupDoctorWizardPage';
import AppointmentsFlowPage from './pages/workflows/AppointmentsFlowPage';
import WaitlistPage from './pages/workflows/WaitlistPage';
import WaitlistAddPage from './pages/workflows/WaitlistAddPage';
import AppointmentDetailPage from './pages/workflows/AppointmentDetailPage';
import FollowupsPage from './pages/workflows/FollowupsPage';
import FollowupFormPage from './pages/workflows/FollowupFormPage';
import BillingPage from './pages/workflows/BillingPage';
import InvoiceDetailPage from './pages/workflows/InvoiceDetailPage';
import PrescriptionPage from './pages/workflows/PrescriptionPage';
import PatientProfilePage from './pages/workflows/PatientProfilePage';
import DoctorSetupFlowPage from './pages/workflows/DoctorSetupFlowPage';
import CommunicationDeliveryIssuesPage from './pages/workflows/CommunicationDeliveryIssuesPage';
import MyDoctorProfilePage from './pages/workflows/MyDoctorProfilePage';
import DoctorAvailabilityPage from './pages/workflows/DoctorAvailabilityPage';
import ClinicDetailPage from './pages/workflows/ClinicDetailPage';
import ClinicProfilePage from './pages/workflows/ClinicProfilePage';
import SystemSettingsPage from './pages/workflows/SystemSettingsPage';
import RolesPage from './pages/workflows/RolesPage';
import PlansPage from './pages/billing/PlansPage';
import SubscriptionTransactionsPage from './pages/billing/SubscriptionTransactionsPage';
import ClinicSubscriptionPage from './pages/billing/ClinicSubscriptionPage';

function Protected({ children }) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    return children;
}

function BlockSuperAdmin({ children }) {
    const { user } = useAuth();
    if (user?.role === 'super_admin') return <Navigate to="/dashboard" replace />;
    return children;
}

function OnlySuperAdmin({ children }) {
    const { user } = useAuth();
    if (user?.role !== 'super_admin') return <Navigate to="/dashboard" replace />;
    return children;
}

function BlockDoctor({ children }) {
    const scope = useScope();
    if (scope?.roleKind === 'doctor') return <Navigate to="/workflows/appointments" replace />;
    return children;
}

// Redirects to /dashboard unless the current user (super_admin/clinic_admin
// kinds always pass) holds the given permission. Used to guard routes whose
// pages assume the caller can already view/act on the resource.
function RequirePerm({ perm, children }) {
    const scope = useScope();
    if (perm && !scope?.can?.(perm)) return <Navigate to="/dashboard" replace />;
    return children;
}

// Full-page loader shown for a clinic user while the /clinic/me/context
// fetch is still in flight (initial load, or right after an in-tab login).
function FullPageLoader() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
    );
}

// Old bookmarks and emailed links to an appointment still open the appointment they name.
function RedirectToAppointment() {
    const { id } = useParams();
    return <Navigate to={`/workflows/appointments/${id}`} replace />;
}

// Wraps the authenticated routes: when the clinic's subscription is locked
// (context.subscription.allows_access === false or a 402 SUBSCRIPTION_REQUIRED
// response was seen), a user who can manage the subscription is redirected to
// the subscription page (unless already there, to avoid a redirect loop) and
// every other clinic user sees a full-page lock screen instead of the app —
// without ever calling GET /clinic/subscription, since most clinic roles
// lack subscription.view.
function AuthenticatedShell() {
    const { user } = useAuth();
    const scope = useScope();
    const location = useLocation();
    const isSuperAdmin = user?.role === 'super_admin';

    // Wait for the clinic permissions context to load before mounting any
    // page for a clinic user. Every permission-gated page below decides what
    // to render (or redirect to) based on `scope.can()`/`scope.roleKind`; if
    // that page mounted before the context arrived and then re-rendered once
    // it did, `can()` could flip between two renders of the SAME mounted
    // instance and change how many hooks that page called, crashing React.
    // Gating here means every page's first render already has the real
    // permissions, so that can never happen. Super admin pages gate on the
    // synchronous `user.role` instead (never on `can()`), so they don't need
    // to wait.
    if (!isSuperAdmin && !scope?.ready) {
        return <FullPageLoader />;
    }

    const subscriptionLocked = scope?.subscriptionLocked;

    if (subscriptionLocked) {
        if (scope?.can?.('subscription.manage')) {
            if (location.pathname !== '/workflows/subscription') {
                return <Navigate to="/workflows/subscription" replace />;
            }
        } else {
            return <SubscriptionLockScreen message={subscriptionLocked.message} clinicName={scope?.context?.clinic_name} />;
        }
    }

    return (
        <Layout>
            <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />

                {/* ── Super Admin Workflows ── */}
                <Route path="/workflows/onboard-clinic" element={<OnlySuperAdmin><OnboardClinicWizardPage /></OnlySuperAdmin>} />
                <Route path="/workflows/clinics" element={<OnlySuperAdmin><ModuleListPage forcedModuleKey="clinics" /></OnlySuperAdmin>} />
                <Route path="/workflows/clinics/:id" element={<OnlySuperAdmin><ClinicDetailPage /></OnlySuperAdmin>} />
                <Route path="/workflows/system-settings" element={<OnlySuperAdmin><SystemSettingsPage /></OnlySuperAdmin>} />
                <Route path="/workflows/roles" element={<OnlySuperAdmin><RolesPage /></OnlySuperAdmin>} />
                <Route path="/billing/plans" element={<OnlySuperAdmin><PlansPage /></OnlySuperAdmin>} />
                <Route path="/billing/subscription-transactions" element={<OnlySuperAdmin><SubscriptionTransactionsPage /></OnlySuperAdmin>} />

                {/* ── Clinic Admin Workflows ── */}
                <Route path="/workflows/clinic-profile" element={<BlockSuperAdmin><RequirePerm perm="clinic_profile.view"><ClinicProfilePage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/subscription" element={<BlockSuperAdmin><RequirePerm perm="subscription.view"><ClinicSubscriptionPage /></RequirePerm></BlockSuperAdmin>} />

                {/* ── Shared Workflows ── */}
                <Route path="/workflows/create-staff" element={<RequirePerm perm="staff.create"><CreateStaffWizardPage /></RequirePerm>} />
                <Route path="/workflows/setup-doctor" element={<RequirePerm perm="doctors.create"><SetupDoctorWizardPage /></RequirePerm>} />
                <Route path="/workflows/appointments" element={<BlockSuperAdmin><RequirePerm perm="appointments.view"><AppointmentsFlowPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/appointments/new" element={<BlockSuperAdmin><RequirePerm perm="appointments.view"><ModuleFormPage forcedModuleKey="appointments" /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/waitlist" element={<BlockSuperAdmin><RequirePerm perm="appointments.view"><WaitlistPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/waitlist/new" element={<BlockSuperAdmin><RequirePerm perm="appointments.view"><RequirePerm perm="appointments.create"><WaitlistAddPage /></RequirePerm></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/followups" element={<BlockSuperAdmin><RequirePerm perm="followups.view"><FollowupsPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/followups/new" element={<BlockSuperAdmin><RequirePerm perm="followups.create"><FollowupFormPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/billing" element={<BlockSuperAdmin><RequirePerm perm="billing.view"><BillingPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/billing/new" element={<BlockSuperAdmin><RequirePerm perm="billing.create"><InvoiceDetailPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/billing/:id" element={<BlockSuperAdmin><RequirePerm perm="billing.view"><InvoiceDetailPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/appointments/:id" element={<BlockSuperAdmin><RequirePerm perm="appointments.view"><AppointmentDetailPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/appointments/:id/prescription" element={<BlockSuperAdmin><RequirePerm perm="appointments.view"><PrescriptionPage /></RequirePerm></BlockSuperAdmin>} />
                <Route path="/workflows/communication/delivery-issues" element={<BlockSuperAdmin><CommunicationDeliveryIssuesPage /></BlockSuperAdmin>} />
                <Route path="/workflows/my-profile" element={<MyDoctorProfilePage />} />
                <Route path="/workflows/my-availability" element={<DoctorAvailabilityPage />} />

                {/* ── Module shortcuts ── */}
                <Route path="/modules/patients/new" element={<BlockSuperAdmin><ModuleFormPage forcedModuleKey="patients" /></BlockSuperAdmin>} />
                <Route path="/modules/doctors/new" element={<ModuleFormPage forcedModuleKey="doctors" />} />

                {/* ── Appointment redirects ── */}
                <Route path="/modules/appointments" element={<BlockSuperAdmin><Navigate to="/workflows/appointments" replace /></BlockSuperAdmin>} />
                <Route path="/modules/appointments/new" element={<BlockSuperAdmin><Navigate to="/workflows/appointments/new" replace /></BlockSuperAdmin>} />
                <Route path="/modules/appointments/:id/edit" element={<BlockSuperAdmin><Navigate to="/workflows/appointments" replace /></BlockSuperAdmin>} />
                <Route path="/modules/appointments/:id" element={<BlockSuperAdmin><RedirectToAppointment /></BlockSuperAdmin>} />

                {/* ── Profile detail pages ── */}
                <Route path="/modules/patients/:id" element={<BlockSuperAdmin><BlockDoctor><PatientProfilePage /></BlockDoctor></BlockSuperAdmin>} />
                <Route path="/modules/doctors/:id" element={<DoctorSetupFlowPage />} />

                {/* ── Generic module CRUD ── */}
                <Route path="/modules/:moduleKey" element={<ModuleListPage />} />
                <Route path="/modules/clinics/new" element={<Navigate to="/workflows/onboard-clinic" replace />} />
                <Route path="/modules/:moduleKey/new" element={<ModuleFormPage />} />
                <Route path="/modules/:moduleKey/:id/edit" element={<ModuleFormPage />} />
                <Route path="/modules/:moduleKey/:id" element={<ModuleViewPage />} />

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
        </Layout>
    );
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
                path="*"
                element={
                    <Protected>
                        <AuthenticatedShell />
                    </Protected>
                }
            />
        </Routes>
    );
}
