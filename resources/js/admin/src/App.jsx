import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './context/AuthContext';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ModuleFormPage from './pages/ModuleFormPage';
import ModuleListPage from './pages/ModuleListPage';
import ModuleViewPage from './pages/ModuleViewPage';
import CreateStaffWizardPage from './pages/workflows/CreateStaffWizardPage';
import OnboardClinicWizardPage from './pages/workflows/OnboardClinicWizardPage';
import SetupDoctorWizardPage from './pages/workflows/SetupDoctorWizardPage';
import AppointmentsFlowPage from './pages/workflows/AppointmentsFlowPage';
import PrescriptionPage from './pages/workflows/PrescriptionPage';
import PatientProfilePage from './pages/workflows/PatientProfilePage';
import DoctorSetupFlowPage from './pages/workflows/DoctorSetupFlowPage';
import CommunicationDeliveryIssuesPage from './pages/workflows/CommunicationDeliveryIssuesPage';
import MyDoctorProfilePage from './pages/workflows/MyDoctorProfilePage';
import DoctorAvailabilityPage from './pages/workflows/DoctorAvailabilityPage';
import ClinicDetailPage from './pages/workflows/ClinicDetailPage';
import ClinicProfilePage from './pages/workflows/ClinicProfilePage';
import SystemSettingsPage from './pages/workflows/SystemSettingsPage';

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
    const { user } = useAuth();
    if (user?.role === 'doctor') return <Navigate to="/workflows/appointments" replace />;
    return children;
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
                path="*"
                element={
                    <Protected>
                        <Layout>
                            <Routes>
                                <Route path="/dashboard" element={<DashboardPage />} />

                                {/* ── Super Admin Workflows ── */}
                                <Route path="/workflows/onboard-clinic" element={<OnlySuperAdmin><OnboardClinicWizardPage /></OnlySuperAdmin>} />
                                <Route path="/workflows/clinics" element={<OnlySuperAdmin><ModuleListPage forcedModuleKey="clinics" /></OnlySuperAdmin>} />
                                <Route path="/workflows/clinics/:id" element={<OnlySuperAdmin><ClinicDetailPage /></OnlySuperAdmin>} />
                                <Route path="/workflows/system-settings" element={<OnlySuperAdmin><SystemSettingsPage /></OnlySuperAdmin>} />

                                {/* ── Clinic Admin Workflows ── */}
                                <Route path="/workflows/clinic-profile" element={<BlockSuperAdmin><ClinicProfilePage /></BlockSuperAdmin>} />

                                {/* ── Shared Workflows ── */}
                                <Route path="/workflows/create-staff" element={<CreateStaffWizardPage />} />
                                <Route path="/workflows/setup-doctor" element={<SetupDoctorWizardPage />} />
                                <Route path="/workflows/appointments" element={<BlockSuperAdmin><AppointmentsFlowPage /></BlockSuperAdmin>} />
                                <Route path="/workflows/appointments/new" element={<BlockSuperAdmin><ModuleFormPage forcedModuleKey="appointments" /></BlockSuperAdmin>} />
                                <Route path="/workflows/appointments/:id/prescription" element={<BlockSuperAdmin><PrescriptionPage /></BlockSuperAdmin>} />
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
                                <Route path="/modules/appointments/:id" element={<BlockSuperAdmin><Navigate to="/workflows/appointments" replace /></BlockSuperAdmin>} />

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
                    </Protected>
                }
            />
        </Routes>
    );
}
