import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from './api';

const SessionContext = createContext(null);

/**
 * Patient-portal session state: the signed-in account's `/auth/me`
 * payload (account, profiles, clinics, clinic) and which profile is
 * currently "acting" (sent as X-Patient-Id on every feature request).
 *
 * `me` never changes with the acting profile — GET auth/me always
 * describes the token owner, not the acting patient — so switching
 * profiles is pure client state (see api.js, which reads
 * localStorage.portal_profile per request) while switching *clinics*
 * issues a brand-new token (see components/Shell.jsx) and reloads.
 */
export function SessionProvider({ children }) {
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileId, setProfileId] = useState(() => {
        const stored = localStorage.getItem('portal_profile');
        return stored ? Number(stored) : null;
    });

    const refresh = useCallback(async () => {
        if (!localStorage.getItem('portal_token')) {
            setMe(null);
            setLoading(false);
            return null;
        }

        setLoading(true);
        try {
            const { data } = await api.get('/auth/me');
            setMe(data.data);
            return data.data;
        } catch (err) {
            setMe(null);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const setProfile = useCallback((id) => {
        if (id === null || id === undefined) {
            localStorage.removeItem('portal_profile');
            setProfileId(null);
            return;
        }
        localStorage.setItem('portal_profile', String(id));
        setProfileId(Number(id));
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            // Best effort — still clear the local session either way.
        }
        localStorage.removeItem('portal_token');
        localStorage.removeItem('portal_profile');
        setMe(null);
        setProfileId(null);
    }, []);

    const activeProfileId = profileId ?? me?.account?.id ?? null;
    const activeProfile = useMemo(
        () => me?.profiles?.find((p) => p.id === activeProfileId) ?? null,
        [me, activeProfileId],
    );

    const value = useMemo(
        () => ({ me, loading, refresh, activeProfileId, activeProfile, setProfile, logout }),
        [me, loading, refresh, activeProfileId, activeProfile, setProfile, logout],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
    return useContext(SessionContext);
}
