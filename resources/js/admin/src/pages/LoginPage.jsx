import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppIcon from '../components/AppIcon';
import { Alert, btn, input } from '../components/ui';

export default function LoginPage() {
    const [form, setForm] = useState({ identifier: '', password: '' });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const { login, loading } = useAuth();
    const navigate = useNavigate();

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const identifier = String(form.identifier || '').trim();
            const isEmail = identifier.includes('@');
            await login({ email: isEmail ? identifier : '', phone: isEmail ? '' : identifier, password: form.password });
            navigate('/dashboard');
        } catch (err) {
            setError(err?.response?.data?.message || 'Invalid credentials. Please try again.');
        }
    };

    return (
        <div className="flex min-h-screen bg-slate-50">
            {/* Left panel — branding */}
            <div className="hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex lg:w-[46%]">
                <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
                        <AppIcon name="hospital" className="h-5 w-5 text-white" />
                    </span>
                    <span className="text-lg font-bold tracking-tight">Clinic SaaS</span>
                </div>
                <div className="max-w-md">
                    <h1 className="text-3xl font-bold leading-tight tracking-tight">Your whole clinic, in one calm place.</h1>
                    <p className="mt-3 text-base text-slate-300">
                        Manage appointments, patients, billing, and your entire clinic from one place.
                    </p>
                    <ul className="mt-10 space-y-3">
                        {[
                            { icon: 'calendar', label: 'Scheduling', desc: 'Bookings, walk-ins and the day’s queue.' },
                            { icon: 'users', label: 'Patients', desc: 'One record for every visit and note.' },
                            { icon: 'credit-card', label: 'Billing', desc: 'Bills, payments and receipts.' },
                        ].map(({ icon, label, desc }) => (
                            <li key={label} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-300">
                                    <AppIcon name={icon} className="h-4 w-4" />
                                </span>
                                <span>
                                    <span className="block text-sm font-semibold text-white">{label}</span>
                                    <span className="block text-sm text-slate-300">{desc}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
                <p className="text-xs text-slate-400">Secure sign-in for clinic staff and administrators.</p>
            </div>

            {/* Right panel — form */}
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
                <div className="w-full max-w-md">
                    {/* Mobile logo */}
                    <div className="mb-8 flex items-center gap-3 lg:hidden">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
                            <AppIcon name="hospital" className="h-5 w-5 text-white" />
                        </span>
                        <span className="text-xl font-bold tracking-tight text-slate-900">Clinic SaaS</span>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
                        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
                        <p className="mt-1 text-sm text-slate-600">
                            Sign in with your email or phone to open the dashboard.
                        </p>

                        <form onSubmit={submit} className="mt-6 space-y-4">
                            {error && <Alert tone="error">{error}</Alert>}

                            <div>
                                <label htmlFor="login-identifier" className="mb-1.5 block text-sm font-medium text-slate-700">
                                    Email or phone
                                </label>
                                <div className="relative">
                                    <AppIcon name="user" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <input
                                        id="login-identifier"
                                        type="text"
                                        autoComplete="username"
                                        placeholder="name@clinic.com or +91 98765…"
                                        value={form.identifier}
                                        onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                                        required
                                        className={`${input} h-11 pl-10`}
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                                    Password
                                </label>
                                <div className="relative">
                                    <AppIcon name="key" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <input
                                        id="login-password"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        placeholder="••••••••"
                                        value={form.password}
                                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                                        required
                                        className={`${input} h-11 pl-10 pr-11`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                        tabIndex={-1}
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        aria-pressed={showPassword}
                                    >
                                        <AppIcon name={showPassword ? 'eye' : 'eye'} className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            <button type="submit" disabled={loading} className={`${btn.primary} h-11 w-full`}>
                                {loading ? (
                                    <>
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                                        Signing in…
                                    </>
                                ) : (
                                    <>
                                        Sign in
                                        <AppIcon name="arrow-right" className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <p className="mt-6 text-center text-sm text-slate-600">
                        Contact your clinic administrator if you need access.
                    </p>
                </div>
            </div>
        </div>
    );
}
