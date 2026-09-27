import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { BottomSheet, ErrorText, Spinner } from './ui';
import { CalendarIcon, ChevronRightIcon, HomeIcon, LogoutIcon, PillIcon, PlusIcon, SwitchIcon, UsersIcon } from './icons';

const NAV_ITEMS = [
    { to: '/', label: 'Home', icon: HomeIcon, end: true },
    { to: '/visits', label: 'Visits', icon: CalendarIcon },
    { to: '/book', label: 'Book', icon: PlusIcon },
    { to: '/prescriptions', label: 'Rx', icon: PillIcon },
    { to: '/family', label: 'Family', icon: UsersIcon },
];

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function accentColor(clinic) {
    return clinic?.primary_color && HEX_COLOR.test(clinic.primary_color) ? clinic.primary_color : null;
}

/**
 * The authenticated app shell: clinic header (with a clinic switcher for
 * accounts that hold profiles in more than one clinic), the routed page
 * body, and the bottom tab bar. Mounted once by App.jsx's protected
 * layout route; pages render into it via <Outlet />.
 */
export default function Shell() {
    const { me, activeProfile, logout } = useSession();
    const navigate = useNavigate();
    const [switcherOpen, setSwitcherOpen] = useState(false);
    const [switchingId, setSwitchingId] = useState(null);
    const [switchError, setSwitchError] = useState('');

    const clinic = me?.clinic;
    const clinics = me?.clinics ?? [];
    const showSwitcher = clinics.length > 1;
    const accent = accentColor(clinic);

    async function handleSwitchClinic(row) {
        setSwitchError('');
        setSwitchingId(row.patient_id);
        try {
            const { data } = await api.post('/auth/switch-clinic', { patient_id: row.patient_id });
            localStorage.setItem('portal_token', data.data.token);
            localStorage.removeItem('portal_profile');
            // Full reload rather than an in-SPA refresh: the new token
            // belongs to a different account/clinic entirely, so every
            // cached bit of session state needs to start over clean.
            window.location.assign('/portal');
        } catch (err) {
            setSwitchError(err?.response?.data?.message || "Could not switch clinics. Please try again.");
            setSwitchingId(null);
        }
    }

    async function handleLogout() {
        await logout();
        navigate('/login', { replace: true });
    }

    return (
        <div style={accent ? { '--accent': accent } : undefined} className="min-h-screen bg-slate-50">
            <div className="mx-auto flex min-h-screen max-w-md flex-col bg-slate-50">
                <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        {clinic?.logo_url ? (
                            <img src={clinic.logo_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                                {(clinic?.name || 'C').charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{clinic?.name || 'Clinic'}</p>
                            <p className="truncate text-xs text-slate-500">
                                {activeProfile?.full_name || me?.account?.full_name}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {showSwitcher && (
                            <button
                                type="button"
                                onClick={() => setSwitcherOpen(true)}
                                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                                aria-label="Switch clinic"
                            >
                                <SwitchIcon className="h-5 w-5" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                            aria-label="Log out"
                        >
                            <LogoutIcon className="h-5 w-5" />
                        </button>
                    </div>
                </header>

                <main className="flex-1 px-4 py-4 pb-24">
                    <Outlet />
                </main>

                <nav
                    className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md border-t border-slate-100 bg-white"
                    style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
                    aria-label="Primary"
                >
                    <ul className="grid grid-cols-5">
                        {NAV_ITEMS.map((item) => (
                            <li key={item.to}>
                                <NavLink
                                    to={item.to}
                                    end={item.end}
                                    className={({ isActive }) =>
                                        `flex flex-col items-center gap-1 py-2 text-xs font-medium ${
                                            isActive ? 'text-[var(--accent)]' : 'text-slate-400'
                                        }`
                                    }
                                >
                                    <item.icon className="h-5 w-5" />
                                    {item.label}
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </nav>

                <BottomSheet open={switcherOpen} onClose={() => setSwitcherOpen(false)} title="Switch clinic">
                    <ErrorText>{switchError}</ErrorText>
                    <ul className="space-y-2">
                        {clinics.map((row) => (
                            <li key={`${row.clinic_id}-${row.patient_id}`}>
                                <button
                                    type="button"
                                    onClick={() => handleSwitchClinic(row)}
                                    disabled={switchingId !== null}
                                    className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
                                >
                                    <span>
                                        <span className="block text-sm font-medium text-slate-900">{row.clinic_name}</span>
                                        <span className="block text-xs text-slate-500">{row.patient_name}</span>
                                    </span>
                                    {switchingId === row.patient_id ? (
                                        <Spinner className="h-4 w-4 text-slate-400" />
                                    ) : (
                                        <ChevronRightIcon className="h-4 w-4 text-slate-400" />
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </BottomSheet>
            </div>
        </div>
    );
}
