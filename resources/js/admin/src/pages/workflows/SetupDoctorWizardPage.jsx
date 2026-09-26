import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function Field({ label, required, children, hint }) {
    return (
        <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">
                {label}{required && <span className="ml-0.5 text-red-500">*</span>}
            </label>
            {children}
            {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
    );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
    return (
        <input
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
    );
}

function SelectInput({ value, onChange, options }) {
    return (
        <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

function SectionCard({ title, subtitle, children }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 border-b border-gray-100 pb-4">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

const STEPS = [
    { num: 1, label: 'Profile' },
    { num: 2, label: 'Schedule & Fees' },
    { num: 3, label: 'Login' },
];

export default function SetupDoctorWizardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isClinic = user?.role !== 'super_admin';
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [step, setStep] = useState(1);
    const [values, setValues] = useState({
        title: 'Dr.',
        full_name: '',
        specialization: '',
        qualification: '',
        experience_years: '',
        phone: '',
        email: '',
        gender: '',
        consultation_fee: '',
        followup_fee: '',
        slot_duration_minutes: '15',
        buffer_time_minutes: '5',
        status: 'active',
        password: '',
        login_role: 'doctor',
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    // Doctor-kind roles for the optional "Login role" picker (Task 7): the
    // system `doctor` role always exists, so this list starts non-empty and
    // a custom doctor-kind role (created in the super admin Roles page)
    // simply appears alongside it. If the actor lacks staff.view (the
    // permission this endpoint's default branch is gated on — its
    // `?kind=doctor` branch reuses the same gate) the picker just falls back
    // to the plain "Doctor" default below.
    const [doctorRoles, setDoctorRoles] = useState({ loading: true, items: [] });

    useEffect(() => {
        if (!isClinic) return;
        let cancelled = false;
        client.get('/clinic/roles', { params: { kind: 'doctor' } })
            .then((res) => {
                if (cancelled) return;
                const items = Array.isArray(res.data?.data) ? res.data.data : [];
                setDoctorRoles({ loading: false, items });
            })
            .catch(() => {
                if (cancelled) return;
                setDoctorRoles({ loading: false, items: [] });
            });
        return () => { cancelled = true; };
    }, [isClinic]);

    if (!isClinic) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Use the Clinic screens</h2>
                <p className="mt-1 text-sm text-gray-500">Doctor setup from this wizard is intended for clinic users. Super admin can add doctors from the clinic detail page.</p>
                <Link to="/dashboard" className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Go to Dashboard
                </Link>
            </div>
        );
    }

    const set = (key) => (v) => setValues((p) => ({ ...p, [key]: v }));

    const nextStep = (from) => {
        setError('');
        if (from === 1 && !values.full_name) { setError('Doctor name is required.'); return; }
        setStep(from + 1);
    };

    const submit = async () => {
        if (!values.full_name) { setError('Doctor name is required.'); return; }
        setSaving(true);
        setError('');
        try {
            const payload = {
                title: values.title,
                full_name: values.full_name,
                specialization: values.specialization || null,
                qualification: values.qualification || null,
                experience_years: values.experience_years !== '' ? Number(values.experience_years) : null,
                phone: values.phone || null,
                email: values.email || null,
                gender: values.gender || null,
                consultation_fee: values.consultation_fee !== '' ? Number(values.consultation_fee) : null,
                followup_fee: values.followup_fee !== '' ? Number(values.followup_fee) : null,
                slot_duration_minutes: values.slot_duration_minutes !== '' ? Number(values.slot_duration_minutes) : 15,
                buffer_time_minutes: values.buffer_time_minutes !== '' ? Number(values.buffer_time_minutes) : 5,
                status: values.status,
            };

            const password = String(values.password || '').trim();
            if (password) {
                payload.create_linked_user = true;
                payload.linked_user = {
                    full_name: values.full_name || undefined,
                    email: values.email || undefined,
                    phone: values.phone || undefined,
                    password,
                    role: values.login_role || undefined,
                };
            }

            await client.post(`${base}/doctors`, payload);
            navigate('/modules/doctors');
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to create doctor');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Add Doctor</h2>
                    <p className="mt-0.5 text-sm text-gray-500">Set up a doctor profile with schedule and fees.</p>
                </div>
                <Link to="/dashboard" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                    ← Back
                </Link>
            </div>

            {/* Steps */}
            <div className="flex items-center gap-0 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
                {STEPS.map((s, i) => (
                    <React.Fragment key={s.num}>
                        <div className="flex items-center gap-2">
                            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                step === s.num ? 'bg-blue-600 text-white'
                                : step > s.num ? 'bg-emerald-500 text-white'
                                : 'bg-gray-100 text-gray-400'
                            }`}>{step > s.num ? '✓' : s.num}</div>
                            <span className={`text-sm font-semibold ${step === s.num ? 'text-gray-900' : step > s.num ? 'text-emerald-600' : 'text-gray-400'}`}>{s.label}</span>
                        </div>
                        {i < STEPS.length - 1 && <div className="mx-3 h-px flex-1 bg-gray-200" />}
                    </React.Fragment>
                ))}
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {/* Step 1 — Profile */}
            {step === 1 && (
                <SectionCard title="Doctor Profile" subtitle="Personal and professional information.">
                    <div className="grid grid-cols-4 gap-3">
                        <Field label="Title">
                            <SelectInput value={values.title} onChange={set('title')} options={[
                                { value: 'Dr.', label: 'Dr.' },
                                { value: 'Prof.', label: 'Prof.' },
                                { value: 'Mr.', label: 'Mr.' },
                                { value: 'Ms.', label: 'Ms.' },
                            ]} />
                        </Field>
                        <div className="col-span-3">
                            <Field label="Full Name" required>
                                <TextInput value={values.full_name} onChange={set('full_name')} placeholder="Doctor's full name" />
                            </Field>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Specialization">
                            <TextInput value={values.specialization} onChange={set('specialization')} placeholder="e.g. Cardiologist" />
                        </Field>
                        <Field label="Qualification">
                            <TextInput value={values.qualification} onChange={set('qualification')} placeholder="e.g. MBBS, MD" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <Field label="Experience (Years)">
                            <TextInput type="number" value={values.experience_years} onChange={set('experience_years')} placeholder="0" />
                        </Field>
                        <Field label="Gender">
                            <SelectInput value={values.gender} onChange={set('gender')} options={[
                                { value: '', label: 'Select…' },
                                { value: 'male', label: 'Male' },
                                { value: 'female', label: 'Female' },
                                { value: 'other', label: 'Other' },
                            ]} />
                        </Field>
                        <Field label="Status">
                            <SelectInput value={values.status} onChange={set('status')} options={[
                                { value: 'active', label: 'Active' },
                                { value: 'inactive', label: 'Inactive' },
                            ]} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Phone">
                            <TextInput value={values.phone} onChange={set('phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                        <Field label="Email">
                            <TextInput type="email" value={values.email} onChange={set('email')} placeholder="doctor@clinic.com" />
                        </Field>
                    </div>
                    <div className="flex justify-end pt-2">
                        <button type="button" onClick={() => nextStep(1)} className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                            Next →
                        </button>
                    </div>
                </SectionCard>
            )}

            {/* Step 2 — Schedule & Fees */}
            {step === 2 && (
                <SectionCard title="Schedule & Fees" subtitle="Appointment slot configuration and consultation fees.">
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Consultation Fee (₹)">
                            <TextInput type="number" value={values.consultation_fee} onChange={set('consultation_fee')} placeholder="500" />
                        </Field>
                        <Field label="Follow-up Fee (₹)">
                            <TextInput type="number" value={values.followup_fee} onChange={set('followup_fee')} placeholder="300" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Slot Duration (minutes)" hint="Length of each appointment slot.">
                            <TextInput type="number" value={values.slot_duration_minutes} onChange={set('slot_duration_minutes')} placeholder="15" />
                        </Field>
                        <Field label="Buffer Time (minutes)" hint="Gap between consecutive slots.">
                            <TextInput type="number" value={values.buffer_time_minutes} onChange={set('buffer_time_minutes')} placeholder="5" />
                        </Field>
                    </div>
                    <div className="flex justify-between pt-2">
                        <button type="button" onClick={() => { setError(''); setStep(1); }} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                            ← Back
                        </button>
                        <button type="button" onClick={() => nextStep(2)} className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                            Next →
                        </button>
                    </div>
                </SectionCard>
            )}

            {/* Step 3 — Login */}
            {step === 3 && (
                <div className="space-y-4">
                    <SectionCard title="Doctor Login" subtitle="Optional — create login credentials so the doctor can access the portal.">
                        <Field label="Password" hint="Leave blank to skip login creation.">
                            <TextInput type="password" value={values.password} onChange={set('password')} placeholder="••••••••" />
                        </Field>
                        {doctorRoles.items.length > 1 ? (
                            <Field label="Login Role" hint="Which doctor-kind role this login gets.">
                                <SelectInput
                                    value={values.login_role}
                                    onChange={set('login_role')}
                                    options={doctorRoles.items.map((r) => ({ value: r.name, label: r.label }))}
                                />
                            </Field>
                        ) : null}
                    </SectionCard>

                    <div className="flex justify-between pt-1">
                        <button type="button" onClick={() => { setError(''); setStep(2); }} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                            ← Back
                        </button>
                        <button
                            type="button"
                            onClick={submit}
                            disabled={saving}
                            className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {saving ? 'Creating…' : 'Create Doctor ✓'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
