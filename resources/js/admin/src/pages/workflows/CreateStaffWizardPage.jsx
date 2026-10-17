import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import FormRenderer from '../../components/FormRenderer';
import { useAssignableRoles } from '../../hooks/useAssignableRoles';
import { useAuth } from '../../context/AuthContext';
import Skeleton from '../../components/Skeleton';

const text = (key, label, required = false) => ({ key, label, type: 'text', required });
const select = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });
const relation = (key, label, resource, multiple = false) => ({ key, label, type: 'relation', resource, multiple });

export default function CreateStaffWizardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isClinic = user?.role !== 'super_admin';

    // This wizard is clinic-only (see the redirect below); `/clinic/roles`
    // already returns staff-kind roles plus clinic_admin when the actor is
    // clinic_admin kind — no further filtering needed here (spec §4).
    const { loading: rolesLoading, roles } = useAssignableRoles(isClinic ? '/clinic' : null);
    const roleOptions = useMemo(() => roles.map((r) => ({ value: r.name, label: r.label })), [roles]);

    const [values, setValues] = useState({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        role: '',
        status: 'active',
        doctor_ids: [],
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!roles.length) return;
        if (roles.some((r) => r.name === values.role)) return;
        const fallback = roles.find((r) => r.name === 'receptionist') || roles[0];
        setValues((p) => ({ ...p, role: fallback.name }));
    }, [roles, values.role]);

    const currentRole = useMemo(() => roles.find((r) => r.name === values.role) || null, [roles, values.role]);

    // Clear a stale doctor selection if the role changes to one that no
    // longer scopes access to assigned doctors (spec §4/§6).
    useEffect(() => {
        if (currentRole?.limit_to_assigned_doctors) return;
        setValues((p) => (p.doctor_ids?.length ? { ...p, doctor_ids: [] } : p));
    }, [currentRole]);

    if (!isClinic) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Use the Super Admin flows</h2>
                <p className="mt-1 text-sm text-slate-600">Staff creation from this wizard is intended for clinic users.</p>
                <Link to="/dashboard" className="mt-4 inline-block rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Go to Dashboard</Link>
            </div>
        );
    }

    const header = (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div>
                <h2 className="text-xl font-semibold">Add Staff (Guided)</h2>
                <p className="mt-1 text-sm text-slate-600">Staff Details</p>
            </div>
            <Link to="/dashboard" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Back</Link>
        </div>
    );

    if (rolesLoading) {
        return (
            <div className="space-y-4">
                {header}
                <Skeleton variant="fields" rows={6} />
            </div>
        );
    }

    if (!roleOptions.length) {
        return <Navigate to="/dashboard" replace />;
    }

    const staffDetailsFields = [
        text('full_name', 'Full Name', true),
        text('email', 'Email'),
        text('phone', 'Phone'),
        text('password', 'Password', true),
        select('role', 'Role', roleOptions, true),
        select('status', 'Status', ['active', 'inactive', 'blocked']),
        ...(currentRole?.limit_to_assigned_doctors ? [relation('doctor_ids', 'Assigned Doctors', 'doctors', true)] : []),
    ];

    const submit = async () => {
        setError('');
        const missing = staffDetailsFields.find((f) => f.required && (values[f.key] === '' || values[f.key] === null || values[f.key] === undefined));
        if (missing) {
            setError(`Please fill ${missing.label}.`);
            return;
        }
        setSaving(true);
        try {
            const payload = { ...values };
            if (!currentRole?.limit_to_assigned_doctors) {
                delete payload.doctor_ids;
            }
            await client.post('/clinic/users', payload);
            navigate('/modules/users');
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to create staff user');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {header}

            <FormRenderer
                title="Staff Details"
                fields={staffDetailsFields}
                values={values}
                error={error}
                onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
                onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                }}
                onCancel={() => navigate('/dashboard')}
                submitLabel={saving ? 'Creating…' : 'Create Staff'}
            />
        </div>
    );
}
