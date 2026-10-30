import { useEffect, useMemo, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import { Alert, btn, input as inputClass, label as labelClass } from './ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import { isAutoDocRole } from '../config/access';

function inferLabel(item) {
    if (!item || typeof item !== 'object') return '';
    const candidates = [
        item.name, item.full_name, item.host, item.invoice_number,
        item.reference_number, item.phone_number, item.business_name,
        item.customer_phone, item.uuid, item.code, item.email, item.phone,
    ];
    const first = candidates.find((v) => typeof v === 'string' && v.trim().length);
    return first || `#${item.id}`;
}

const inputBase = `${inputClass} h-10`;
const textareaBase = inputClass;

function InputControl({ id, field, value, onChange, relationOptions, relationLoading, relationHint, imageState, onPickImage, onClearImage }) {
    if (field.type === 'image') {
        const url = typeof value === 'string' ? value : '';
        const loading = Boolean(imageState?.loading);
        const err = imageState?.error || '';

        return (
            <div className="space-y-3">
                {url ? (
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <img src={url} alt={field.label} className="h-14 w-14 rounded-lg border border-slate-200 object-cover" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-slate-600">{url}</p>
                            <button
                                type="button"
                                onClick={onClearImage}
                                className="mt-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                                Remove image
                            </button>
                        </div>
                    </div>
                ) : null}
                <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${loading ? 'border-blue-200 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50'}`}>
                    {loading
                        ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                        : <AppIcon name="download" className="h-6 w-6 text-slate-500" />}
                    <span className="text-sm text-slate-600">
                        {loading ? 'Uploading…' : 'Click to upload image'}
                    </span>
                    <input
                        id={id}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={loading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickImage(f); e.target.value = ''; }}
                        className="sr-only"
                    />
                </label>
                {err ? <p className="text-xs text-rose-700">{err}</p> : null}
            </div>
        );
    }

    if (field.type === 'select') {
        // Options are either plain strings (value === label, e.g. a status
        // enum) or { value, label } objects (e.g. a role picker showing a
        // human label while sending the role's name) — normalize once here.
        const options = (field.options || []).map((opt) => (
            typeof opt === 'string' ? { value: opt, label: opt } : opt
        ));

        return (
            <select id={id} className={inputBase} value={value ?? ''} onChange={(e) => onChange(field.key, e.target.value)}>
                <option value="">Select {field.label}</option>
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        );
    }

    if (field.type === 'relation') {
        const options = relationOptions || [];
        const isMulti = Boolean(field.multiple);

        if (isMulti) {
            const normalized = Array.isArray(value)
                ? value.map((v) => String(v))
                : (value === '' || value === null || value === undefined) ? [] : [String(value)];

            const toggle = (val) => {
                const next = normalized.includes(val)
                    ? normalized.filter((v) => v !== val)
                    : [...normalized, val];
                onChange(field.key, next);
            };

            if (relationLoading) {
                return <p className="text-sm text-slate-600">Loading…</p>;
            }

            if (!options.length) {
                return <p className="text-sm text-slate-600">No options available.</p>;
            }

            return (
                <div id={id} role="group" className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-300">
                    {options.map((opt) => {
                        const checked = normalized.includes(opt.value);
                        return (
                            <label
                                key={opt.value}
                                className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${checked ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(opt.value)}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-800">{opt.label}</span>
                            </label>
                        );
                    })}
                </div>
            );
        }

        const normalized = value === null || value === undefined ? '' : String(value);
        return (
            <select id={id} className={inputBase} value={normalized} onChange={(e) => onChange(field.key, e.target.value)}>
                <option value="">Select {field.label}</option>
                {relationHint ? <option value="" disabled>{relationHint}</option> : null}
                {relationLoading ? <option disabled>Loading…</option> : null}
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        );
    }

    if (field.type === 'textarea') {
        return (
            <textarea
                id={id}
                className={`${textareaBase} min-h-[100px] resize-y`}
                value={value ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}…`}
            />
        );
    }

    if (field.type === 'checkbox') {
        return (
            <label className="inline-flex cursor-pointer items-center gap-3">
                <div className="relative">
                    <input
                        id={id}
                        type="checkbox"
                        role="switch"
                        checked={Boolean(value)}
                        onChange={(e) => onChange(field.key, e.target.checked)}
                        className="peer sr-only"
                    />
                    <div className={`flex h-6 w-11 items-center rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 ${Boolean(value) ? 'bg-blue-600' : 'bg-slate-300'}`}>
                        <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${Boolean(value) ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </div>
                </div>
                <span className="text-sm text-slate-700">{Boolean(value) ? 'Enabled' : 'Disabled'}</span>
            </label>
        );
    }

    return (
        <input
            id={id}
            type={field.type || 'text'}
            className={inputBase}
            value={value ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder || `Enter ${(field.label || '').toLowerCase()}…`}
        />
    );
}

export default function FormRenderer({ title, fields, values, onChange, onSubmit, submitLabel, error, onCancel, renderAfterField, renderTop }) {
    const { user } = useAuth();
    const { roleKind } = useScope() || {};
    const basePath = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const relationControllersRef = useRef({});

    const queryKeyFor = (resource) => {
        if (resource === 'doctors' && user?.role === 'super_admin') {
            return `clinic:${values?.clinic_id ?? ''}`;
        }
        return 'default';
    };

    const paramsFor = (resource) => {
        const params = { per_page: 200 };
        if (resource === 'doctors' && user?.role === 'super_admin') {
            if (!values?.clinic_id) return null;
            params.clinic_id = values.clinic_id;
        }
        return params;
    };

    const visibleFields = useMemo(() => {
        return (fields || []).filter((field) => {
            // clinic_id only visible to super_admin
            if (user?.role !== 'super_admin' && field.key === 'clinic_id') return false;
            // doctor_id hidden for doctor role (booking is always for themselves)
            if (isAutoDocRole(roleKind) && field.key === 'doctor_id') return false;
            return true;
        });
    }, [fields, user, roleKind]);

    const relationResources = useMemo(() => {
        const unique = new Set();
        visibleFields.forEach((f) => { if (f.type === 'relation' && f.resource) unique.add(f.resource); });
        return Array.from(unique);
    }, [visibleFields]);

    const [relationState, setRelationState] = useState({});
    const [imageUploads, setImageUploads] = useState({});

    const uploadImage = async (field, file) => {
        setImageUploads((prev) => ({ ...prev, [field.key]: { loading: true, error: '' } }));
        try {
            if (user?.role === 'super_admin' && !values?.clinic_id) {
                setImageUploads((prev) => ({ ...prev, [field.key]: { loading: false, error: 'Select a Clinic first' } }));
                return;
            }
            const form = new FormData();
            form.append('file', file);
            form.append('module', field.module || 'general');
            if (user?.role === 'super_admin') form.append('clinic_id', String(values.clinic_id));
            const res = await client.post(`${basePath}/uploads/image`, form);
            const url = res?.data?.data?.url;
            if (!url) throw new Error('Upload failed');
            onChange(field.key, url);
            setImageUploads((prev) => ({ ...prev, [field.key]: { loading: false, error: '' } }));
        } catch (e) {
            setImageUploads((prev) => ({ ...prev, [field.key]: { loading: false, error: e?.response?.data?.message || 'Upload failed' } }));
        }
    };

    useEffect(() => {
        const loadOne = async (resource, params, queryKey) => {
            try { relationControllersRef.current?.[resource]?.abort(); } catch { /* ignore */ }
            const controller = new AbortController();
            relationControllersRef.current[resource] = controller;
            setRelationState((prev) => ({ ...prev, [resource]: { loading: true, options: prev?.[resource]?.options || [], error: '', queryKey } }));
            try {
                const { data } = await client.get(`${basePath}/${resource}`, { params, signal: controller.signal });
                const items = Array.isArray(data?.data) ? data.data : [];
                const options = items
                    .filter((item) => item?.id !== undefined && item?.id !== null)
                    .map((item) => ({ value: String(item.id), label: inferLabel(item) }));
                if (relationControllersRef.current?.[resource] !== controller) return;
                setRelationState((prev) => ({ ...prev, [resource]: { loading: false, options, error: '', queryKey } }));
            } catch (e) {
                if (relationControllersRef.current?.[resource] !== controller) return;
                const isAbort = e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED';
                setRelationState((prev) => ({ ...prev, [resource]: { loading: false, options: prev?.[resource]?.options || [], error: isAbort ? '' : 'Failed to load', queryKey } }));
            }
        };

        relationResources.forEach((resource) => {
            const existing = relationState?.[resource];
            const queryKey = queryKeyFor(resource);
            const params = paramsFor(resource);
            if (params === null) {
                if (existing?.queryKey !== queryKey || existing?.loading) {
                    setRelationState((prev) => ({ ...prev, [resource]: { loading: false, options: [], error: '', queryKey } }));
                }
                return;
            }
            if (existing?.queryKey === queryKey && existing?.options?.length) return;
            loadOne(resource, params, queryKey);
        });

        return () => { relationResources.forEach((r) => { try { relationControllersRef.current?.[r]?.abort(); } catch { /* ignore */ } }); };
    }, [relationResources, basePath, values?.clinic_id, user?.role]);

    const topContent = typeof renderTop === 'function' ? renderTop() : null;

    return (
        <section className="rounded-2xl border border-slate-200 bg-white">
            {title ? (
                <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                </div>
            ) : null}

            <form onSubmit={onSubmit}>
                <div className="p-5 pb-0">
                    {error ? (
                        <div className="mb-5"><Alert tone="error">{error}</Alert></div>
                    ) : null}

                    {topContent ? (
                        <div className="mb-5">{topContent}</div>
                    ) : null}

                    <div className="grid gap-5 md:grid-cols-2">
                        {visibleFields.flatMap((field) => {
                            const after = typeof renderAfterField === 'function' ? renderAfterField(field) : null;
                            const nodes = [
                                (
                                    <div key={field.key} className={field.full ? 'md:col-span-2' : ''}>
                                        <label htmlFor={`field-${field.key}`} className={labelClass}>
                                            {field.label}
                                            {field.required ? <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span> : null}
                                        </label>
                                        <InputControl
                                            id={`field-${field.key}`}
                                            field={field}
                                            value={values[field.key]}
                                            onChange={onChange}
                                            relationOptions={field.type === 'relation' ? (relationState?.[field.resource]?.options || []) : undefined}
                                            relationLoading={field.type === 'relation' ? Boolean(relationState?.[field.resource]?.loading) : false}
                                            relationHint={
                                                field.type === 'relation' && field.resource === 'doctors' &&
                                                user?.role === 'super_admin' && !values?.clinic_id
                                                    ? 'Select a Clinic first'
                                                    : ''
                                            }
                                            imageState={field.type === 'image' ? imageUploads?.[field.key] : undefined}
                                            onPickImage={field.type === 'image' ? ((file) => uploadImage(field, file)) : undefined}
                                            onClearImage={field.type === 'image' ? (() => onChange(field.key, '')) : undefined}
                                        />
                                        {field.type === 'relation' && relationState?.[field.resource]?.error ? (
                                            <p className="mt-1 text-xs text-rose-700">{relationState[field.resource].error}</p>
                                        ) : null}
                                    </div>
                                ),
                            ];
                            if (after) nodes.push(<div key={`${field.key}__after`}>{after}</div>);
                            return nodes;
                        })}
                    </div>
                </div>

                <div className="sticky bottom-0 mt-5 flex items-center justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-white px-5 py-4">
                    <button type="button" onClick={onCancel} className={btn.secondary}>
                        Cancel
                    </button>
                    <button type="submit" className={btn.primary}>
                        {submitLabel || 'Save'}
                    </button>
                </div>
            </form>
        </section>
    );
}
