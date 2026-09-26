import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useScope } from '../../context/ScopeContext';

export default function MyDoctorProfilePage() {
    const { context, refresh, roleKind, ready } = useScope() || {};
    const location = useLocation();

    useEffect(() => {
        if (roleKind === 'doctor') refresh?.();
    }, [roleKind]);

    // Wait for the scope context to load before deciding: roleKind is empty
    // during that brief window, and redirecting on that would incorrectly
    // bounce a real doctor off their own profile on page load.
    if (ready && roleKind !== 'doctor') {
        return <Navigate to="/dashboard" replace />;
    }

    const doctorId = context?.active_doctor_id;
    if (!doctorId) {
        return null;
    }

    return <Navigate to={`/modules/doctors/${doctorId}${location.search || ''}`} replace />;
}
