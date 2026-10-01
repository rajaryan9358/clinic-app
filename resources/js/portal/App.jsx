import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import { Spinner } from './components/ui';
import Book from './pages/Book';
import Consent from './pages/Consent';
import Family from './pages/Family';
import Home from './pages/Home';
import Login from './pages/Login';
import MagicLink from './pages/MagicLink';
import PrescriptionDetail from './pages/PrescriptionDetail';
import Prescriptions from './pages/Prescriptions';
import Reschedule from './pages/Reschedule';
import VisitDetail from './pages/VisitDetail';
import Visits from './pages/Visits';
import WaitlistOffer from './pages/WaitlistOffer';
import { useSession } from './session';

function FullPageLoader() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
            <Spinner className="h-6 w-6 text-slate-400" />
        </div>
    );
}

function RequireAuth({ children }) {
    const { me, loading } = useSession();
    if (loading) return <FullPageLoader />;
    if (!me) return <Navigate to="/login" replace />;
    return children;
}

// Layout route for every feature page: must be signed in AND have the
// acting profile's consent current, otherwise bounce to /login or
// /consent respectively before rendering the shell at all.
function ProtectedLayout() {
    const { me, loading, activeProfile } = useSession();
    if (loading) return <FullPageLoader />;
    if (!me) return <Navigate to="/login" replace />;
    if (activeProfile && !activeProfile.consent_current) return <Navigate to="/consent" replace />;
    return <Shell />;
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/login/:token" element={<MagicLink />} />
            <Route
                path="/consent"
                element={
                    <RequireAuth>
                        <Consent />
                    </RequireAuth>
                }
            />

            <Route element={<ProtectedLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/visits" element={<Visits />} />
                <Route path="/visits/:id" element={<VisitDetail />} />
                <Route path="/visits/:id/reschedule" element={<Reschedule />} />
                <Route path="/prescriptions" element={<Prescriptions />} />
                <Route path="/prescriptions/:id" element={<PrescriptionDetail />} />
                <Route path="/book" element={<Book />} />
                <Route path="/family" element={<Family />} />
                <Route path="/waitlist/:id" element={<WaitlistOffer />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
