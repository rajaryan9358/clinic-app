import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppIcon from '../../components/AppIcon';
import { Alert, Card, PageHeader, btn, input, label } from '../../components/ui';

function Field({ label: text, required, children, hint }) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    return (
        <div>
            <label htmlFor={id} className={label}>
                {text}{required && <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>}
            </label>
            {React.cloneElement(children, { id, 'aria-describedby': hintId, 'aria-required': required || undefined })}
            {hint && <p id={hintId} className="mt-1 text-xs text-slate-600">{hint}</p>}
        </div>
    );
}

function TextInput({ value, onChange, placeholder, type = 'text', ...rest }) {
    return (
        <input
            {...rest}
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={input}
        />
    );
}

function SelectInput({ value, onChange, options, ...rest }) {
    return (
        <select
            {...rest}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={input}
        >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

function SectionCard({ title, subtitle, children }) {
    return (
        <Card title={title} description={subtitle} bodyClassName="space-y-4 p-5">
            {children}
        </Card>
    );
}

const STEPS = [
    { num: 1, label: 'Profile' },
    { num: 2, label: 'Schedule & fees' },
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
            <div className="mx-auto max-w-3xl">
                <Card title="Use the clinic screens" description="Doctor setup from this wizard is intended for clinic users. Super admin can add doctors from the clinic detail page.">
                    <Link to="/dashboard" className={btn.primary}>Go to dashboard</Link>
                </Card>
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
        <div className="mx-auto max-w-3xl space-y-5">
            <PageHeader
                title="Add doctor"
                subtitle="Set up a doctor profile with schedule and fees."
                actions={<Link to="/dashboard" className={btn.secondary}>Back</Link>}
            />

            {/* Steps */}
            <ol aria-label="Steps" className="flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
                {STEPS.map((s, i) => (
                    <React.Fragment key={s.num}>
                        <li className="flex items-center gap-2" aria-current={step === s.num ? 'step' : undefined}>
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                step === s.num ? 'bg-blue-600 text-white'
                                : step > s.num ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}>{step > s.num ? <AppIcon name="check" className="h-3.5 w-3.5" /> : s.num}</span>
                            <span className={`text-sm ${step === s.num ? 'font-semibold text-slate-900' : step > s.num ? 'font-medium text-slate-700' : 'text-slate-600'} ${step === s.num ? '' : 'hidden sm:inline'}`}>{s.label}</span>
                        </li>
                        {i < STEPS.length - 1 && <li aria-hidden="true" className="mx-3 h-px flex-1 bg-slate-200" />}
                    </React.Fragment>
                ))}
            </ol>

            {error && <Alert>{error}</Alert>}

            {/* Step 1 — Profile */}
            {step === 1 && (
                <SectionCard title="Doctor profile" subtitle="Personal and professional information.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                        <Field label="Title">
                            <SelectInput value={values.title} onChange={set('title')} options={[
                                { value: 'Dr.', label: 'Dr.' },
                                { value: 'Prof.', label: 'Prof.' },
                                { value: 'Mr.', label: 'Mr.' },
                                { value: 'Ms.', label: 'Ms.' },
                            ]} />
                        </Field>
                        <div className="sm:col-span-3">
                            <Field label="Full name" required>
                                <TextInput value={values.full_name} onChange={set('full_name')} placeholder="Doctor's full name" />
                            </Field>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Specialization">
                            <TextInput value={values.specialization} onChange={set('specialization')} placeholder="e.g. Cardiologist" />
                        </Field>
                        <Field label="Qualification">
                            <TextInput value={values.qualification} onChange={set('qualification')} placeholder="e.g. MBBS, MD" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Experience (years)">
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
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Phone">
                            <TextInput value={values.phone} onChange={set('phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                        <Field label="Email">
                            <TextInput type="email" value={values.email} onChange={set('email')} placeholder="doctor@clinic.com" />
                        </Field>
                    </div>
                    <div className="flex justify-end border-t border-slate-100 pt-4">
                        <button type="button" onClick={() => nextStep(1)} className={btn.primary}>
                            Next
                        </button>
                    </div>
                </SectionCard>
            )}

            {/* Step 2 — Schedule & Fees */}
            {step === 2 && (
                <SectionCard title="Schedule & fees" subtitle="Appointment slot configuration and consultation fees.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Consultation fee (₹)">
                            <TextInput type="number" value={values.consultation_fee} onChange={set('consultation_fee')} placeholder="500" />
                        </Field>
                        <Field label="Follow-up fee (₹)">
                            <TextInput type="number" value={values.followup_fee} onChange={set('followup_fee')} placeholder="300" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Slot duration (minutes)" hint="Length of each appointment slot.">
                            <TextInput type="number" value={values.slot_duration_minutes} onChange={set('slot_duration_minutes')} placeholder="15" />
                        </Field>
                        <Field label="Buffer time (minutes)" hint="Gap between consecutive slots.">
                            <TextInput type="number" value={values.buffer_time_minutes} onChange={set('buffer_time_minutes')} placeholder="5" />
                        </Field>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-slate-100 pt-4">
                        <button type="button" onClick={() => { setError(''); setStep(1); }} className={btn.secondary}>
                            Back
                        </button>
                        <button type="button" onClick={() => nextStep(2)} className={btn.primary}>
                            Next
                        </button>
                    </div>
                </SectionCard>
            )}

            {/* Step 3 — Login */}
            {step === 3 && (
                <div className="space-y-4">
                    <SectionCard title="Doctor login" subtitle="Optional. Create login credentials so the doctor can access the portal.">
                        <Field label="Password" hint="Leave blank to skip login creation.">
                            <TextInput type="password" value={values.password} onChange={set('password')} placeholder="••••••••" />
                        </Field>
                        {doctorRoles.items.length > 1 ? (
                            <Field label="Login role" hint="Which doctor-kind role this login gets.">
                                <SelectInput
                                    value={values.login_role}
                                    onChange={set('login_role')}
                                    options={doctorRoles.items.map((r) => ({ value: r.name, label: r.label }))}
                                />
                            </Field>
                        ) : null}
                    </SectionCard>

                    <div className="flex justify-between gap-2">
                        <button type="button" onClick={() => { setError(''); setStep(2); }} className={btn.secondary}>
                            Back
                        </button>
                        <button
                            type="button"
                            onClick={submit}
                            disabled={saving}
                            className={btn.primary}
                        >
                            {saving ? 'Creating…' : 'Create doctor'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
