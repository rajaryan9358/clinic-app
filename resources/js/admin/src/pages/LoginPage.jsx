import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppIcon from '../components/AppIcon';

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
        <div className="flex min-h-screen bg-gray-50">
            {/* Left panel — branding */}
            <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-blue-600 p-12 text-white">
                <div className="max-w-md text-center">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                        <AppIcon name="hospital" className="h-10 w-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight">Clinic SaaS</h1>
                    <p className="mt-3 text-lg text-blue-100">
                        Manage appointments, patients, billing, and your entire clinic from one place.
                    </p>
                    <div className="mt-10 grid grid-cols-3 gap-4 text-center">
                        {[
                            { icon: 'calendar', label: 'Scheduling' },
                            { icon: 'users', label: 'Patients' },
                            { icon: 'credit-card', label: 'Billing' },
                        ].map(({ icon, label }) => (
                            <div key={label} className="rounded-xl bg-white/10 p-4">
                                <AppIcon name={icon} className="mx-auto mb-2 h-6 w-6 text-white" />
                                <p className="text-sm font-medium text-blue-100">{label}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right panel — form */}
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
                <div className="w-full max-w-md">
                    {/* Mobile logo */}
                    <div className="mb-8 flex items-center gap-3 lg:hidden">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
                            <AppIcon name="hospital" className="h-5 w-5 text-white" />
                        </div>
                        <span className="text-xl font-bold text-gray-900">Clinic SaaS</span>
                    </div>

                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">Sign in</h2>
                        <p className="mt-1.5 text-sm text-gray-500">
                            Enter your credentials to access the dashboard.
                        </p>
                    </div>

                    <form onSubmit={submit} className="mt-8 space-y-4">
                        {error && (
                            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                                <AppIcon name="alert-triangle" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        )}

                        <div>
                            <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                                Email or Phone
                            </label>
                            <div className="relative">
                                <AppIcon name="user" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="name@clinic.com or +91 98765…"
                                    value={form.identifier}
                                    onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                                    required
                                    className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                                Password
                            </label>
                            <div className="relative">
                                <AppIcon name="key" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    placeholder="••••••••"
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    required
                                    className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    tabIndex={-1}
                                >
                                    <AppIcon name={showPassword ? 'eye' : 'eye'} className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
                        >
                            {loading ? (
                                <>
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
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

                    <p className="mt-8 text-center text-xs text-gray-400">
                        Contact your clinic administrator if you need access.
                    </p>
                </div>
            </div>
        </div>
    );
}
