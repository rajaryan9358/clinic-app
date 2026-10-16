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

    // Shared by every login path (OTP verify, magic-link exchange): stores
    // the fresh token, clears any acting-profile left over from a prior
    // session in this tab (via setProfile, not just localStorage, since
    // callers navigate with the router rather than a full reload), and
    // refetches `me` so the caller can navigate once it resolves.
    const completeLogin = useCallback(
        (payload) => {
            localStorage.setItem('portal_token', payload.token);
            setProfile(null);
            return refresh();
        },
        [setProfile, refresh],
    );

    // Where to go after a login whose link carried a `redirect_path` (a
    // waitlist offer: `/waitlist/{id}?profile={patientId}`). Only a
    // same-origin path — starting with a single `/`, no backslashes — is
    // honoured; anything else falls back to `/`. A `profile` query param
    // selects that acting profile, but only if it's one of this account's
    // `me.profiles`; it's stripped from the returned path either way.
    const resolveRedirect = useCallback(
        (meData, redirectPath) => {
            if (typeof redirectPath !== 'string' || !/^\/(?![/\\])/.test(redirectPath) || redirectPath.includes('\\')) {
                return '/';
            }
            let url;
            try {
                url = new URL(redirectPath, window.location.origin);
            } catch {
                return '/';
            }
            if (url.origin !== window.location.origin) return '/';

            const profileParam = url.searchParams.get('profile');
            url.searchParams.delete('profile');
            if (profileParam !== null) {
                const profileId = Number(profileParam);
                if (Number.isInteger(profileId) && meData?.profiles?.some((p) => p.id === profileId)) {
                    setProfile(profileId);
                }
            }

            const path = `${url.pathname}${url.search}${url.hash}`;
            return path.startsWith('/') && !path.startsWith('//') ? path : '/';
        },
        [setProfile],
    );

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
        () => ({ me, loading, refresh, activeProfileId, activeProfile, setProfile, completeLogin, resolveRedirect, logout }),
        [me, loading, refresh, activeProfileId, activeProfile, setProfile, completeLogin, resolveRedirect, logout],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
    return useContext(SessionContext);
}
