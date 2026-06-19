import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';

export default function BranchProfilePage() {
    const { user } = useAuth();
    const { context } = useScope() || {};
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user?.role]);

    if (user?.role === 'super_admin') {
        return <Navigate to="/dashboard" replace />;
    }

    if (user?.role !== 'branch_manager') {
        return <Navigate to="/dashboard" replace />;
    }

    const activeBranchId = context?.active_branch_id;
    const activeBranch = (context?.allowed_branches || []).find((b) => String(b.id) === String(activeBranchId));

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [values, setValues] = useState({
        booking_enabled: true,
        walkin_enabled: true,
        token_system_enabled: false,
        max_advance_booking_days: 30,
        min_booking_notice_minutes: 0,
    });

    useEffect(() => {
        if (!activeBranchId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');
        client.get(`${base}/settings/branch`, { params: { branch_id: activeBranchId, per_page: 1 } })
            .then((res) => {
                const item = Array.isArray(res.data?.data) ? res.data.data[0] : null;
                if (!item) return;
                setValues({
                    booking_enabled: Boolean(item.booking_enabled),
                    walkin_enabled: Boolean(item.walkin_enabled),
                    token_system_enabled: Boolean(item.token_system_enabled),
                    max_advance_booking_days: item.max_advance_booking_days ?? 30,
                    min_booking_notice_minutes: item.min_booking_notice_minutes ?? 0,
                });
            })
            .catch((e) => setError(e?.response?.data?.message || 'Failed to load branch settings'))
            .finally(() => setLoading(false));
    }, [activeBranchId, base]);

    const setField = (key, nextValue) => setValues((p) => ({ ...p, [key]: nextValue }));

    const handleSave = async () => {
        if (!activeBranchId) return;
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            await client.post(`${base}/settings/branch`, {
                branch_id: activeBranchId,
                booking_enabled: Boolean(values.booking_enabled),
                walkin_enabled: Boolean(values.walkin_enabled),
                token_system_enabled: Boolean(values.token_system_enabled),
                max_advance_booking_days: Number(values.max_advance_booking_days || 0),
                min_booking_notice_minutes: Number(values.min_booking_notice_minutes || 0),
            });
            setSuccess('Branch settings updated successfully.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-gray-900">Branch Profile</h1>
                <p className="mt-0.5 text-sm text-gray-500">Settings for your active branch.</p>
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Branch</p>
                <div className="text-sm text-gray-900">
                    {activeBranch?.name ? activeBranch.name : activeBranchId ? `Branch #${activeBranchId}` : 'No active branch'}
                </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Booking</p>

                <div className="space-y-3">
                    {[{ key: 'booking_enabled', label: 'Booking Enabled' }, { key: 'walkin_enabled', label: 'Walk-in Enabled' }, { key: 'token_system_enabled', label: 'Token System Enabled' }].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <input
                                type="checkbox"
                                checked={Boolean(values[key])}
                                onChange={(e) => setField(key, e.target.checked)}
                                className="h-4 w-4"
                            />
                            <span className="text-sm font-medium text-gray-800">{label}</span>
                        </label>
                    ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Max Advance Booking Days</p>
                        <input
                            type="number"
                            value={values.max_advance_booking_days}
                            onChange={(e) => setField('max_advance_booking_days', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Min Booking Notice Minutes</p>
                        <input
                            type="number"
                            value={values.min_booking_notice_minutes}
                            onChange={(e) => setField('min_booking_notice_minutes', e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving || !activeBranchId} className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}
