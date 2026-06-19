import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import FormRenderer from '../../components/FormRenderer';
import { useAuth } from '../../context/AuthContext';

const text = (key, label, required = false) => ({ key, label, type: 'text', required });
const select = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });
const checkbox = (key, label) => ({ key, label, type: 'checkbox' });

export default function CreateBranchWizardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [values, setValues] = useState({
        name: '',
        code: '',
        phone: '',
        email: '',
        is_main_branch: false,
        status: 'active',
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const fields = [
        text('name', 'Branch Name', true),
        text('code', 'Code'),
        text('phone', 'Phone'),
        text('email', 'Email'),
        checkbox('is_main_branch', 'Main Branch'),
        select('status', 'Status', ['active', 'inactive']),
    ];

    const submit = async () => {
        setSaving(true);
        setError('');
        try {
            await client.post(`${base}/branches`, values);
            navigate('/modules/branches');
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to create branch');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div>
                    <h2 className="text-xl font-semibold">Add Branch (Guided)</h2>
                    <p className="mt-1 text-sm text-slate-600">Creates a branch for the current clinic scope.</p>
                </div>
                <Link to="/dashboard" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Back</Link>
            </div>

            <FormRenderer
                title="Branch Details"
                fields={fields}
                values={values}
                error={error}
                onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
                onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                }}
                onCancel={() => navigate('/dashboard')}
                submitLabel={saving ? 'Creating…' : 'Create Branch'}
            />
        </div>
    );
}
