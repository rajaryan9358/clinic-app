import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import client from '../api/client';
import FormRenderer from '../components/FormRenderer';
import AppIcon from '../components/AppIcon';
import { Alert, PageHeader, btn, input as inputClass, label as labelClass } from '../components/ui';
import { modules } from '../config/modules';
import { canAccessModule, canCreateModule, canEditModule, isSuperAdminHiddenModuleKey, NON_CREATABLE_MODULE_KEYS } from '../config/access';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import { useAssignableRoles } from '../hooks/useAssignableRoles';

// The permission checks live in the default-exported wrapper below, not
// here, so this component can call every hook it needs unconditionally.
// (An early-return between two hook calls can change how many hooks run
// between renders of the same mounted instance — e.g. once the scope
// context finishes loading — which React forbids and crashes on.)
// Local look for the booking steps: a selectable option card and a muted note.
const optionCard = (selected) => (selected
    ? 'w-full rounded-xl border border-blue-600 bg-blue-50/40 p-4 text-left ring-2 ring-blue-100'
    : 'w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300 hover:bg-slate-50');
const selectPill = (selected) => (selected
    ? 'shrink-0 rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white'
    : 'shrink-0 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700');
const note = 'mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600';
const fieldInput = `${inputClass} h-10`;

function SectionTitle({ title, hint }) {
    return (
        <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {hint ? <p className="mt-0.5 text-sm text-slate-600">{hint}</p> : null}
        </div>
    );
}

function ModuleFormPageInner({ forcedModuleKey } = {}) {
    const { moduleKey: routeModuleKey, id } = useParams();
    const moduleKey = forcedModuleKey || routeModuleKey;
    const module = modules[moduleKey];
    const isEdit = Boolean(id);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const isAppointmentCreate = moduleKey === 'appointments' && !isEdit;
    const isUserCreate = moduleKey === 'users' && !isEdit;
    const isDoctorCreate = moduleKey === 'doctors' && !isEdit;
    const isUserModule = moduleKey === 'users';

    // Roles assignable via this form (spec §3/§4): staff-kind roles for a
    // clinic actor (plus clinic_admin when the actor is clinic_admin kind —
    // `/clinic/roles` already applies that filter server-side), or
    // staff/clinic_admin-kind roles for the super admin. Doctor-kind roles
    // and the hidden super_admin role are never listed by either endpoint.
    const rolesState = useAssignableRoles(isUserModule ? base : null);

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
        const qPatient = searchParams.get('patient_id');
        if (qPatient && /^\d+$/.test(qPatient)) pre.patient_id = qPatient;
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

    // A patient pre-filled from the URL (e.g. "Book" on a patient profile) is
    // loaded once so the form shows them as the selected patient.
    useEffect(() => {
        const qPatient = searchParams.get('patient_id');
        if (!isAppointmentCreate || !qPatient || !/^\d+$/.test(qPatient)) return;
        let cancelled = false;
        client.get(`${base}/patients/${qPatient}`)
            .then(({ data }) => {
                const p = data?.data;
                if (cancelled || !p) return;
                setPatientMobile(p.phone || '');
                setPatientLookup({ loading: false, error: '', results: [p] });
            })
            .catch(() => {});
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // If doctor is pre-filled, skip straight to the slot-picker step.
    const [appointmentStep, setAppointmentStep] = useState(() => {
        if (!isAppointmentCreate) return 1;
        return searchParams.get('doctor_id') ? 2 : 1;
    });
    const [stepError, setStepError] = useState('');

    const [doctorOptions, setDoctorOptions] = useState({ loading: false, error: '', items: [] });
    const [serviceOptions, setServiceOptions] = useState({ loading: false, error: '', items: [] });

    const fields = module?.formFields || [];

    // The super_admin role is deliberately excluded from GET /*/roles (it's
    // hidden from the builder entirely — spec §5), so the super admin's own
    // users form offers it as a synthetic option, but only while creating a
    // clinic-less user (spec §4: "super_admin only for clinic-less users").
    const roleOptions = useMemo(() => {
        const list = (rolesState.roles || []).map((r) => ({
            value: r.name,
            label: r.label,
            limitToAssignedDoctors: Boolean(r.limit_to_assigned_doctors),
        }));
        if (isUserModule && user?.role === 'super_admin' && !values?.clinic_id) {
            list.push({ value: 'super_admin', label: 'Super Admin', limitToAssignedDoctors: false });
        }
        return list;
    }, [rolesState.roles, isUserModule, user?.role, values?.clinic_id]);

    const fieldsForRenderer = useMemo(() => {
        if (!isAppointmentCreate) {
            if (isUserModule) {
                const allowedRoles = new Map(roleOptions.map((o) => [o.value, o]));
                const currentRole = String(values?.role || '');
                const currentRoleOption = allowedRoles.get(currentRole);

                return fields
                    .map((f) => {
                        if (f.key === 'role' && f.type === 'select') {
                            // If the record's role is outside what this actor can manage, do not
                            // render a dropdown that exposes disallowed roles.
                            if (isEdit && currentRole && !currentRoleOption) {
                                return { ...f, hidden: true };
                            }
                            return {
                                ...f,
                                options: roleOptions.map((o) => ({ value: o.value, label: o.label })),
                            };
                        }
                        if (f.key === 'doctor_ids') {
                            // Only meaningful for a role with limit_to_assigned_doctors (spec §4/§6).
                            if (!currentRoleOption?.limitToAssignedDoctors) {
                                return { ...f, hidden: true };
                            }
                            return f;
                        }
                        return f;
                    })
                    .filter((f) => !f?.hidden);
            }
            // Staff can't pick 'portal', but an existing portal booking keeps showing it.
            if (moduleKey === 'appointments' && values?.booking_channel === 'portal') {
                return fields.map((f) => (f.key === 'booking_channel' ? { ...f, options: [...f.options, 'portal'] } : f));
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
    }, [fields, isAppointmentCreate, appointmentStep, user?.role, isUserModule, isEdit, values?.role, roleOptions, moduleKey, values?.booking_channel]);

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
        // Keep anything pre-filled from the URL (patient, doctor, date, time).
        setValues((prev) => ({
            ...prev,
            consultation_mode: prev.consultation_mode || 'in_person',
            booking_channel: prev.booking_channel || 'walk_in',
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

    // Selecting a different doctor should reset the chosen slot — but not on
    // first render, where a slot pre-filled from the URL belongs to the
    // pre-filled doctor.
    const slotDoctorRef = useRef(values?.doctor_id);
    useEffect(() => {
        if (!isAppointmentCreate) return;
        if (slotDoctorRef.current === values?.doctor_id) return;
        slotDoctorRef.current = values?.doctor_id;
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
        // Open on the already-chosen day (e.g. pre-filled from the schedule).
        const chosen = String(values?.appointment_date || '');
        setSlotDate(chosen && chosen >= availabilityRange.from ? chosen : availabilityRange.from);

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

    if (!module) return <Alert tone="error">Unknown module.</Alert>;

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
            <div>
                <SectionTitle title="Timeslot" hint="Pick an available slot for the selected doctor." />

                {!values?.doctor_id ? (
                    <div className={note}>
                        Select <span className="font-semibold">Doctor</span> to load slots.
                    </div>
                ) : null}

                {availability.error ? (
                    <div className="mt-3"><Alert tone="error">{availability.error}</Alert></div>
                ) : null}

                {availability.loading ? (
                    <div className={note}>Loading slots…</div>
                ) : null}

                {!availability.loading && availability.days?.length ? (
                    <div className="mt-4 space-y-4">
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1" role="group" aria-label="Date">
                            {availability.days.map((d) => (
                                <button
                                    key={d.date}
                                    type="button"
                                    onClick={() => setSlotDate(d.date)}
                                    aria-pressed={slotDate === d.date}
                                    className={slotDate === d.date
                                        ? 'h-9 shrink-0 whitespace-nowrap rounded-full bg-slate-900 px-3.5 text-sm font-semibold text-white'
                                        : 'h-9 shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3.5 text-sm text-slate-700 hover:bg-slate-50'
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
                                        aria-pressed={isSelected}
                                        onClick={() => {
                                            setValues((prev) => ({
                                                ...prev,
                                                appointment_date: slotDate,
                                                start_time: s.start_time,
                                                end_time: s.end_time,
                                            }));
                                        }}
                                        className={disabled
                                            ? 'h-10 cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm tabular-nums text-slate-400 line-through'
                                            : isSelected
                                                ? 'h-10 rounded-xl bg-blue-600 px-3 text-sm font-semibold tabular-nums text-white'
                                                : 'h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-800 hover:border-blue-400 hover:bg-blue-50'
                                        }
                                    >
                                        {String(s.start_time || '').slice(0, 5)}–{String(s.end_time || '').slice(0, 5)}
                                    </button>
                                );
                            })}

                            {!((availability.days.find((x) => x.date === slotDate)?.slots || []).length) ? (
                                <p className="text-sm text-slate-600">No slots for this date.</p>
                            ) : null}
                        </div>

                        {values?.appointment_date && values?.start_time ? (
                            <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                                Selected: <span className="font-semibold">{values.appointment_date}</span> · <span className="font-semibold">{String(values.start_time).slice(0, 5)}</span>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );

    const renderInlinePatientSection = () => (
        <div>
            <SectionTitle title="Patient" hint="Search by mobile. If not found, add patient details here." />

            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                    <label htmlFor="booking-patient-mobile" className={labelClass}>Mobile</label>
                    <input
                        id="booking-patient-mobile"
                        type="tel"
                        className={fieldInput}
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
                        className={`${btn.secondary} w-full sm:w-28`}
                    >
                        {patientLookup.loading ? 'Searching…' : 'Search'}
                    </button>
                </div>
            </div>

            {patientLookup.error ? (
                <div className="mt-3"><Alert tone="warn">{patientLookup.error}</Alert></div>
            ) : null}

            {patientLookup.results.length ? (
                <div className="mt-4">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Search results</h4>
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
                                    aria-pressed={isSelected}
                                    className={optionCard(isSelected)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                                            <div className="mt-0.5 text-sm text-slate-600">{phone}</div>
                                        </div>
                                        <span className={selectPill(isSelected)}>{isSelected ? 'Selected' : 'Select'}</span>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                                        <div className="truncate"><span className="font-semibold text-slate-700">Email:</span> {email || '—'}</div>
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

            <div className="mt-4 flex flex-wrap items-center gap-2">
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
                    className={createPatientInline ? `${btn.secondary} border-blue-600 text-blue-700` : btn.secondary}
                >
                    Add New Patient
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setCreatePatientInline(false);
                        setInlinePatient({ first_name: '', last_name: '', phone: '', email: '', gender: '', dob: '', age: '' });
                    }}
                    className={btn.ghost}
                >
                    Use Existing Patient
                </button>
                {values.patient_id ? (
                    <div role="status" className="text-sm text-slate-700">
                        Selected:{' '}
                        <span className="font-semibold">
                            {selectedPatient?.full_name || (selectedPatient?.first_name ? `${selectedPatient.first_name}${selectedPatient.last_name ? ` ${selectedPatient.last_name}` : ''}` : `Patient #${values.patient_id}`)}
                        </span>
                        {selectedPatient?.phone ? <span className="text-slate-600"> · {selectedPatient.phone}</span> : null}
                    </div>
                ) : null}
            </div>

            {createPatientInline ? (
                <div className="mt-5 border-t border-slate-100 pt-5">
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">New patient details</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <label htmlFor="np-first" className={labelClass}>First name <span className="text-rose-600" aria-hidden="true">*</span></label>
                        <input
                            id="np-first"
                            className={fieldInput}
                            value={inlinePatient.first_name}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, first_name: e.target.value }))}
                            placeholder="First name"
                        />
                    </div>
                    <div>
                        <label htmlFor="np-last" className={labelClass}>Last name</label>
                        <input
                            id="np-last"
                            className={fieldInput}
                            value={inlinePatient.last_name}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, last_name: e.target.value }))}
                            placeholder="Last name"
                        />
                    </div>
                    <div>
                        <label htmlFor="np-mobile" className={labelClass}>Mobile <span className="text-rose-600" aria-hidden="true">*</span></label>
                        <input
                            id="np-mobile"
                            className={fieldInput}
                            value={inlinePatient.phone}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, phone: e.target.value }))}
                            placeholder="Mobile"
                        />
                    </div>
                    <div>
                        <label htmlFor="np-email" className={labelClass}>Email</label>
                        <input
                            id="np-email"
                            className={fieldInput}
                            value={inlinePatient.email}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, email: e.target.value }))}
                            placeholder="Email (optional)"
                        />
                    </div>
                    <div>
                        <label htmlFor="np-gender" className={labelClass}>Gender</label>
                        <select
                            id="np-gender"
                            className={fieldInput}
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
                        <label htmlFor="np-dob" className={labelClass}>Date of birth</label>
                        <input
                            type="date"
                            id="np-dob"
                            className={fieldInput}
                            value={inlinePatient.dob ?? ''}
                            onChange={(e) => setInlinePatient((p) => ({ ...p, dob: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label htmlFor="np-age" className={labelClass}>Age</label>
                        <input
                            type="number"
                            id="np-age"
                            className={fieldInput}
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
            <div className="space-y-5">
                <ol className="-mx-5 -mt-5 flex overflow-x-auto border-b border-slate-100 px-3" aria-label="Booking steps">
                    {steps.map((s) => {
                        const current = appointmentStep === s.id;
                        const done = appointmentStep > s.id;
                        return (
                            <li key={s.id} className="shrink-0">
                                <button
                                    type="button"
                                    onClick={() => goToAppointmentStep(s.id)}
                                    aria-current={current ? 'step' : undefined}
                                    className={`flex h-12 items-center gap-2 border-b-2 px-3 text-sm ${current ? 'border-blue-600 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
                                >
                                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${current ? 'bg-blue-600 text-white' : done ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>{s.id}</span>
                                    {s.label}
                                </button>
                            </li>
                        );
                    })}
                </ol>

                {stepError ? <Alert tone="error">{stepError}</Alert> : null}

                {appointmentStep === 1 ? renderInlinePatientSection() : null}

                {appointmentStep === 2 ? (
                    <div className="space-y-4">
                        <div>
                            <SectionTitle title="Doctor" hint="Choose the doctor for this appointment." />

                            {doctorOptions.error ? (
                                <div className="mt-3"><Alert tone="error">{doctorOptions.error}</Alert></div>
                            ) : null}

                            {doctorOptions.loading ? (
                                <div className={note}>Loading doctors…</div>
                            ) : null}

                            {!doctorOptions.loading && doctors.length ? (
                                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {doctors.map((d) => {
                                        const isSelected = String(values?.doctor_id || '') === String(d.id);
                                        const name = [d.title, d.full_name].filter(Boolean).join(' ').trim() || `Doctor #${d.id}`;
                                        const photoUrl = d.photo_url || d.profile_photo_url || d.avatar_url || d.image_url || '';
                                        return (
                                            <button
                                                key={d.id}
                                                type="button"
                                                onClick={() => setValues((prev) => ({ ...prev, doctor_id: String(d.id) }))}
                                                aria-pressed={isSelected}
                                                className={optionCard(isSelected)}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {photoUrl ? (
                                                        <img
                                                            src={photoUrl}
                                                            alt={name}
                                                            className="h-11 w-11 shrink-0 rounded-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-hidden="true">
                                                            <AppIcon name="stethoscope" className="h-5 w-5" />
                                                        </span>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                                                        <div className="mt-0.5 truncate text-xs text-slate-600">{d.specialization || '—'}</div>
                                                    </div>
                                                    <span className={selectPill(isSelected)}>{isSelected ? 'Selected' : 'Select'}</span>
                                                </div>

                                                <div>
                                                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-600">
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
                                <div className={note}>No doctors found.</div>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {appointmentStep === 3 ? renderInlineSlotPicker() : null}

                {appointmentStep === 4 ? (
                    <div>
                        <SectionTitle title="Service" hint="Pick a service (optional)." />

                        {serviceOptions.error ? (
                            <div className="mt-3"><Alert tone="error">{serviceOptions.error}</Alert></div>
                        ) : null}

                        {serviceOptions.loading ? (
                            <div className={note}>Loading services…</div>
                        ) : null}

                        {!serviceOptions.loading && services.length ? (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {services.map((s) => {
                                    const isSelected = String(values?.service_id || '') === String(s.id);
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => setValues((prev) => ({ ...prev, service_id: String(s.id) }))}
                                            aria-pressed={isSelected}
                                            className={optionCard(isSelected)}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-slate-900">{s.name || `Service #${s.id}`}</div>
                                                    <div className="mt-0.5 text-sm text-slate-600">{s.description || '—'}</div>
                                                </div>
                                                <span className={selectPill(isSelected)}>{isSelected ? 'Selected' : 'Select'}</span>
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
                            <div className={note}>No services found.</div>
                        ) : null}

                        {values?.service_id ? (
                            <button
                                type="button"
                                onClick={() => setValues((prev) => ({ ...prev, service_id: '' }))}
                                className={`${btn.ghost} mt-3`}
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
            <h3 className="text-sm font-semibold text-slate-900">Doctor login</h3>
            <p className="mt-0.5 text-sm text-slate-600">A staff user will be created with role <span className="font-semibold">doctor</span>.</p>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                    <label htmlFor="doctor-login-password" className={labelClass}>Password</label>
                    <input
                        id="doctor-login-password"
                        type="password"
                        className={fieldInput}
                        value={doctorLoginPassword}
                        onChange={(e) => setDoctorLoginPassword(e.target.value)}
                        placeholder="Set a password"
                    />
                </div>
                <div className="self-end rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
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
        <div className={`mx-auto space-y-5 ${isAppointmentCreate ? 'max-w-5xl' : 'max-w-3xl'}`}>
            <PageHeader
                title={isEdit ? `Edit ${module.label}` : `Add ${module.label}`}
                back={{ to: `/modules/${moduleKey}`, label: module.label }}
            />

            <FormRenderer
                title={isAppointmentCreate ? null : 'Details'}
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

export default function ModuleFormPage({ forcedModuleKey } = {}) {
    const { moduleKey: routeModuleKey, id } = useParams();
    const moduleKey = forcedModuleKey || routeModuleKey;
    const isEdit = Boolean(id);
    const { user } = useAuth();
    const scope = useScope();

    if (user?.role === 'super_admin' && isSuperAdminHiddenModuleKey(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!canAccessModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!isEdit && !canCreateModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to={`/modules/${moduleKey}`} replace />;
    }

    if (isEdit && !canEditModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to={`/modules/${moduleKey}`} replace />;
    }

    return <ModuleFormPageInner forcedModuleKey={forcedModuleKey} />;
}
