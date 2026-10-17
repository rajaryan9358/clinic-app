import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import client from '../api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import AppIcon from '../components/AppIcon';
import Skeleton from '../components/Skeleton';
import ClinicStatusBadge from '../components/billing/ClinicStatusBadge.jsx';
import { modules } from '../config/modules';
import { canAccessModule, canCreateModule, canDeleteModule, canEditModule, isSuperAdminHiddenModuleKey } from '../config/access';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import { fieldLabel, prettifyKey } from '../utils/moduleRecord';

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

// The permission check lives in the default-exported wrapper below, not
// here, so this component can call every hook it needs unconditionally.
// (Early-returning `<Navigate>` from between two hook calls means the
// number of hooks called can change between renders of the SAME mounted
// instance — e.g. once `moduleKey` changes, or once the scope context
// finishes loading — which React forbids and crashes on.)
function ModuleListPageInner({ forcedModuleKey } = {}) {
    const { moduleKey: routeModuleKey } = useParams();
    const moduleKey = forcedModuleKey || routeModuleKey;
    const navigate = useNavigate();
    const { user } = useAuth();
    const scope = useScope();
    const module = modules[moduleKey];

    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState({ current_page: 1, per_page: 15, total: 0 });
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState({});
    const [loading, setLoading] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [includeDeleted, setIncludeDeleted] = useState(false);
    const [actionError, setActionError] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);
    const [confirm, setConfirm] = useState({ open: false, row: null, busy: false });

    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

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
                    label: fieldLabel(module, key, fromForm.label),
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
                    label: fieldLabel(module, key, fromForm.label),
                };
            }

            if (String(key).endsWith('_id')) {
                return { key, label: fieldLabel(module, key), type: 'number' };
            }

            if (String(key).endsWith('_date')) {
                return { key, label: fieldLabel(module, key), type: 'date' };
            }

            return { key, label: fieldLabel(module, key), type: 'text' };
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

    // With no search or filter active, an empty list means "nothing here yet":
    // say what the screen is for and offer the primary action. With one
    // active, it means "nothing matched", so keep the generic hint.
    const hasActiveQuery = Boolean(search.trim()) || activeFilterCount > 0 || includeDeleted;
    const emptyState = module.empty && !hasActiveQuery ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                <AppIcon name={module.icon || 'module'} className="h-6 w-6 text-slate-500" />
            </div>
            <p className="text-sm font-semibold text-slate-800">{module.empty.title}</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">{module.empty.body}</p>
            {canCreate && module.emptyAction !== false ? (
                <Link to={addHref} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                    <AppIcon name="plus" className="h-4 w-4" />
                    {addLabel}
                </Link>
            ) : null}
        </div>
    ) : null;


    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name={module.icon || 'module'} className="h-5 w-5 text-slate-700" />
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

                    {canCreate ? (
                        <Link to={addHref} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">{addLabel}</Link>
                    ) : null}
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

            {loading ? <Skeleton variant="table" rows={8} cols={5} /> : (
                <DataTable
                    rows={rows}
                    actionMode="buttons"
                    buttonActions={moduleKey === 'users'
                        ? ['view', 'edit', 'delete', 'restore', 'block', 'unblock']
                        : (moduleKey === 'doctors' || moduleKey === 'services')
                            ? ['view', 'edit', 'delete', 'block', 'unblock']
                            : undefined}
                    priorityColumns={[]}
                    hiddenColumns={moduleKey === 'patients'
                        ? ['uuid']
                        : moduleKey === 'clinics'
                            ? ['uuid', 'legal_name', 'subscription']
                        : moduleKey === 'doctors'
                            ? ['user_id', 'registration_number', 'consultation_line', 'followup_line']
                            : moduleKey === 'users'
                                ? ['uuid', 'email_verified_at', 'phone_verified_at', 'login_type', 'last_login_ip']
                                : []}
                    columnLabels={moduleKey === 'doctors' ? { full_name: 'Doctor Name' } : (module.labels || {})}
                    emptyState={emptyState}
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
                        // Patients and doctors reach their own profile pages through this same
                        // route (see App.jsx); everything else lands on ModuleViewPage.
                        navigate(`/modules/${moduleKey}/${row.id}`);
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

export default function ModuleListPage({ forcedModuleKey } = {}) {
    const { moduleKey: routeModuleKey } = useParams();
    const moduleKey = forcedModuleKey || routeModuleKey;
    const { user } = useAuth();
    const scope = useScope();

    if (user?.role === 'super_admin' && isSuperAdminHiddenModuleKey(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!canAccessModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <ModuleListPageInner forcedModuleKey={forcedModuleKey} />;
}
