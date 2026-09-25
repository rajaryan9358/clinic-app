import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import FormRenderer from '../../components/FormRenderer';
import { allowedStaffRolesForCreator } from '../../config/access';
import { useAuth } from '../../context/AuthContext';

const text = (key, label, required = false) => ({ key, label, type: 'text', required });
const select = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });

export default function CreateStaffWizardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isClinic = user?.role !== 'super_admin';
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const roleOptions = useMemo(() => {
        // Clinic wizard never creates super_admin / clinic_admin.
        return allowedStaffRolesForCreator(user?.role).filter((r) => !['super_admin', 'clinic_admin'].includes(String(r)));
    }, [user?.role]);

    const [values, setValues] = useState({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        role: 'receptionist',
        status: 'active',
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!roleOptions.length) return;
        if (!roleOptions.includes(String(values.role || ''))) {
            setValues((p) => ({ ...p, role: roleOptions[0] }));
        }
    }, [roleOptions, values.role]);

    if (!isClinic) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Use the Super Admin flows</h2>
                <p className="mt-1 text-sm text-slate-600">Staff creation from this wizard is intended for clinic users.</p>
                <Link to="/dashboard" className="mt-4 inline-block rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Go to Dashboard</Link>
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
            await client.post(`${base}/users`, values);
            navigate('/modules/users');
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to create staff user');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div>
                    <h2 className="text-xl font-semibold">Add Staff (Guided)</h2>
                    <p className="mt-1 text-sm text-slate-600">Staff Details</p>
                </div>
                <Link to="/dashboard" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Back</Link>
            </div>

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
