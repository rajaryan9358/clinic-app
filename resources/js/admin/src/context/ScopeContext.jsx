import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

const ScopeContext = createContext(null);

const DEFAULT_LOCK_MESSAGE = "Your clinic's subscription is inactive. Contact your clinic admin to renew.";

export function ScopeProvider({ children }) {
    const [context, setContext] = useState(null);
    const [loading, setLoading] = useState(false);
    const [subscriptionLocked, setSubscriptionLocked] = useState(null); // null | { message }

    const refresh = async () => {
        try {
            localStorage.removeItem('active_branch_id');
        } catch {
            // ignore storage access errors (private browsing, blocked storage, etc.)
        }

        setLoading(true);
        try {
            const { data } = await client.get('/clinic/me/context');
            setContext(data.data);

            if (data?.data?.active_doctor_id) {
                localStorage.setItem('active_doctor_id', String(data.data.active_doctor_id));
            }

            if (data?.data?.subscription?.allows_access === false) {
                setSubscriptionLocked({ message: DEFAULT_LOCK_MESSAGE });
            } else {
                setSubscriptionLocked(null);
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
                setSubscriptionLocked(null);
                localStorage.removeItem('active_doctor_id');
            }
        };

        const onSubscriptionRequired = (event) => {
            setSubscriptionLocked({ message: event?.detail?.message || DEFAULT_LOCK_MESSAGE });
        };

        onAuthChanged();
        window.addEventListener('auth:changed', onAuthChanged);
        window.addEventListener('subscription-required', onSubscriptionRequired);
        return () => {
            window.removeEventListener('auth:changed', onAuthChanged);
            window.removeEventListener('subscription-required', onSubscriptionRequired);
        };
    }, []);

    const setActiveDoctorId = (doctorId) => {
        if (!doctorId) return;
        localStorage.setItem('active_doctor_id', String(doctorId));
        refresh();
    };

    const value = useMemo(
        () => ({ context, loading, refresh, setActiveDoctorId, subscriptionLocked }),
        [context, loading, subscriptionLocked]
    );

    return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
    return useContext(ScopeContext);
}
