import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useScope } from '../../context/ScopeContext';

export default function MyDoctorProfilePage() {
    const { context, refresh, roleKind } = useScope() || {};
    const location = useLocation();

    useEffect(() => {
        if (roleKind === 'doctor') refresh?.();
    }, [roleKind]);

    if (roleKind !== 'doctor') {
        return <Navigate to="/dashboard" replace />;
    }

    const doctorId = context?.active_doctor_id;
    if (!doctorId) {
        return null;
    }

    return <Navigate to={`/modules/doctors/${doctorId}${location.search || ''}`} replace />;
}
