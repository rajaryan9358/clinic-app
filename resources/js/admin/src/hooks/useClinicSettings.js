import { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { useScope } from '../context/ScopeContext';

/**
 * The clinic's settings record (one per clinic) for a settings page: loads
 * it, tracks edits to the given fields, and saves only what changed.
 */
export default function useClinicSettings(fields) {
    const scope = useScope() || {};
    const canEdit = Boolean(scope.can?.('clinic_settings.edit'));
    const [saved, setSaved] = useState(null);
    const [values, setValues] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const pick = useCallback((record) => Object.fromEntries(fields.map((f) => [f, record?.[f] ?? null])), [fields]);

    useEffect(() => {
        let cancelled = false;
        client.get('/clinic/settings/clinic', { params: { per_page: 1 } })
            .then((r) => {
                if (cancelled) return;
                const record = (r.data?.data || [])[0] || {};
                setSaved(pick(record));
                setValues(pick(record));
            })
            .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || 'Could not load settings.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [pick]);

    const changed = useMemo(() => {
        if (!saved) return {};
        return Object.fromEntries(fields.filter((f) => values[f] !== saved[f]).map((f) => [f, values[f]]));
    }, [fields, saved, values]);
    const dirty = Object.keys(changed).length > 0;

    const set = (field) => (value) => setValues((v) => ({ ...v, [field]: value }));

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const res = await client.post('/clinic/settings/clinic', changed);
            const record = res.data?.data || { ...saved, ...changed };
            setSaved(pick(record));
            setValues(pick(record));
            setNotice('Settings saved.');
            setTimeout(() => setNotice(''), 3000);
        } catch (e) {
            const errs = e?.response?.data?.errors;
            const first = errs && typeof errs === 'object' ? Object.values(errs).flat()[0] : null;
            setError(first || e?.response?.data?.message || 'Could not save settings.');
        } finally {
            setSaving(false);
        }
    };

    const discard = () => { setValues(saved || {}); setError(''); };

    return { values, set, dirty, save, discard, loading, saving, error, setError, notice, canEdit };
}
