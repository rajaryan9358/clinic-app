import { useEffect, useState } from 'react';
import client from '../api/client';

/**
 * Fetches the roles a staff form may offer to assign, for either the clinic
 * actor (`GET /clinic/roles`, already filtered server-side to staff kind
 * plus clinic_admin when the actor is clinic_admin kind — spec §4) or the
 * super admin actor (`GET /super-admin/roles`, which lists every kind except
 * the hidden super_admin role, so it's filtered here to staff/clinic_admin —
 * doctor-kind roles are never offered on a staff form, spec §4/§5).
 *
 * `base` is `/clinic` or `/super-admin` (see `useAuth`-derived `base` used
 * throughout the admin SPA). Pass a falsy value to skip fetching (e.g. while
 * a page's moduleKey isn't `users` yet).
 */
export function useAssignableRoles(base) {
    const [state, setState] = useState({ loading: Boolean(base), error: '', roles: [] });

    useEffect(() => {
        if (!base) {
            setState({ loading: false, error: '', roles: [] });
            return;
        }

        let cancelled = false;
        setState((prev) => ({ ...prev, loading: true, error: '' }));

        const endpoint = base === '/super-admin' ? '/super-admin/roles' : '/clinic/roles';

        client.get(endpoint)
            .then((res) => {
                if (cancelled) return;
                const all = Array.isArray(res.data?.data) ? res.data.data : [];
                const roles = base === '/super-admin'
                    ? all.filter((r) => ['staff', 'clinic_admin'].includes(String(r?.kind)))
                    : all;
                setState({ loading: false, error: '', roles });
            })
            .catch((e) => {
                if (cancelled) return;
                setState({ loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load roles', roles: [] });
            });

        return () => { cancelled = true; };
    }, [base]);

    return state;
}
