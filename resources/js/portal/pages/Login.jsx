import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Button, Card, ErrorText } from '../components/ui';

const RESEND_SECONDS = 60;

function errorMessage(err, fallback) {
    return err?.response?.data?.message || fallback;
}

/**
 * WhatsApp one-time-code sign-in: phone -> code -> (optional) profile
 * choice, when the number is shared by account holders in more than one
 * clinic. `POST auth/verify` either logs in directly or comes back with
 * `{needs_selection, choices}`, at which point we resubmit the same code
 * with the chosen `patient_id`.
 */
export default function Login() {
    const navigate = useNavigate();
    const { refresh, setProfile } = useSession();
    const [step, setStep] = useState('phone');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [choices, setChoices] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(0);

    useEffect(() => {
        if (secondsLeft <= 0) return;
        const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(timer);
    }, [secondsLeft]);

    function afterLogin(payload) {
        localStorage.setItem('portal_token', payload.token);
        // Clears via session state (not just localStorage) so a stale
        // acting-profile id from a previous sign-in in this same tab
        // can't leak into the new session — this navigates with the
        // router, not a full reload, so React state must be reset too.
        setProfile(null);
        refresh().then(() => navigate('/', { replace: true }));
    }

    async function submitPhone(e) {
        e.preventDefault();
        setError('');
        if (!phone.trim()) {
            setError('Enter your phone number.');
            return;
        }
        setLoading(true);
        try {
            await api.post('/auth/request-code', { phone });
            setStep('code');
            setSecondsLeft(RESEND_SECONDS);
        } catch (err) {
            setError(errorMessage(err, 'Could not send the code. Please try again.'));
        } finally {
            setLoading(false);
        }
    }

    async function submitCode(e, patientId) {
        if (e) e.preventDefault();
        setError('');
        if (!patientId && code.trim().length !== 6) {
            setError('Enter the 6-digit code.');
            return;
        }
        setLoading(true);
        try {
            const { data } = await api.post('/auth/verify', {
                phone,
                code,
                patient_id: patientId ?? null,
            });
            const payload = data.data;
            if (payload.needs_selection) {
                setChoices(payload.choices);
                setStep('choose');
                return;
            }
            afterLogin(payload);
        } catch (err) {
            setError(errorMessage(err, 'Incorrect code.'));
        } finally {
            setLoading(false);
        }
    }

    async function resend() {
        setError('');
        setLoading(true);
        try {
            await api.post('/auth/request-code', { phone });
            setSecondsLeft(RESEND_SECONDS);
        } catch (err) {
            setError(errorMessage(err, 'Could not resend the code.'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
            <div className="w-full max-w-md">
                <div className="mb-6 text-center">
                    <h1 className="text-2xl font-semibold text-slate-900">Patient Portal</h1>
                    <p className="mt-1 text-sm text-slate-500">Sign in with your phone number</p>
                </div>

                <Card>
                    {step === 'phone' && (
                        <form onSubmit={submitPhone} className="space-y-4">
                            <div>
                                <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
                                    Phone number
                                </label>
                                <input
                                    id="phone"
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="tel"
                                    placeholder="10-digit mobile number"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                                />
                            </div>
                            <ErrorText>{error}</ErrorText>
                            <Button type="submit" loading={loading}>
                                Send code
                            </Button>
                        </form>
                    )}

                    {step === 'code' && (
                        <form onSubmit={(e) => submitCode(e)} className="space-y-4">
                            <div>
                                <label htmlFor="code" className="mb-1 block text-sm font-medium text-slate-700">
                                    Enter the code sent on WhatsApp
                                </label>
                                <input
                                    id="code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    placeholder="6-digit code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg tracking-widest focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                                />
                            </div>
                            <ErrorText>{error}</ErrorText>
                            <Button type="submit" loading={loading}>
                                Verify &amp; sign in
                            </Button>
                            <button
                                type="button"
                                onClick={resend}
                                disabled={secondsLeft > 0 || loading}
                                className="w-full text-center text-sm font-medium text-[var(--accent)] disabled:text-slate-400"
                            >
                                {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStep('phone');
                                    setCode('');
                                    setError('');
                                }}
                                className="w-full text-center text-sm text-slate-500"
                            >
                                Change phone number
                            </button>
                        </form>
                    )}

                    {step === 'choose' && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600">Multiple profiles are linked to this number. Choose one:</p>
                            <ErrorText>{error}</ErrorText>
                            <ul className="space-y-2">
                                {choices.map((choice) => (
                                    <li key={`${choice.clinic_id}-${choice.patient_id}`}>
                                        <button
                                            type="button"
                                            disabled={loading}
                                            onClick={() => submitCode(null, choice.patient_id)}
                                            className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            <span>
                                                <span className="block text-sm font-medium text-slate-900">{choice.patient_name}</span>
                                                <span className="block text-xs text-slate-500">{choice.clinic_name}</span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
