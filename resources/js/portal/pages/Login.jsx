import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Button, Card, ErrorText, inputClass, labelClass } from '../components/ui';

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
    const { me, loading: sessionLoading, completeLogin } = useSession();
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
        completeLogin(payload).then(() => navigate('/', { replace: true }));
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

    // Already signed in (e.g. a bookmarked/typed /login while a session
    // is still valid) — bounce home instead of showing the form again.
    // /login/:token (MagicLink.jsx) deliberately has no such guard: a
    // fresh magic link must still be consumed even when signed in, since
    // it replaces the current session with whichever account it targets.
    if (!sessionLoading && me) {
        return <Navigate to="/" replace />;
    }

    const stepTitle = {
        phone: 'Sign in',
        code: 'Enter your code',
        choose: 'Choose a profile',
    }[step];
    const stepHint = {
        phone: "We'll send a 6-digit code to your WhatsApp.",
        code: phone ? `Sent on WhatsApp to ${phone}.` : 'Sent on WhatsApp.',
        choose: 'More than one profile uses this number.',
    }[step];

    return (
        <div className="flex min-h-screen flex-col bg-slate-50 px-4 py-10 sm:items-center sm:justify-center">
            <div className="mx-auto w-full max-w-md">
                <div className="mb-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-white" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M12 6v12M6 12h12" />
                        </svg>
                    </div>
                    <p className="text-sm font-medium text-slate-600">Patient portal</p>
                    <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{stepTitle}</h1>
                    <p className="mt-1 text-sm text-slate-600">{stepHint}</p>
                </div>

                <Card className="p-5">
                    {step === 'phone' && (
                        <form onSubmit={submitPhone} className="space-y-4">
                            <div>
                                <label htmlFor="phone" className={labelClass}>
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
                                    className={inputClass}
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
                                <label htmlFor="code" className={labelClass}>
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
                                    className={`${inputClass} text-center text-xl font-semibold tracking-[0.4em] tabular-nums placeholder:text-base placeholder:font-normal placeholder:tracking-normal`}
                                />
                            </div>
                            <ErrorText>{error}</ErrorText>
                            <Button type="submit" loading={loading}>
                                Verify &amp; sign in
                            </Button>
                            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                                <button
                                    type="button"
                                    onClick={resend}
                                    disabled={secondsLeft > 0 || loading}
                                    className="min-h-[44px] rounded-xl px-2 text-sm font-semibold text-[var(--accent)] hover:bg-slate-50 disabled:text-slate-500 disabled:hover:bg-transparent"
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
                                    className="min-h-[44px] rounded-xl px-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                    Change phone number
                                </button>
                            </div>
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
                                            className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold text-slate-900">{choice.patient_name}</span>
                                                <span className="block truncate text-sm text-slate-600">{choice.clinic_name}</span>
                                            </span>
                                            <span aria-hidden="true" className="text-lg text-slate-400">&rsaquo;</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>

                <p className="mt-6 text-center text-xs text-slate-500">
                    Your visits, prescriptions and bookings in one place.
                </p>
            </div>
        </div>
    );
}
