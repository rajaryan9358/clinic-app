import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import AppIcon from './AppIcon';

const MIN_QUERY = 2;

function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function shortDate(ymd) {
    if (!ymd) return '';
    const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return String(ymd);
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short' }).format(d);
}

/**
 * ⌘K / Ctrl+K search across patients, upcoming appointments, quick actions
 * and the pages in the sidebar. `pages` is the flattened sidebar ({label, href});
 * patient and appointment search only runs for clinic users who can view them.
 */
export default function CommandPalette({ open, onClose, pages = [], can = () => false, isClinicUser = false }) {
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const [query, setQuery] = useState('');
    const [patients, setPatients] = useState([]);
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [active, setActive] = useState(0);
    // scope.can() may be a new function on every render; read it through a ref
    // so a parent re-render doesn't refire the search.
    const canRef = useRef(can);
    canRef.current = can;

    useEffect(() => {
        if (!open) return;
        setQuery('');
        setPatients([]);
        setAppointments([]);
        setActive(0);
        // Focus after the dialog has painted.
        const t = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(t);
    }, [open]);

    useEffect(() => {
        const q = query.trim();
        if (!open || !isClinicUser || q.length < MIN_QUERY) {
            setPatients([]);
            setAppointments([]);
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        const t = setTimeout(() => {
            const today = new Date();
            const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            Promise.all([
                canRef.current('patients.view')
                    ? client.get('/clinic/patients', { params: { search: q, per_page: 5 } }).then((r) => r.data?.data || []).catch(() => [])
                    : Promise.resolve([]),
                canRef.current('appointments.view')
                    ? client.get('/clinic/appointments', {
                        params: { search: q, per_page: 5, appointment_date_from: ymd, sort_by: 'appointment_date', sort_dir: 'asc' },
                    }).then((r) => r.data?.data || []).catch(() => [])
                    : Promise.resolve([]),
            ]).then(([p, a]) => {
                if (cancelled) return;
                setPatients(p);
                setAppointments(a);
                setLoading(false);
            });
        }, 200);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, open, isClinicUser]);

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        const out = [];

        if (patients.length) {
            out.push({
                title: 'Patients',
                items: patients.map((p) => ({
                    key: `p${p.id}`,
                    badge: initials(p.full_name),
                    badgeClass: 'bg-indigo-100 text-indigo-800',
                    title: p.full_name,
                    sub: [p.phone, p.gender, p.age ? `${p.age} yrs` : null].filter(Boolean).join(' · '),
                    href: `/modules/patients/${p.id}`,
                })),
            });
        }
        if (appointments.length) {
            out.push({
                title: 'Appointments',
                items: appointments.map((a) => ({
                    key: `a${a.id}`,
                    badge: String(a.start_time || '').slice(0, 5),
                    badgeClass: 'bg-blue-100 text-blue-800 text-[10px]',
                    title: `${a.patient?.full_name || 'Patient'} with ${a.doctor?.full_name || 'doctor'}`,
                    sub: [shortDate(a.appointment_date), String(a.status || '').replace(/_/g, ' ')].filter(Boolean).join(' · '),
                    href: `/modules/appointments/${a.id}`,
                })),
            });
        }

        const actions = [];
        if (can('appointments.create')) {
            actions.push({ key: 'book', icon: 'calendar-plus', title: 'Book appointment', sub: 'Pick a patient, doctor and slot', href: '/workflows/appointments/new' });
        }
        if (can('patients.create')) {
            actions.push({ key: 'patient', icon: 'user-plus', title: query.trim() ? `Add new patient “${query.trim()}”` : 'Add new patient', sub: 'Start a new patient record', href: '/modules/patients/new' });
        }
        if (isClinicUser && actions.length) out.push({ title: 'Do something', items: actions });

        const matchedPages = pages.filter((p) => !q || p.label.toLowerCase().includes(q)).slice(0, q ? 6 : 8);
        if (matchedPages.length) {
            out.push({
                title: 'Go to',
                items: matchedPages.map((p) => ({ key: `g${p.href}`, icon: p.icon || 'arrow-right', title: p.label, sub: p.section || '', href: p.href })),
            });
        }
        return out;
    }, [query, patients, appointments, pages, can, isClinicUser]);

    const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

    useEffect(() => { setActive(0); }, [groups]);

    if (!open) return null;

    const go = (item) => {
        if (!item) return;
        onClose();
        navigate(item.href);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(flat.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            go(flat[active]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    let index = -1;
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 px-4 pt-[10vh]" onMouseDown={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Search"
                className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={onKeyDown}
            >
                <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                    <AppIcon name="search" className="h-5 w-5 text-slate-500" />
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={isClinicUser ? 'Search patients by name or phone, bookings, pages…' : 'Go to a page…'}
                        aria-label="Search"
                        aria-controls="command-results"
                        aria-activedescendant={flat[active] ? `cmd-${flat[active].key}` : undefined}
                        className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
                    />
                    {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" aria-hidden="true" />}
                    <kbd className="rounded-md border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500">Esc</kbd>
                </div>

                <div id="command-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
                    {groups.length === 0 && (
                        <p className="px-3 py-6 text-center text-sm text-slate-500">
                            {query.trim().length >= MIN_QUERY && !loading ? 'Nothing found.' : 'Type to search.'}
                        </p>
                    )}
                    {groups.map((g) => (
                        <div key={g.title} className="py-1">
                            <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</p>
                            {g.items.map((item) => {
                                index += 1;
                                const i = index;
                                const selected = i === active;
                                return (
                                    <button
                                        key={item.key}
                                        id={`cmd-${item.key}`}
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        onMouseEnter={() => setActive(i)}
                                        onClick={() => go(item)}
                                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
                                    >
                                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${item.badgeClass || 'bg-slate-100 text-slate-600'}`}>
                                            {item.badge || <AppIcon name={item.icon} className="h-4 w-4" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-slate-900">{item.title}</span>
                                            {item.sub && <span className="block truncate text-xs text-slate-500">{item.sub}</span>}
                                        </span>
                                        {selected && <span className="text-xs text-slate-500">↵</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
                <div className="flex gap-4 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
                    <span>↑↓ to move</span><span>↵ to open</span><span>Esc to close</span>
                </div>
            </div>
        </div>
    );
}
