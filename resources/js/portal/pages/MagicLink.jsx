import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Card, ErrorText, Spinner } from '../components/ui';

/**
 * Consumes a staff-issued magic-link token (`/portal/login/:token`) via
 * `POST auth/link`, then signs the browser in exactly like OTP verify.
 * A link may carry a `redirect_path` (waitlist offers: the offer page,
 * plus which profile to act as); session.resolveRedirect vets it and
 * selects the profile, otherwise we land on `/`.
 */
export default function MagicLink() {
    const { token } = useParams();
    const navigate = useNavigate();
    const { completeLogin, resolveRedirect } = useSession();
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const attempted = useRef(false);

    // Deliberately no "already signed in" guard here (unlike Login.jsx):
    // a fresh magic link must still be consumed even when a session is
    // already active — it replaces that session with whichever account
    // the link targets, which may not be the one currently signed in.
    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;

        api.post('/auth/link', { token })
            .then(({ data }) =>
                completeLogin(data.data).then((meData) => {
                    const target = data.data?.redirect_path ? resolveRedirect(meData, data.data.redirect_path) : '/';
                    navigate(target, { replace: true });
                }),
            )
            .catch((err) => {
                setStatus('error');
                setError(err?.response?.data?.message || 'This link has expired.');
            });
    }, [token, navigate, completeLogin, resolveRedirect]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
            <Card className="w-full max-w-md p-6 text-center">
                {status === 'loading' ? (
                    <div className="flex flex-col items-center gap-3 py-6">
                        <Spinner className="h-7 w-7 text-[var(--accent)]" />
                        <p className="text-base font-semibold text-slate-900">Signing you in…</p>
                        <p className="text-sm text-slate-600">This only takes a moment.</p>
                    </div>
                ) : (
                    <div className="space-y-4 py-2 text-left">
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">We couldn't sign you in</h1>
                        <ErrorText>{error}</ErrorText>
                        <Link
                            to="/login"
                            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-3 text-base font-semibold text-white hover:brightness-95"
                        >
                            Back to sign in
                        </Link>
                    </div>
                )}
            </Card>
        </div>
    );
}
