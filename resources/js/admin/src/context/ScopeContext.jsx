import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

const ScopeContext = createContext(null);

export function ScopeProvider({ children }) {
    const [context, setContext] = useState(null);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        setLoading(true);
        try {
            const { data } = await client.get('/clinic/me/context');
            setContext(data.data);

            if (data?.data?.active_doctor_id) {
                localStorage.setItem('active_doctor_id', String(data.data.active_doctor_id));
            }
        } catch {
            setContext(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const onAuthChanged = () => {
            const token = localStorage.getItem('auth_token');
            if (token) {
                refresh();
            } else {
                setContext(null);
                localStorage.removeItem('active_doctor_id');
            }
        };

        onAuthChanged();
        window.addEventListener('auth:changed', onAuthChanged);
        return () => window.removeEventListener('auth:changed', onAuthChanged);
    }, []);

    const setActiveDoctorId = (doctorId) => {
        if (!doctorId) return;
        localStorage.setItem('active_doctor_id', String(doctorId));
        refresh();
    };

    const value = useMemo(
        () => ({ context, loading, refresh, setActiveDoctorId }),
        [context, loading]
    );

    return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
    return useContext(ScopeContext);
}
