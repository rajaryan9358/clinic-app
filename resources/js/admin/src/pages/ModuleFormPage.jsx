import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import client from '../api/client';
import FormRenderer from '../components/FormRenderer';
import { modules } from '../config/modules';
import { allowedStaffRolesForCreator, canAccessModule, canCreateModule, isSuperAdminHiddenModuleKey, NON_CREATABLE_MODULE_KEYS } from '../config/access';
import { useAuth } from '../context/AuthContext';

export default function ModuleFormPage({ forcedModuleKey } = {}) {
    const { moduleKey: routeModuleKey, id } = useParams();
    const moduleKey = forcedModuleKey || routeModuleKey;
    const module = modules[moduleKey];
    const isEdit = Boolean(id);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    if (user?.role === 'super_admin' && isSuperAdminHiddenModuleKey(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }
    
    if (!canAccessModule(user?.role, moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!isEdit && !canCreateModule(user?.role, moduleKey)) {
        return <Navigate to={`/modules/${moduleKey}`} replace />;
    }

    const isAppointmentCreate = moduleKey === 'appointments' && !isEdit;
    const isUserCreate = moduleKey === 'users' && !isEdit;
    const isDoctorCreate = moduleKey === 'doctors' && !isEdit;
    const isUserModule = moduleKey === 'users';

    // Pre-fill appointment fields from query params (e.g. when opened from the doctor calendar).
    const [values, setValues] = useState(() => {
        if (!isAppointmentCreate) return {};
        const pre = {};
        const qDoctor = searchParams.get('doctor_id');
        const qDate   = searchParams.get('appointment_date');
        const qTime   = searchParams.get('start_time');
        if (qDoctor) pre.doctor_id = qDoctor;
        if (qDate)   pre.appointment_date = qDate;
        if (qTime)   pre.start_time = qTime;
        return pre;
    });
    const [error, setError] = useState('');

    const [doctorLoginPassword, setDoctorLoginPassword] = useState('');
    const [patientMobile, setPatientMobile] = useState('');
    const [patientLookup, setPatientLookup] = useState({ loading: false, error: '', results: [] });
    const [createPatientInline, setCreatePatientInline] = useState(false);
    const [inlinePatient, setInlinePatient] = useState({
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
        gender: '',
        dob: '',
        age: '',
    });

    // If doctor is pre-filled, skip straight to the slot-picker step.
    const [appointmentStep, setAppointmentStep] = useState(() => {
        if (!isAppointmentCreate) return 1;
        return searchParams.get('doctor_id') ? 2 : 1;
    });
    const [stepError, setStepError] = useState('');

    const [doctorOptions, setDoctorOptions] = useState({ loading: false, error: '', items: [] });
    const [serviceOptions, setServiceOptions] = useState({ loading: false, error: '', items: [] });

    const fields = module?.formFields || [];
    const fieldsForRenderer = useMemo(() => {
        if (!isAppointmentCreate) {
            if (isUserModule) {
                const allowedRoles = new Set(allowedStaffRolesForCreator(user?.role));
                const currentRole = String(values?.role || '');

                return fields
                    .map((f) => {
                        if (f.key !== 'role' || f.type !== 'select') return f;

                        // If the record's role is outside what this actor can manage, do not
                        // render a dropdown that exposes disallowed roles.
                        if (isEdit && currentRole && !allowedRoles.has(currentRole)) {
                            return { ...f, hidden: true };
                        }

                        const options = Array.isArray(f.options) ? f.options : [];
                        return {
                            ...f,
                            options: options.filter((opt) => allowedRoles.has(typeof opt === 'string' ? opt : opt?.value)),
                        };
                    })
                    .filter((f) => !f?.hidden);
            }
            return fields;
        }
        const alwaysHidden = new Set(['patient_id', 'appointment_date', 'start_time', 'end_time']);

        if (appointmentStep === 1) {
            if (user?.role === 'super_admin') {
                return fields.filter((f) => f.key === 'clinic_id');
            }
            return [];
        }

        if (appointmentStep === 2) {
            return [];
        }

        if (appointmentStep === 3) {
            return [];
        }

        // Step 4: rest of selections
        const step4Hidden = new Set([...alwaysHidden, 'clinic_id', 'doctor_id', 'service_id']);
        return fields.filter((f) => !step4Hidden.has(f.key));
    }, [fields, isAppointmentCreate, appointmentStep, user?.role, isUserModule, isEdit, values?.role]);

    const selectedPatient = useMemo(() => {
        const pid = values?.patient_id;
        if (!pid) return null;
        const list = Array.isArray(patientLookup.results) ? patientLookup.results : [];
        return list.find((p) => String(p.id) === String(pid)) || null;
    }, [patientLookup.results, values?.patient_id]);

    const toYMD = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const availabilityRange = useMemo(() => {
        const from = new Date();
        const to = new Date();
        // Show at least 14 days (including today)
        to.setDate(to.getDate() + 13);
        return { from: toYMD(from), to: toYMD(to) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [availability, setAvailability] = useState({ loading: false, error: '', days: [] });
    const [slotDate, setSlotDate] = useState(() => new Date().toISOString().slice(0, 10));

    const castPayload = (payload) => {
        const parsed = {};
        fields.forEach((field) => {
            const raw = payload[field.key];
            if (raw === '' || raw === null || raw === undefined) {
                return;
            }
            if (field.type === 'relation') {
                if (field.multiple) {
                    const list = Array.isArray(raw) ? raw : [raw];
                    const ids = list
                        .map((v) => Number(v))
                        .filter((n) => Number.isFinite(n));
                    if (ids.length) {
                        parsed[field.key] = ids;
                    }
                    return;
                }
                parsed[field.key] = Number(raw);
                return;
            }
            if (field.type === 'number') {
                parsed[field.key] = Number(raw);
                return;
            }
            if (field.type === 'checkbox') {
                parsed[field.key] = Boolean(raw);
                return;
            }
            parsed[field.key] = raw;
        });
        return parsed;
    };

    useEffect(() => {
        if (!isAppointmentCreate) return;
        setAppointmentStep(1);
        setStepError('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate]);

    useEffect(() => {
        if (!isAppointmentCreate) return;

        const clinicId = values?.clinic_id;
        if (user?.role === 'super_admin' && !clinicId) {
            setServiceOptions({ loading: false, error: '', items: [] });
            return;
        }

        let cancelled = false;
        const load = async () => {
            try {
                setServiceOptions((prev) => ({ ...prev, loading: true, error: '' }));

                const params = { per_page: 200 };
                if (user?.role === 'super_admin') params.clinic_id = clinicId;

                const servicesRes = await client.get(`${base}/services`, { params });

                if (cancelled) return;

                const services = Array.isArray(servicesRes?.data?.data) ? servicesRes.data.data : [];

                setServiceOptions({ loading: false, error: '', items: services });
            } catch (e) {
                if (cancelled) return;
                const msg = e?.response?.data?.message || e?.message || 'Failed to load options';
                setServiceOptions({ loading: false, error: msg, items: [] });
            }
        };

        load();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate, base, user?.role, values?.clinic_id]);

    useEffect(() => {
        if (!isAppointmentCreate) return;

        const clinicId = values?.clinic_id;
        if (user?.role === 'super_admin' && !clinicId) {
            setDoctorOptions({ loading: false, error: '', items: [] });
            return;
        }

        let cancelled = false;
        const load = async () => {
            try {
                setDoctorOptions((prev) => ({ ...prev, loading: true, error: '' }));
                const params = { per_page: 200 };
                if (user?.role === 'super_admin') params.clinic_id = clinicId;
                const res = await client.get(`${base}/doctors`, { params });
                if (cancelled) return;
                const doctors = Array.isArray(res?.data?.data) ? res.data.data : [];
                setDoctorOptions({ loading: false, error: '', items: doctors });
            } catch (e) {
                if (cancelled) return;
                const msg = e?.response?.data?.message || e?.message || 'Failed to load doctors';
                setDoctorOptions({ loading: false, error: msg, items: [] });
            }
        };

        load();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate, base, user?.role, values?.clinic_id]);

    useEffect(() => {
        const load = async () => {
            if (!isEdit || !module) return;
            const { data } = await client.get(`${base}/${module.path}/${id}`);
            const next = {};
            fields.forEach((field) => {
                next[field.key] = data.data?.[field.key] ?? '';
            });

            setValues(next);
        };
        load();
    }, [isEdit, moduleKey, id, base]);

    useEffect(() => {
        if (moduleKey !== 'patients') return;
        const dob = String(values?.dob || '').trim();
        if (!dob) return;

        const dobDate = new Date(`${dob}T00:00:00`);
        if (Number.isNaN(dobDate.getTime())) return;

        const today = new Date();
        let age = today.getFullYear() - dobDate.getFullYear();
        const monthDiff = today.getMonth() - dobDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
            age -= 1;
        }
        age = Math.max(0, age);

        setValues((prev) => {
            const current = prev?.age;
            const normalizedCurrent = current === '' || current === null || current === undefined ? null : Number(current);
            if (normalizedCurrent === age) return prev;
            return { ...prev, age: String(age) };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [moduleKey, values?.dob]);

    useEffect(() => {
        if (!isAppointmentCreate) return;
        setValues((prev) => ({
            consultation_mode: prev.consultation_mode || 'in_person',
            booking_channel: prev.booking_channel || 'walk_in',
            status: prev.status || 'confirmed',
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate]);

    useEffect(() => {
        if (!isAppointmentCreate) return;
        setValues((prev) => {
            if (prev.visit_type) return prev;
            return { ...prev, visit_type: createPatientInline ? 'new' : 'followup' };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate, createPatientInline]);

    useEffect(() => {
        if (!isAppointmentCreate) return;
        // Selecting a different doctor should reset the chosen slot.
        setValues((prev) => ({ ...prev, appointment_date: '', start_time: '', end_time: '' }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate, values?.doctor_id]);

    useEffect(() => {
        if (!isAppointmentCreate) return;
        const doctorId = values?.doctor_id;
        const clinicId = values?.clinic_id;

        if (!doctorId) {
            setAvailability({ loading: false, error: '', days: [] });
            return;
        }

        if (user?.role === 'super_admin' && !clinicId) {
            setAvailability({ loading: false, error: 'Select Clinic to load slots.', days: [] });
            return;
        }

        let cancelled = false;
        setAvailability({ loading: true, error: '', days: [] });
        setSlotDate(availabilityRange.from);

        (async () => {
            try {
                const params = {
                    doctor_id: doctorId,
                    from_date: availabilityRange.from,
                    to_date: availabilityRange.to,
                };
                if (user?.role === 'super_admin') params.clinic_id = clinicId;

                const res = await client.get(`${base}/appointments/availability`, { params });
                if (cancelled) return;
                const days = Array.isArray(res?.data?.data?.days) ? res.data.data.days : [];
                setAvailability({ loading: false, error: '', days });
            } catch (e) {
                if (cancelled) return;
                setAvailability({ loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load slots', days: [] });
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAppointmentCreate, values?.doctor_id, values?.clinic_id, base, user?.role]);

    useEffect(() => {
        if (!isUserCreate) return;
        setValues((prev) => ({
            status: prev.status || 'active',
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isUserCreate]);

    if (!module) return <div className="rounded border bg-white p-4">Unknown module.</div>;

    const runPatientLookup = async () => {
        setPatientLookup({ loading: true, error: '', results: [] });
        try {
            const phone = String(patientMobile || '').trim();
            if (!phone) {
                setPatientLookup({ loading: false, error: 'Enter a mobile number to search.', results: [] });
                return;
            }

            if (user?.role === 'super_admin' && !values?.clinic_id) {
                setPatientLookup({ loading: false, error: 'Select Clinic first to search patients.', results: [] });
                return;
            }

            const params = { per_page: 10, search: phone };
            if (user?.role === 'super_admin') params.clinic_id = values.clinic_id;

            const { data } = await client.get(`${base}/patients`, { params });
            const results = Array.isArray(data?.data) ? data.data : [];
            setPatientLookup({ loading: false, error: results.length ? '' : 'No patient found for this mobile.', results });

            if (results.length === 1) {
                setValues((prev) => ({ ...prev, patient_id: String(results[0].id) }));
                setCreatePatientInline(false);
            }

            if (results.length === 0) {
                setInlinePatient((prev) => ({ ...prev, phone }));
                setCreatePatientInline(true);
                setValues((prev) => ({ ...prev, patient_id: '' }));
            }
        } catch (e) {
            setPatientLookup({ loading: false, error: e?.response?.data?.message || e?.message || 'Patient search failed', results: [] });
        }
    };

    const prettyDateLabel = (ymd) => {
        try {
            const d = new Date(`${ymd}T00:00:00`);
            return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: '2-digit' }).format(d);
        } catch {
            return ymd;
        }
    };

    const renderInlineSlotPicker = () => (
        <div className="md:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Timeslot</p>
                <p className="mt-0.5 text-sm text-slate-600">Pick an available slot for the selected doctor.</p>

                {!values?.doctor_id ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        Select <span className="font-semibold">Doctor</span> to load slots.
                    </div>
                ) : null}

                {availability.error ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{availability.error}</div>
                ) : null}

                {availability.loading ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Loading slots…</div>
                ) : null}

                {!availability.loading && availability.days?.length ? (
                    <div className="mt-3 space-y-3">
                        <div className="flex gap-2 overflow-x-auto py-1">
                            {availability.days.map((d) => (
                                <button
                                    key={d.date}
                                    type="button"
                                    onClick={() => setSlotDate(d.date)}
                                    className={slotDate === d.date
                                        ? 'rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
                                        : 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                                    }
                                >
                                    {prettyDateLabel(d.date)}
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {(availability.days.find((x) => x.date === slotDate)?.slots || []).map((s, idx) => {
                                const isSelected = values?.appointment_date === slotDate && String(values?.start_time || '') === String(s.start_time);
                                const disabled = !s.available;
                                return (
                                    <button
                                        key={`${slotDate}:${s.start_time}:${idx}`}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => {
                                            setValues((prev) => ({
                                                ...prev,
                                                appointment_date: slotDate,
                                                start_time: s.start_time,
                                                end_time: s.end_time,
                                            }));
                                        }}
                                        className={disabled
                                            ? 'rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-400'
                                            : isSelected
                                                ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                                                : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50'
                                        }
                                    >
                                        {String(s.start_time || '').slice(0, 5)}–{String(s.end_time || '').slice(0, 5)}
                                    </button>
                                );
                            })}

                            {!((availability.days.find((x) => x.date === slotDate)?.slots || []).length) ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">No slots for this date.</div>
                            ) : null}
                        </div>

                        {values?.appointment_date && values?.start_time ? (
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                                Selected: <span className="font-semibold">{values.appointment_date}</span> · <span className="font-semibold">{String(values.start_time).slice(0, 5)}</span>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );

    const renderInlinePatientSection = () => (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Patient</p>
            <p className="mt-0.5 text-sm text-slate-600">Search by mobile. If not found, add patient details here.</p>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mobile</label>
                    <input
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        value={patientMobile}
                        onChange={(e) => setPatientMobile(e.target.value)}
                        placeholder="Enter mobile number"
                    />
                </div>
                <div className="flex items-end">
                    <button
                        type="button"
                        onClick={runPatientLookup}
                        disabled={patientLookup.loading}
                        className="w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                        {patientLookup.loading ? 'Searching…' : 'Search'}
                    </button>
                </div>
            </div>

            {patientLookup.error ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{patientLookup.error}</div>
            ) : null}

            {patientLookup.results.length ? (
                <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Search Results</div>
                    <div className="grid gap-3 md:grid-cols-2">
                        {patientLookup.results.map((p) => {
                            const isSelected = String(values?.patient_id || '') === String(p.id);
                            const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Patient #${p.id}`;
                            const phone = p.phone || p.phone_number || '—';
                            const email = p.email || '';
                            const gender = p.gender || '';
                            const age = p.age ?? '';
                            const dob = p.dob || '';

                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                        setValues((prev) => ({ ...prev, patient_id: String(p.id) }));
                                        setCreatePatientInline(false);
                                    }}
                                    className={isSelected
                                        ? 'text-left rounded-2xl border border-slate-900 bg-white p-4 shadow-sm'
                                        : 'text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300'
                                    }
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold text-slate-900">{name}</div>
                                            <div className="mt-0.5 text-sm text-slate-600">{phone}</div>
                                        </div>
                                        {isSelected ? (
                                            <div className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Selected</div>
                                        ) : (
                                            <div className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">Select</div>
                                        )}
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                        <div><span className="font-semibold text-slate-700">Email:</span> {email || '—'}</div>
                                        <div><span className="font-semibold text-slate-700">Gender:</span> {gender || '—'}</div>
                                        <div><span className="font-semibold text-slate-700">DOB:</span> {dob ? String(dob).slice(0, 10) : '—'}</div>
                                        <div><span className="font-semibold text-slate-700">Age:</span> {age !== '' && age !== null && age !== undefined ? age : '—'}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => {
                        setCreatePatientInline(true);
                        setValues((prev) => ({ ...prev, patient_id: '' }));
                        setInlinePatient((prev) => ({
                            ...prev,
                            phone: String(patientMobile || '').trim() || prev.phone,
                        }));
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    Add New Patient
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setCreatePatientInline(false);
                        setInlinePatient({ first_name: '', last_name: '', phone: '', email: '', gender: '', dob: '', age: '' });
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    Use Existing Patient
                </button>
                {values.patient_id ? (
                    <div className="text-sm text-slate-700">
                        Selected:{' '}
                        <span className="font-semibold">
                            {selectedPatient?.full_name || (selectedPatient?.first_name ? `${selectedPatient.first_name}${selectedPatient.last_name ? ` ${selectedPatient.last_name}` : ''}` : `Patient #${values.patient_id}`)}
                        </span>
                        {selectedPatient?.phone ? <span className="text-slate-500"> · {selectedPatient.phone}</span> : null}
                    </div>
                ) : null}
            </div>

            {createPatientInline ? (
                <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">New Patient Details</div>
                    <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">First Name *</label>
                        <input
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.first_name}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, first_name: e.target.value }))}
                            placeholder="First name"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Last Name</label>
                        <input
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.last_name}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, last_name: e.target.value }))}
                            placeholder="Last name"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mobile *</label>
                        <input
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.phone}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, phone: e.target.value }))}
                            placeholder="Mobile"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
                        <input
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.email}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, email: e.target.value }))}
                            placeholder="Email (optional)"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Gender</label>
                        <select
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.gender ?? ''}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, gender: e.target.value }))}
                        >
                            <option value="">Select Gender</option>
                            <option value="male">male</option>
                            <option value="female">female</option>
                            <option value="other">other</option>
                        </select>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date of Birth</label>
                        <input
                            type="date"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.dob ?? ''}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, dob: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Age</label>
                        <input
                            type="number"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                            value={inlinePatient.age ?? ''}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, age: e.target.value }))}
                            placeholder="Age"
                        />
                    </div>
                </div>
                </div>
            ) : null}
        </div>
    );

    const validateAppointmentStep = (step) => {
        if (!isAppointmentCreate) return '';

        if (user?.role === 'super_admin' && !values?.clinic_id) {
            return 'Please select Clinic.';
        }

        if (step === 1) {
            if (values?.patient_id) return '';
            if (!createPatientInline) return 'Please select a patient.';

            const phone = String(inlinePatient.phone || '').trim();
            const firstName = String(inlinePatient.first_name || '').trim();
            if (!phone) return 'Please fill Patient Mobile.';
            if (!firstName) return 'Please fill Patient First Name.';
        }

        if (step === 2) {
            if (!values?.doctor_id) {
                return 'Please select Doctor.';
            }
        }

        if (step === 3) {
            if (!values?.appointment_date || !values?.start_time || !values?.end_time) {
                return 'Please select a timeslot.';
            }
        }

        return '';
    };

    const goToAppointmentStep = (next) => {
        setStepError('');
        setAppointmentStep(Math.min(4, Math.max(1, next)));
    };

    const renderAppointmentStepperTop = () => {
        if (!isAppointmentCreate) return null;

        const steps = [
            { id: 1, label: 'Patient' },
            { id: 2, label: 'Doctor' },
            { id: 3, label: 'Timeslot' },
            { id: 4, label: 'Details' },
        ];

        const doctors = Array.isArray(doctorOptions.items) ? doctorOptions.items : [];
        const services = Array.isArray(serviceOptions.items) ? serviceOptions.items : [];

        return (
            <div className="space-y-4">
                <div className="flex gap-2 overflow-x-auto">
                    {steps.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => goToAppointmentStep(s.id)}
                            className={appointmentStep === s.id
                                ? 'rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
                                : 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                            }
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                {stepError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{stepError}</div>
                ) : null}

                {appointmentStep === 1 ? renderInlinePatientSection() : null}

                {appointmentStep === 2 ? (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-sm font-semibold text-slate-900">Doctor</p>
                            <p className="mt-0.5 text-sm text-slate-600">Choose the doctor for this appointment.</p>

                            {doctorOptions.error ? (
                                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{doctorOptions.error}</div>
                            ) : null}

                            {doctorOptions.loading ? (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Loading doctors…</div>
                            ) : null}

                            {!doctorOptions.loading && doctors.length ? (
                                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                                    {doctors.map((d) => {
                                        const isSelected = String(values?.doctor_id || '') === String(d.id);
                                        const name = [d.title, d.full_name].filter(Boolean).join(' ').trim() || `Doctor #${d.id}`;
                                        const photoUrl = d.photo_url || d.profile_photo_url || d.avatar_url || d.image_url || '';
                                        return (
                                            <button
                                                key={d.id}
                                                type="button"
                                                onClick={() => setValues((prev) => ({ ...prev, doctor_id: String(d.id) }))}
                                                className={isSelected
                                                    ? 'text-left w-full overflow-hidden rounded-2xl border border-slate-900 bg-white shadow-sm'
                                                    : 'text-left w-full overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-slate-300'
                                                }
                                            >
                                                <div className="relative h-20 w-full bg-slate-100">
                                                    {photoUrl ? (
                                                        <img
                                                            src={photoUrl}
                                                            alt={name}
                                                            className="h-full w-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                            No Photo
                                                        </div>
                                                    )}

                                                    <div className="absolute right-3 top-3">
                                                        {isSelected ? (
                                                            <div className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Selected</div>
                                                        ) : (
                                                            <div className="rounded-full border border-slate-300 bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-700">Select</div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="p-3">
                                                    <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                                                    <div className="mt-0.5 truncate text-xs text-slate-600">{d.specialization || '—'}</div>

                                                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                                                        <div className="truncate"><span className="font-semibold text-slate-700">Phone:</span> {d.phone || '—'}</div>
                                                        <div className="shrink-0"><span className="font-semibold text-slate-700">Fee:</span> {d.consultation_fee ?? '—'}</div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {!doctorOptions.loading && !doctors.length ? (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">No doctors found.</div>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {appointmentStep === 3 ? renderInlineSlotPicker() : null}

                {appointmentStep === 4 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">Service</p>
                        <p className="mt-0.5 text-sm text-slate-600">Pick a service (optional).</p>

                        {serviceOptions.error ? (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{serviceOptions.error}</div>
                        ) : null}

                        {serviceOptions.loading ? (
                            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Loading services…</div>
                        ) : null}

                        {!serviceOptions.loading && services.length ? (
                            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {services.map((s) => {
                                    const isSelected = String(values?.service_id || '') === String(s.id);
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => setValues((prev) => ({ ...prev, service_id: String(s.id) }))}
                                            className={isSelected
                                                ? 'text-left rounded-2xl border border-slate-900 bg-white p-4 shadow-sm'
                                                : 'text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300'
                                            }
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-semibold text-slate-900">{s.name || `Service #${s.id}`}</div>
                                                    <div className="mt-0.5 text-sm text-slate-600">{s.description || '—'}</div>
                                                </div>
                                                {isSelected ? (
                                                    <div className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Selected</div>
                                                ) : (
                                                    <div className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">Select</div>
                                                )}
                                            </div>
                                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                                <div><span className="font-semibold text-slate-700">Fee:</span> {s.fee ?? '—'}</div>
                                                <div><span className="font-semibold text-slate-700">Duration:</span> {s.duration_minutes ?? '—'} min</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}

                        {!serviceOptions.loading && !services.length ? (
                            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">No services found.</div>
                        ) : null}

                        {values?.service_id ? (
                            <button
                                type="button"
                                onClick={() => setValues((prev) => ({ ...prev, service_id: '' }))}
                                className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Clear Service
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    };

    const renderDoctorLoginTop = () => (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Doctor Login</p>
            <p className="mt-0.5 text-sm text-slate-600">A staff user will be created with role <span className="font-semibold">doctor</span>.</p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
                    <input
                        type="password"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        value={doctorLoginPassword}
                        onChange={(e) => setDoctorLoginPassword(e.target.value)}
                        placeholder="Set a password"
                    />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                    Uses Doctor <span className="font-semibold">Email/Phone</span> for login.
                </div>
            </div>
        </div>
    );

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            if (isAppointmentCreate && appointmentStep < 4) {
                const msg = validateAppointmentStep(appointmentStep);
                if (msg) {
                    setStepError(msg);
                    return;
                }
                setStepError('');
                setAppointmentStep((s) => Math.min(4, s + 1));
                return;
            }

            if (isAppointmentCreate) {
                const msg =
                    validateAppointmentStep(1) ||
                    validateAppointmentStep(2) ||
                    validateAppointmentStep(3);
                if (msg) {
                    setError(msg);
                    return;
                }
            }

            if (!isEdit) {
                const missing = fields.find((field) => {
                    if (user?.role !== 'super_admin' && field.key === 'clinic_id') return false;
                    if (isAppointmentCreate && field.key === 'patient_id' && createPatientInline) return false;
                    if (!field.required) return false;
                    const val = values[field.key];
                    if (field.type === 'relation' && field.multiple) {
                        return !Array.isArray(val) || val.length === 0;
                    }
                    return val === '' || val === null || val === undefined;
                });
                if (missing) {
                    setError(`Please fill ${missing.label}.`);
                    return;
                }

                if (isAppointmentCreate && createPatientInline) {
                    const phone = String(inlinePatient.phone || '').trim();
                    const firstName = String(inlinePatient.first_name || '').trim();
                    if (!phone) {
                        setError('Please fill Patient Mobile.');
                        return;
                    }
                    if (!firstName) {
                        setError('Please fill Patient First Name.');
                        return;
                    }
                }
            }

            if (moduleKey === 'users') {
                const email = String(values.email || '').trim();
                const phone = String(values.phone || '').trim();
                if (!email && !phone) {
                    setError('Please fill Email or Phone.');
                    return;
                }
            }

            if (isDoctorCreate) {
                const pw = String(doctorLoginPassword || '').trim();
                if (!pw) {
                    setError('Please fill Password for doctor login.');
                    return;
                }
            }
            const payload = castPayload(values);

            if (isAppointmentCreate && createPatientInline) {
                const firstName = String(inlinePatient.first_name || '').trim();
                const lastName = String(inlinePatient.last_name || '').trim();
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
                const ageRaw = String(inlinePatient.age ?? '').trim();
                const ageNum = ageRaw === '' ? null : Number(ageRaw);
                payload.patient = {
                    phone: String(inlinePatient.phone || '').trim(),
                    first_name: firstName,
                    full_name: fullName || firstName,
                    last_name: lastName || undefined,
                    email: String(inlinePatient.email || '').trim() || undefined,
                    gender: String(inlinePatient.gender || '').trim() || undefined,
                    dob: String(inlinePatient.dob || '').trim() || undefined,
                    age: Number.isFinite(ageNum) ? ageNum : undefined,
                };
            }

            if (isDoctorCreate) {
                payload.create_linked_user = true;
                payload.linked_user = {
                    full_name: String(values.full_name || '').trim() || undefined,
                    email: String(values.email || '').trim() || null,
                    phone: String(values.phone || '').trim() || null,
                    password: String(doctorLoginPassword || '').trim(),
                };
            }

            if (isEdit) {
                await client.put(`${base}/${module.path}/${id}`, payload);
            } else {
                await client.post(`${base}/${module.path}`, payload);
            }
            navigate(`/modules/${moduleKey}`);
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Save failed');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">{isEdit ? `Edit ${module.label}` : `Add ${module.label}`}</h2>
                <Link to={`/modules/${moduleKey}`} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Back</Link>
            </div>

            <FormRenderer
                title={isEdit ? `Edit ${module.label}` : `Add ${module.label}`}
                fields={fieldsForRenderer}
                values={values}
                error={error}
                onChange={(key, val) => setValues((prev) => ({ ...prev, [key]: val }))}
                onSubmit={submit}
                onCancel={() => navigate(`/modules/${moduleKey}`)}
                submitLabel={
                    isAppointmentCreate
                        ? appointmentStep < 4
                            ? 'Next'
                            : 'Create'
                        : isEdit
                          ? 'Update'
                          : 'Create'
                }
                renderTop={() => (isAppointmentCreate ? renderAppointmentStepperTop() : isDoctorCreate ? renderDoctorLoginTop() : null)}
            />
        </div>
    );
}
