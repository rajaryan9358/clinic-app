import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';

export default function MyDoctorProfilePage() {
    const { user } = useAuth();
    const { context, refresh } = useScope() || {};
    const location = useLocation();

    useEffect(() => {
        if (user?.role === 'doctor') refresh?.();
    }, [user?.role]);

    if (user?.role !== 'doctor') {
        return <Navigate to="/dashboard" replace />;
    }

    const doctorId = context?.active_doctor_id;
    if (!doctorId) {
        return null;
    }

    return <Navigate to={`/modules/doctors/${doctorId}${location.search || ''}`} replace />;
}
