import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import client from '../api/client';
import DataTable from '../components/DataTable';
import RecordDialog from '../components/RecordDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import AppIcon from '../components/AppIcon';
import StatusBadge from '../components/StatusBadge';
import ClinicStatusBadge from '../components/billing/ClinicStatusBadge.jsx';
import { modules } from '../config/modules';
import { canAccessModule, canCreateModule, canDeleteModule, canEditModule, isSuperAdminHiddenModuleKey } from '../config/access';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';

function prettyLabel(key) {
    return String(key)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function inferLabel(item) {
    if (!item || typeof item !== 'object') return '';
    const candidates = [
        item.name,
        item.full_name,
        item.host,
        item.invoice_number,
        item.reference_number,
        item.phone_number,
        item.business_name,
        item.customer_phone,
        item.uuid,
        item.code,
        item.email,
        item.phone,
    ];
    const first = candidates.find((v) => typeof v === 'string' && v.trim().length);
    return first || `#${item.id}`;
}

function FilterControl({ field, value, onChange, relationOptions, relationLoading, relationHint }) {
    const base = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

    if (field.type === 'select') {
        const options = Array.isArray(field.options) ? field.options : [];
        return (
            <select className={base} value={value ?? ''} onChange={(e) => onChange(field.key, e.target.value)}>
                <option value="">All {field.label}</option>
                {options.map((opt) => {
                    const normalized = typeof opt === 'string' ? { label: opt, value: opt } : opt;
                    return (
                        <option key={String(normalized.value)} value={normalized.value}>
                            {normalized.label}
                        </option>
                    );
                })}
            </select>
        );
    }

    if (field.type === 'relation') {
        const options = relationOptions || [];
        const normalized = value === null || value === undefined ? '' : String(value);
        return (
            <select className={base} value={normalized} onChange={(e) => onChange(field.key, e.target.value)}>
                <option value="">All {field.label}</option>
                {relationHint ? <option value="" disabled>{relationHint}</option> : null}
                {relationLoading ? <option disabled>Loading…</option> : null}
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        );
    }

    return (
        <input
            type={field.type || 'text'}
            className={base}
            value={value ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder || field.label}
        />
    );
}

export default function ModuleListPage({ forcedModuleKey } = {}) {
    const { moduleKey: routeModuleKey } = useParams();
    const moduleKey = forcedModuleKey || routeModuleKey;
    const navigate = useNavigate();
    const { user } = useAuth();
    const scope = useScope();
    const module = modules[moduleKey];

    if (user?.role === 'super_admin' && isSuperAdminHiddenModuleKey(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!canAccessModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to="/dashboard" replace />;
    }

    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState({ current_page: 1, per_page: 15, total: 0 });
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState({});
    const [loading, setLoading] = useState(false);
    const [viewRecord, setViewRecord] = useState(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [includeDeleted, setIncludeDeleted] = useState(false);
    const [actionError, setActionError] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);
    const [confirm, setConfirm] = useState({ open: false, row: null, busy: false });

    const [reviewCreate, setReviewCreate] = useState({
        open: false,
        busy: false,
        error: '',
        values: { reviewer_name: '', message: '', rating: '5' },
    });

    const [replyDialog, setReplyDialog] = useState({
        open: false,
        row: null,
        mode: 'generate',
        busy: false,
        saving: false,
        error: '',
        options: { reply_type: 'medium', language: 'english', tone: 'professional', case_data: '' },
        generated: null,
    });

    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const setFilterAndFetch = (key, value) => {
        const next = { ...(filters || {}), [key]: value };
        if (value === undefined || value === null || String(value) === '') {
            delete next[key];
        }
        setFilters(next);
        fetchData(1, { filters: next });
    };

    const viewMode = useMemo(() => {
        if (moduleKey === 'patients') return 'route';
        if (moduleKey === 'doctors') return 'route';
        return 'dialog';
    }, [moduleKey]);

    const filterContext = base === '/super-admin' ? 'super_admin' : 'clinic';
    const filterKeys = useMemo(() => {
        const keys = module?.filters?.[filterContext] || [];
        return Array.isArray(keys) ? keys : [];
    }, [moduleKey, filterContext]);

    const filterFields = useMemo(() => {
        const formFields = module?.formFields || [];
        return filterKeys.map((key) => {
            if (moduleKey === 'patients' && key === 'status_tag') {
                return {
                    key,
                    label: 'Status',
                    type: 'select',
                    options: [
                        { label: 'active', value: 'active' },
                        { label: 'followup_due', value: 'followup_due' },
                        { label: 'inactive', value: 'inactive' },
                        { label: 'blocked', value: 'blocked' },
                    ],
                };
            }

            if (moduleKey === 'patients' && key === 'preferred_doctor_id') {
                return {
                    key,
                    label: 'Doctor',
                    type: 'relation',
                    resource: 'doctors',
                };
            }

            if (moduleKey === 'doctors' && key === 'status') {
                return {
                    key,
                    label: 'Status',
                    type: 'select',
                    options: [
                        { label: 'Active', value: 'active' },
                        { label: 'Inactive', value: 'inactive' },
                    ],
                };
            }

            if (moduleKey === 'doctors' && key === 'specialization') {
                return {
                    key,
                    label: 'Specialization',
                    type: 'select',
                    options: [
                        'General Physician', 'Cardiologist', 'Dermatologist', 'Dentist',
                        'ENT Specialist', 'Gynaecologist', 'Neurologist', 'Ophthalmologist',
                        'Orthopaedic', 'Paediatrician', 'Psychiatrist', 'Radiologist',
                        'Urologist', 'Physiotherapist', 'Dietitian', 'Oncologist',
                        'Endocrinologist', 'Rheumatologist', 'Nephrologist', 'Pulmonologist',
                    ].map((s) => ({ label: s, value: s })),
                };
            }

            const fromForm = formFields.find((f) => f.key === key);

            if (fromForm?.type === 'checkbox') {
                return {
                    key,
                    label: fromForm.label || prettyLabel(key),
                    type: 'select',
                    options: [
                        { label: 'Yes', value: '1' },
                        { label: 'No', value: '0' },
                    ],
                };
            }

            if (fromForm) {
                return {
                    ...fromForm,
                    label: fromForm.label || prettyLabel(key),
                };
            }

            if (String(key).endsWith('_id')) {
                return { key, label: prettyLabel(key), type: 'number' };
            }

            if (String(key).endsWith('_date')) {
                return { key, label: prettyLabel(key), type: 'date' };
            }

            return { key, label: prettyLabel(key), type: 'text' };
        });
    }, [moduleKey, filterKeys]);

    const relationResources = useMemo(() => {
        const unique = new Set();
        (filterFields || []).forEach((field) => {
            if (field.type === 'relation' && field.resource) unique.add(field.resource);
        });
        return Array.from(unique);
    }, [filterFields]);

    const [relationState, setRelationState] = useState({});

    const queryKeyFor = (resource) => {
        if (resource === 'doctors' && user?.role === 'super_admin') {
            return `clinic:${filters?.clinic_id ?? ''}`;
        }
        return 'default';
    };

    const paramsFor = (resource) => {
        const params = { per_page: 200 };
        if (resource === 'doctors' && user?.role === 'super_admin') {
            if (!filters?.clinic_id) return null;
            params.clinic_id = filters.clinic_id;
        }
        return params;
    };

    useEffect(() => {
        let cancelled = false;

        const loadOne = async (resource, params, queryKey) => {
            setRelationState((prev) => ({
                ...prev,
                [resource]: { loading: true, options: prev?.[resource]?.options || [], error: '', queryKey },
            }));
            try {
                const { data } = await client.get(`${base}/${resource}`, { params });
                const items = Array.isArray(data?.data) ? data.data : [];
                const options = items
                    .filter((item) => item && item.id !== undefined && item.id !== null)
                    .map((item) => ({ value: String(item.id), label: inferLabel(item) }));

                if (cancelled) return;
                setRelationState((prev) => ({
                    ...prev,
                    [resource]: { loading: false, options, error: '', queryKey },
                }));
            } catch {
                if (cancelled) return;
                setRelationState((prev) => ({
                    ...prev,
                    [resource]: { loading: false, options: prev?.[resource]?.options || [], error: 'Failed to load options', queryKey },
                }));
            }
        };

        relationResources.forEach((resource) => {
            const existing = relationState?.[resource];
            const queryKey = queryKeyFor(resource);
            const params = paramsFor(resource);

            if (params === null) {
                if (existing?.queryKey !== queryKey || existing?.loading) {
                    setRelationState((prev) => ({
                        ...prev,
                        [resource]: { loading: false, options: [], error: '', queryKey },
                    }));
                }
                return;
            }

            if (existing?.queryKey === queryKey && (existing?.loading || (existing?.options && existing.options.length))) return;
            loadOne(resource, params, queryKey);
        });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [relationResources, base, user?.role, filters?.clinic_id]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        filterKeys.forEach((key) => {
            const val = filters?.[key];
            if (val === undefined || val === null) return;
            if (String(val) === '') return;
            count += 1;
        });
        return count;
    }, [search, filters, filterKeys]);

    const fetchData = async (page = 1, overrides = {}) => {
        if (!module) return;
        setLoading(true);
        try {
            const nextSearch = overrides.search ?? search;
            const nextFilters = overrides.filters ?? filters;
            const nextIncludeDeleted = overrides.includeDeleted ?? includeDeleted;

            const params = { page, per_page: 15 };
            if (String(nextSearch || '').trim()) params.search = String(nextSearch).trim();
            Object.entries(nextFilters || {}).forEach(([key, val]) => {
                if (val === undefined || val === null) return;
                if (String(val) === '') return;
                params[key] = val;
            });
            if (nextIncludeDeleted) params.with_trashed = 1;

            const res = await client.get(`${base}/${module.path}`, { params });
            setRows(res.data.data || []);
            setMeta(res.data.meta || meta);
            setActionError('');
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to load records');
        } finally {
            setLoading(false);
        }
    };

    const canDownloadPdf = moduleKey === 'appointments' || moduleKey === 'patients' || moduleKey === 'doctors';

    const downloadBlob = (data, filename) => {
        try {
            const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            // ignore
        }
    };

    const downloadPdfReport = async () => {
        if (!canDownloadPdf) return;
        setPdfBusy(true);
        setActionError('');
        try {
            const params = {};
            if (String(search || '').trim()) params.search = String(search).trim();
            Object.entries(filters || {}).forEach(([key, val]) => {
                if (val === undefined || val === null) return;
                if (String(val) === '') return;
                params[key] = val;
            });
            if (includeDeleted) params.with_trashed = 1;

            const endpoint = moduleKey === 'appointments'
                ? 'appointments'
                : moduleKey === 'patients'
                    ? 'patients'
                    : 'doctors';

            const res = await client.get(`${base}/reports/${endpoint}.pdf`, { params, responseType: 'blob' });
            downloadBlob(res.data, `${endpoint}-report.pdf`);
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to download report');
        } finally {
            setPdfBusy(false);
        }
    };

    useEffect(() => {
        setSearch('');
        setFilters({});
        setFiltersOpen(false);
        setIncludeDeleted(false);
        fetchData(1, { search: '', filters: {}, includeDeleted: false });
    }, [moduleKey, base]);

    const reviewReplyPrompt = `You are an assistant that writes professional replies to Google reviews for healthcare clinics.

Your goals:
- Maintain a polite, respectful, and professional tone.
- Match the clinic’s brand tone (warm, premium, friendly, etc.).
- Keep replies natural and human-like (not robotic).
- Keep replies concise (40–100 words unless specified).

STRICT RULES:
- Do NOT invent facts or events.
- Do NOT mention any diagnosis, treatment details, or patient-specific information.
- Do NOT provide medical advice.
- Do NOT argue, blame, or sound defensive.
- Do NOT make guarantees or unrealistic promises.
- Do NOT mention pricing unless explicitly stated in the review.

FOR NEGATIVE REVIEWS:
- Acknowledge the concern empathetically.
- Apologize without admitting fault blindly.
- Encourage the reviewer to contact the clinic directly.
- Move the conversation offline.

FOR POSITIVE REVIEWS:
- Thank the reviewer.
- Reinforce their experience.
- Invite them again.

STYLE:
- Use simple, clear language.
- Personalize using reviewer name if available.
- Avoid repeating the same phrases in every reply.

RATING-BASED GOAL:

If rating is 5:
- Express gratitude warmly.
- Reinforce the positive experience.
- Invite the patient to visit again.

If rating is 4:
- Appreciate the feedback.
- Acknowledge any minor concern (if present).
- Maintain a positive tone.

If rating is 3:
- Maintain a balanced tone.
- Acknowledge concerns clearly.
- Show willingness to improve.
- Optionally invite the patient to reconnect.

If rating is 1 or 2:
- Be empathetic and calm.
- Apologize for the experience (without admitting fault blindly).
- Do NOT argue or justify.
- Move conversation offline (call/WhatsApp/visit clinic).
- Prioritize trust recovery.

Return output in JSON format:
{
  "reply": "final reply text",
  "tone_used": "tone type",
  "category": "positive/neutral/negative",
  "needs_human_review": true/false
}

Clinic Information:
- Clinic Name: {{clinic_name}}
- Doctor Name: {{doctor_name}}
- Speciality: {{speciality}}
- Location: {{location}}
- Tone: {{tone}} (e.g., warm, professional, friendly)
- Services: {{services}}
- Contact CTA: {{contact_cta}}

Review Details:
- Reviewer Name: {{reviewer_name}}
- Rating: {{rating}} (1 to 5)
- Review Text: {{review_text}}
- Language: {{language}} (English/Hinglish/etc.)
- Reply Length: {{short/medium/long}}

Write an appropriate reply.`;

    const runAction = async (fn) => {
        setActionError('');
        try {
            await fn();
            await fetchData(meta.current_page);
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Action failed');
        }
    };

    if (!module) {
        return <div className="rounded border bg-white p-4">Unknown module.</div>;
    }

    const addLabel = moduleKey === 'patients'
        ? 'New Patient'
        : moduleKey === 'doctors'
            ? 'New Doctor'
            : moduleKey === 'services'
                ? 'New Service'
                : moduleKey === 'appointments'
                    ? 'New Appointment'
                : moduleKey === 'clinics'
                    ? 'Onboard Clinic'
                : 'Add New';

    // Clinics are created through the onboarding wizard, not the generic form.
    const addHref = moduleKey === 'clinics' ? '/workflows/onboard-clinic' : `/modules/${moduleKey}/new`;

    const canCreate = canCreateModule(user?.role, moduleKey, scope?.can);
    const canEdit = canEditModule(user?.role, moduleKey, scope?.can);
    const canDelete = canDeleteModule(user?.role, moduleKey, scope?.can);
    const isReadOnly = !canEdit;


    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="module" className="h-5 w-5 text-slate-700" />
                    <h2 className="text-xl font-semibold text-slate-800">{module.label}</h2>
                </div>
                <div className="flex items-center gap-2">
                    {canDownloadPdf ? (
                        <button
                            type="button"
                            onClick={downloadPdfReport}
                            disabled={pdfBusy}
                            className={pdfBusy
                                ? 'rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500'
                                : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
                            }
                        >
                            Download PDF report
                        </button>
                    ) : null}

                    {moduleKey === 'reviews' ? (
                        <button
                            type="button"
                            onClick={() => setReviewCreate((p) => ({ ...p, open: true, error: '', busy: false, values: { reviewer_name: '', message: '', rating: '5' } }))}
                            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                            Add Review
                        </button>
                    ) : (
                        canCreate ? (
                            <Link to={addHref} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">{addLabel}</Link>
                        ) : null
                    )}
                </div>
            </div>

            <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-1 items-center gap-2">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') fetchData(1);
                        }}
                        placeholder="Search"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    />
                </div>

                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={includeDeleted}
                        onChange={(e) => {
                            const next = e.target.checked;
                            setIncludeDeleted(next);
                            fetchData(1, { includeDeleted: next });
                        }}
                    />
                    Include deleted
                </label>

                {filterFields.length ? (
                    <button
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
                    </button>
                ) : null}

                <button onClick={() => fetchData(1)} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">Search</button>
                <button
                    type="button"
                    onClick={() => {
                        setSearch('');
                        setFilters({});
                        setIncludeDeleted(false);
                        fetchData(1, { search: '', filters: {}, includeDeleted: false });
                    }}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    Clear
                </button>
            </div>

            {moduleKey === 'reviews' ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mr-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <AppIcon name="section" className="h-4 w-4" />
                        Quick Filters
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                            {[{ label: 'All Ratings', value: '' }, { label: '5★', value: '5' }, { label: '4★', value: '4' }, { label: '3★', value: '3' }, { label: '2★', value: '2' }, { label: '1★', value: '1' }].map((opt) => {
                                const active = String(filters?.rating ?? '') === String(opt.value);
                                return (
                                    <button
                                        key={opt.label}
                                        type="button"
                                        onClick={() => setFilterAndFetch('rating', opt.value)}
                                        className={active
                                            ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white'
                                            : 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                            {[{ label: 'All Sentiments', value: '' }, { label: 'Positive', value: 'positive' }, { label: 'Neutral', value: 'neutral' }, { label: 'Negative', value: 'negative' }].map((opt) => {
                                const active = String(filters?.sentiment ?? '') === String(opt.value);
                                return (
                                    <button
                                        key={opt.label}
                                        type="button"
                                        onClick={() => setFilterAndFetch('sentiment', opt.value)}
                                        className={active
                                            ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white'
                                            : 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : null}

            {actionError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
                    {actionError}
                </div>
            ) : null}

            {filtersOpen ? (
                <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setFiltersOpen(false)} />

                    <div className="relative ml-auto h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="flex items-center gap-2">
                                <AppIcon name="section" className="h-5 w-5 text-slate-700" />
                                <h3 className="text-base font-semibold text-slate-800">Filters</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFiltersOpen(false)}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            {filterFields.map((field) => (
                                <div key={field.key}>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {field.label}
                                    </label>
                                    <FilterControl
                                        field={field}
                                        value={filters[field.key] ?? ''}
                                        onChange={(key, val) => setFilters((prev) => ({ ...prev, [key]: val }))}
                                        relationOptions={field.type === 'relation' ? (relationState?.[field.resource]?.options || []) : undefined}
                                        relationLoading={field.type === 'relation' ? Boolean(relationState?.[field.resource]?.loading) : false}
                                        relationHint={field.type === 'relation' && field.resource === 'doctors' && user?.role === 'super_admin' && !filters?.clinic_id ? 'Select Clinic first' : ''}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="sticky bottom-0 border-t border-slate-200 bg-white p-5">
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setFilters({})}
                                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    Reset Filters
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFiltersOpen(false);
                                        fetchData(1);
                                    }}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {loading ? <div className="rounded border bg-white p-4">Loading...</div> : (
                <DataTable
                    rows={rows}
                    actionMode="buttons"
                    buttonActions={moduleKey === 'users'
                        ? ['view', 'edit', 'delete', 'restore', 'block', 'unblock']
                        : (moduleKey === 'doctors' || moduleKey === 'services')
                            ? ['view', 'edit', 'delete', 'block', 'unblock']
                            : moduleKey === 'reviews'
                                ? ['view', 'generate_reply', 'view_reply', 'edit', 'delete']
                            : undefined}
                    priorityColumns={[]}
                    extraActionsForRow={moduleKey === 'reviews'
                        ? (row) => {
                            const hasReply = Boolean(String(row?.reply_text || '').trim());
                            return hasReply
                                ? [{ value: 'view_reply', label: 'View Reply' }]
                                : [{ value: 'generate_reply', label: 'Generate Reply' }];
                        }
                        : undefined}
                    onExtraAction={(action, row) => {
                        if (moduleKey !== 'reviews') return;

                        if (action === 'generate_reply') {
                            setReplyDialog({
                                open: true,
                                row,
                                mode: 'generate',
                                busy: false,
                                saving: false,
                                error: '',
                                options: { reply_type: 'medium', language: 'english', tone: 'professional', case_data: '' },
                                generated: null,
                            });
                            return;
                        }

                        if (action === 'view_reply') {
                            const replyText = String(row?.reply_text || '').trim();
                            setReplyDialog({
                                open: true,
                                row,
                                mode: 'view',
                                busy: false,
                                saving: false,
                                error: '',
                                options: { reply_type: 'medium', language: 'english', tone: 'professional', case_data: '' },
                                generated: replyText ? { reply: replyText } : null,
                            });
                        }
                    }}
                    hiddenColumns={moduleKey === 'patients'
                        ? ['uuid']
                        : moduleKey === 'clinics'
                            ? ['uuid', 'legal_name', 'subscription']
                        : moduleKey === 'doctors'
                            ? ['user_id', 'registration_number']
                            : moduleKey === 'users'
                                ? ['uuid', 'email_verified_at', 'phone_verified_at', 'login_type', 'last_login_ip']
                                : moduleKey === 'reviews'
                                    ? ['sentiment_message', 'improvement_suggestion', 'reply_text', 'reply_meta', 'replied_at', 'reply_category', 'reply_tone_used', 'reply_needs_human_review']
                                : []}
                    columnLabels={moduleKey === 'doctors'
                        ? { full_name: 'Doctor Name' }
                        : moduleKey === 'clinicSettings'
                            ? { clinic: 'Clinic' }
                        : moduleKey === 'users'
                            ? { last_login_at: 'Last Login' }
                            : {}}
                    cellRenderers={moduleKey === 'doctors'
                        ? {
                            full_name: (value, row) => {
                                const title = String(row?.title ?? '').trim();
                                const name = String(value ?? '').trim();
                                return [title, name].filter(Boolean).join(' ');
                            },
                        }
                        : moduleKey === 'clinics'
                            ? {
                                status: (value, row) => (
                                    <ClinicStatusBadge clinicStatus={value} subscriptionStatus={row?.subscription?.status} />
                                ),
                                logo_url: (value) => {
                                    if (!value) return <span className="text-gray-300">—</span>;
                                    return <img src={value} alt="Logo" className="h-8 w-8 rounded-lg object-contain border border-gray-200 bg-gray-50" />;
                                },
                            }
                        : moduleKey === 'users'
                            ? {
                                last_login_at: (value) => {
                                    if (!value) return 'Never';
                                    const d = new Date(String(value));
                                    if (Number.isNaN(d.getTime())) return String(value);
                                    try {
                                        return new Intl.DateTimeFormat(undefined, {
                                            weekday: 'short',
                                            month: 'short',
                                            day: '2-digit',
                                            year: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        }).format(d);
                                    } catch {
                                        return d.toLocaleString();
                                    }
                                },
                            }
                            : moduleKey === 'reviews'
                                ? {
                                    sentiment: (value) => {
                                        if (!value) return '—';
                                        return <StatusBadge status={String(value)} />;
                                    },
                                    review_date: (value) => {
                                        if (!value) return '—';
                                        const d = new Date(String(value));
                                        if (Number.isNaN(d.getTime())) return String(value);
                                        try {
                                            return new Intl.DateTimeFormat(undefined, {
                                                month: 'short',
                                                day: '2-digit',
                                                year: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit',
                                            }).format(d);
                                        } catch {
                                            return d.toLocaleString();
                                        }
                                    },
                                    message: (value) => {
                                        const text = String(value ?? '').trim();
                                        if (!text) return '—';
                                        return (
                                            <div
                                                className="max-w-xl text-slate-700"
                                                style={{
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 3,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}
                                                title={text}
                                            >
                                                {text}
                                            </div>
                                        );
                                    },
                                }
                                : {}}
                    blockActionStatuses={moduleKey === 'clinics'
                        ? ['active', 'trial']
                        : moduleKey === 'doctors' || moduleKey === 'services'
                            ? ['active']
                            : undefined}
                    unblockActionStatuses={moduleKey === 'clinics'
                        ? ['suspended', 'inactive', '']
                        : moduleKey === 'doctors' || moduleKey === 'services'
                            ? ['inactive']
                            : undefined}
                    blockActionLabel={moduleKey === 'clinics' ? 'Suspend' : moduleKey === 'services' ? 'Deactivate' : undefined}
                    unblockActionLabel={moduleKey === 'clinics' ? 'Activate' : moduleKey === 'services' ? 'Activate' : undefined}
                    onView={(row) => {
                        if (moduleKey === 'clinics' && user?.role === 'super_admin') {
                            navigate(`/workflows/clinics/${row.id}`);
                            return;
                        }
                        if (viewMode === 'route') {
                            navigate(`/modules/${moduleKey}/${row.id}`);
                            return;
                        }
                        if (moduleKey === 'reviews') {
                            (async () => {
                                setActionError('');
                                try {
                                    const res = await client.get(`${base}/${module.path}/${row.id}`);
                                    setViewRecord(res?.data?.data || row);
                                } catch (e) {
                                    setActionError(e?.response?.data?.message || e?.message || 'Failed to load record');
                                    setViewRecord(row);
                                }
                            })();
                            return;
                        }
                        setViewRecord(row);
                    }}
                    onEdit={isReadOnly ? undefined : (row) => navigate(`/modules/${moduleKey}/${row.id}/edit`)}
                    onDelete={!canDelete || moduleKey === 'clinicSettings'
                        ? undefined
                        : (row) => {
                            setConfirm({ open: true, row, busy: false });
                        }}
                    onRestore={(row) => runAction(() => client.post(`${base}/${module.path}/${row.id}/restore`))}
                    onBlock={isReadOnly ? undefined : (row) => runAction(() => {
                        if (moduleKey === 'doctors' || moduleKey === 'services') {
                            return client.put(`${base}/${module.path}/${row.id}`, { status: 'inactive' });
                        }
                        return client.post(`${base}/${module.path}/${row.id}/block`);
                    })}
                    onUnblock={isReadOnly ? undefined : (row) => runAction(() => {
                        if (moduleKey === 'doctors' || moduleKey === 'services') {
                            return client.put(`${base}/${module.path}/${row.id}`, { status: 'active' });
                        }
                        return client.post(`${base}/${module.path}/${row.id}/unblock`);
                    })}
                />
            )}

            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
                <span>Page {meta.current_page} / {Math.max(1, Math.ceil(meta.total / meta.per_page))} • Total {meta.total}</span>
                <div className="space-x-2">
                    <button disabled={meta.current_page <= 1} onClick={() => fetchData(meta.current_page - 1)} className="rounded-xl border border-slate-300 px-3 py-1 disabled:opacity-50">Prev</button>
                    <button disabled={meta.current_page >= Math.ceil(meta.total / meta.per_page)} onClick={() => fetchData(meta.current_page + 1)} className="rounded-xl border border-slate-300 px-3 py-1 disabled:opacity-50">Next</button>
                </div>
            </div>

            {moduleKey === 'reviews' ? (
                viewRecord ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => setViewRecord(null)}>
                        <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-5 py-4 text-white">
                                <div className="flex items-center gap-2">
                                    <AppIcon name="view" className="h-5 w-5" />
                                    <h3 className="text-lg font-semibold">Review Details</h3>
                                </div>
                                <button onClick={() => setViewRecord(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Close</button>
                            </div>

                            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reviewer</div>
                                        <div className="mt-1 text-sm text-slate-800">{viewRecord.reviewer_name || '—'}</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rating</div>
                                        <div className="mt-1 text-sm text-slate-800">{viewRecord.rating ?? '—'}</div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review Message</div>
                                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{viewRecord.message || '—'}</div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sentiment</div>
                                        <div className="mt-2">{viewRecord.sentiment ? <StatusBadge status={String(viewRecord.sentiment)} /> : '—'}</div>
                                        {viewRecord.sentiment_message ? (
                                            <div className="mt-2 text-sm text-slate-700">{viewRecord.sentiment_message}</div>
                                        ) : null}
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Improvement</div>
                                        <div className="mt-2 text-sm text-slate-700">{viewRecord.improvement_suggestion || '—'}</div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Reply</div>
                                            <div className="mt-1 text-xs text-slate-500">{viewRecord.replied_at ? `Replied at: ${String(viewRecord.replied_at)}` : 'No reply saved yet.'}</div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!String(viewRecord.reply_text || '').trim()}
                                            onClick={async () => {
                                                const text = String(viewRecord.reply_text || '').trim();
                                                if (!text) return;
                                                try {
                                                    await navigator.clipboard.writeText(text);
                                                } catch {
                                                    // ignore
                                                }
                                            }}
                                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            Copy Reply
                                        </button>
                                    </div>
                                    <div className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{viewRecord.reply_text || '—'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null
            ) : (
                <RecordDialog
                    open={Boolean(viewRecord)}
                    title={`${module.label} Details`}
                    variant="sheet"
                    record={viewRecord}
                    hiddenKeys={moduleKey === 'users'
                        ? ['uuid', 'email_verified_at', 'phone_verified_at', 'login_type', 'last_login_ip']
                        : []}
                    onClose={() => setViewRecord(null)}
                />
            )}

            {reviewCreate.open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => setReviewCreate((p) => ({ ...p, open: false }))}>
                    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-5 py-4 text-white">
                            <div className="flex items-center gap-2">
                                <AppIcon name="module" className="h-5 w-5" />
                                <h3 className="text-lg font-semibold">Add Review</h3>
                            </div>
                            <button onClick={() => setReviewCreate((p) => ({ ...p, open: false }))} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Close</button>
                        </div>

                        <div className="space-y-4 p-5">
                            {reviewCreate.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {reviewCreate.error}
                                </div>
                            ) : null}

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reviewer Name</label>
                                    <input
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                        value={reviewCreate.values.reviewer_name}
                                        onChange={(e) => setReviewCreate((p) => ({ ...p, values: { ...p.values, reviewer_name: e.target.value } }))}
                                        placeholder="e.g. Rahul"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Rating</label>
                                    <select
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                        value={reviewCreate.values.rating}
                                        onChange={(e) => setReviewCreate((p) => ({ ...p, values: { ...p.values, rating: e.target.value } }))}
                                    >
                                        {['5', '4', '3', '2', '1'].map((r) => (
                                            <option key={r} value={r}>{r} Star{r === '1' ? '' : 's'}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Review Message</label>
                                <textarea
                                    className="min-h-[120px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                    value={reviewCreate.values.message}
                                    onChange={(e) => setReviewCreate((p) => ({ ...p, values: { ...p.values, message: e.target.value } }))}
                                    placeholder="Write the review text here"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setReviewCreate((p) => ({ ...p, open: false }))}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={reviewCreate.busy}
                                onClick={async () => {
                                    const v = reviewCreate.values;
                                    if (!String(v.message || '').trim()) {
                                        setReviewCreate((p) => ({ ...p, error: 'Review message is required' }));
                                        return;
                                    }

                                    setReviewCreate((p) => ({ ...p, busy: true, error: '' }));
                                    try {
                                        await client.post(`${base}/reviews`, {
                                            reviewer_name: String(v.reviewer_name || '').trim() || null,
                                            message: String(v.message || '').trim(),
                                            rating: Number(v.rating || 5),
                                        });
                                        setReviewCreate((p) => ({ ...p, open: false, busy: false }));
                                        await fetchData(1);
                                    } catch (e) {
                                        setReviewCreate((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Create failed' }));
                                    }
                                }}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                            >
                                {reviewCreate.busy ? 'Creating…' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {replyDialog.open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => setReplyDialog((p) => ({ ...p, open: false }))}>
                    <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-5 py-4 text-white">
                            <div className="flex items-center gap-2">
                                <AppIcon name="section" className="h-5 w-5" />
                                <h3 className="text-lg font-semibold">Generate Reply</h3>
                            </div>
                            <button onClick={() => setReplyDialog((p) => ({ ...p, open: false }))} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Close</button>
                        </div>

                        <div className="space-y-4 p-5">
                            {replyDialog.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {replyDialog.error}
                                </div>
                            ) : null}

                            {replyDialog.mode === 'generate' ? (
                                <>
                                    <div className="grid gap-4 md:grid-cols-3">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reply Type</label>
                                    <select
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                        value={replyDialog.options.reply_type}
                                        onChange={(e) => setReplyDialog((p) => ({ ...p, options: { ...p.options, reply_type: e.target.value } }))}
                                    >
                                        <option value="short">Short</option>
                                        <option value="medium">Medium</option>
                                        <option value="detailed">Detailed</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Language</label>
                                    <select
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                        value={replyDialog.options.language}
                                        onChange={(e) => setReplyDialog((p) => ({ ...p, options: { ...p.options, language: e.target.value } }))}
                                    >
                                        <option value="english">English</option>
                                        <option value="hindi">Hindi</option>
                                        <option value="hinglish">Hinglish</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Tone</label>
                                    <select
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                        value={replyDialog.options.tone}
                                        onChange={(e) => setReplyDialog((p) => ({ ...p, options: { ...p.options, tone: e.target.value } }))}
                                    >
                                        <option value="professional">Professional</option>
                                        <option value="warm">Warm</option>
                                        <option value="reassuring">Reassuring</option>
                                        <option value="friendly">Friendly</option>
                                    </select>
                                </div>
                            </div>

                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Case Data / Context (optional)</label>
                                        <textarea
                                            className="min-h-[90px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                            value={replyDialog.options.case_data}
                                            onChange={(e) => setReplyDialog((p) => ({ ...p, options: { ...p.options, case_data: e.target.value } }))}
                                            placeholder="For low ratings/complaints, add context here (no medical advice)."
                                        />
                                    </div>

                            <div className="flex items-center justify-between gap-2">
                                <div className="text-sm text-slate-600">
                                    Generates a suggested reply using the review text + rating.
                                </div>
                                <button
                                    type="button"
                                    disabled={replyDialog.busy}
                                    onClick={async () => {
                                        if (!replyDialog.row?.id) return;
                                        setReplyDialog((p) => ({ ...p, busy: true, error: '' }));
                                        try {
                                            const res = await client.post(`${base}/reviews/${replyDialog.row.id}/generate-reply`, {
                                                ...replyDialog.options,
                                                prompt: reviewReplyPrompt,
                                            });
                                            setReplyDialog((p) => ({ ...p, busy: false, generated: res?.data?.data || null }));
                                        } catch (e) {
                                            setReplyDialog((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Generate failed' }));
                                        }
                                    }}
                                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {replyDialog.busy ? 'Generating…' : 'Generate Reply'}
                                </button>
                            </div>

                                </>
                            ) : (
                                <div className="text-sm text-slate-600">
                                    Saved reply preview.
                                </div>
                            )}

                            {replyDialog.generated?.reply ? (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Generated Reply</div>
                                    <div className="whitespace-pre-wrap text-sm text-slate-800">{replyDialog.generated.reply}</div>
                                </div>
                            ) : null}
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setReplyDialog((p) => ({ ...p, open: false }))}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!replyDialog.generated?.reply}
                                onClick={async () => {
                                    const text = String(replyDialog.generated?.reply || '').trim();
                                    if (!text) return;
                                    try {
                                        await navigator.clipboard.writeText(text);
                                    } catch {
                                        // ignore
                                    }
                                }}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Copy Reply
                            </button>
                            {replyDialog.mode === 'generate' ? (
                                <button
                                    type="button"
                                    disabled={replyDialog.saving || !replyDialog.generated?.reply}
                                    onClick={async () => {
                                        if (!replyDialog.row?.id || !replyDialog.generated) return;
                                        setReplyDialog((p) => ({ ...p, saving: true, error: '' }));
                                        try {
                                            await client.post(`${base}/reviews/${replyDialog.row.id}/reply`, replyDialog.generated);
                                            setReplyDialog((p) => ({ ...p, saving: false, open: false }));
                                            await fetchData(meta.current_page);
                                        } catch (e) {
                                            setReplyDialog((p) => ({ ...p, saving: false, error: e?.response?.data?.message || e?.message || 'Save failed' }));
                                        }
                                    }}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                                >
                                    {replyDialog.saving ? 'Saving…' : 'Save'}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}

            <ConfirmDialog
                open={confirm.open}
                title={`Delete ${module.label}`}
                message={confirm.row ? `Are you sure you want to delete this record (#${confirm.row.id})?` : 'Are you sure you want to delete this record?'}
                confirmText="Delete"
                danger
                busy={confirm.busy}
                onClose={() => setConfirm({ open: false, row: null, busy: false })}
                onConfirm={async () => {
                    if (!confirm.row) return;
                    setConfirm((p) => ({ ...p, busy: true }));
                    setActionError('');
                    try {
                        await client.delete(`${base}/${module.path}/${confirm.row.id}`);
                        setConfirm({ open: false, row: null, busy: false });
                        await fetchData(meta.current_page);
                    } catch (e) {
                        setConfirm((p) => ({ ...p, busy: false }));
                        setActionError(e?.response?.data?.message || e?.message || 'Delete failed');
                    }
                }}
            />
        </div>
    );
}
