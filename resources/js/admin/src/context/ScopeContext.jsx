import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

const ScopeContext = createContext(null);

const DEFAULT_LOCK_MESSAGE = "Your clinic's subscription is inactive. Contact your clinic admin to renew.";

export function ScopeProvider({ children }) {
    const [context, setContext] = useState(null);
    const [loading, setLoading] = useState(false);
    // Flips true once the first /clinic/me/context call (success or failure) has
    // settled. Used by `can()` below to avoid bouncing a permitted user off a page
    // during the brief window before permissions have loaded for the first time.
    const [ready, setReady] = useState(false);
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
            setReady(true);
        }
    };

    useEffect(() => {
        const onAuthChanged = () => {
            const token = localStorage.getItem('auth_token');
            if (token) {
                // Reset the gate before fetching: without this, an in-tab
                // login right after a logout (or right after the initial
                // "no token yet" resolution) would leave `ready` stuck at
                // its previous `true` value while the new user's context is
                // still in flight, letting pages mount against stale/empty
                // permissions instead of waiting for the real ones.
                setReady(false);
                refresh();
            } else {
                setContext(null);
                setSubscriptionLocked(null);
                setReady(true);
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

    // Permission check: clinic_admin and super_admin kinds always pass (they hold the
    // full catalogue); everyone else is checked against the permissions list from
    // /clinic/me/context. Super admin has no clinic context at all, so `can` still
    // needs to return true for them.
    //
    // Fails CLOSED before the first context fetch has settled: returning
    // true here (fail-open) let a page render one way with `!ready`, then
    // re-render a different way once the real permissions arrived — an
    // early-return based on `can()` running conditionally between two
    // renders of the same mounted component changes how many hooks it
    // calls and crashes React ("Rendered fewer hooks than expected"). The
    // caller (AuthenticatedShell) is responsible for not mounting any
    // permission-gated page until `ready` is true in the first place.
    const can = useCallback((permission) => {
        if (!ready) return false;
        const kind = context?.role_kind;
        if (kind === 'clinic_admin' || kind === 'super_admin') return true;
        if (!permission) return true;
        return (context?.permissions || []).includes(permission);
    }, [context, ready]);

    const value = useMemo(
        () => ({
            context,
            loading,
            ready,
            refresh,
            setActiveDoctorId,
            subscriptionLocked,
            can,
            roleKind: context?.role_kind,
            roleLabel: context?.role_label,
        }),
        [context, loading, ready, subscriptionLocked, can]
    );

    return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
    return useContext(ScopeContext);
}
