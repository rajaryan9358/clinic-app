import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Card, ErrorText, Spinner } from '../components/ui';

/**
 * Consumes a staff-issued magic-link token (`/portal/login/:token`) via
 * `POST auth/link`, then signs the browser in exactly like OTP verify.
 */
export default function MagicLink() {
    const { token } = useParams();
    const navigate = useNavigate();
    const { refresh, setProfile } = useSession();
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const attempted = useRef(false);

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;

        api.post('/auth/link', { token })
            .then(({ data }) => {
                const payload = data.data;
                localStorage.setItem('portal_token', payload.token);
                // See Login.jsx's afterLogin: clear via session state, not
                // just localStorage, since this navigates without a reload.
                setProfile(null);
                return refresh();
            })
            .then(() => navigate('/', { replace: true }))
            .catch((err) => {
                setStatus('error');
                setError(err?.response?.data?.message || 'This link has expired.');
            });
    }, [token, navigate, refresh]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
            <Card className="w-full max-w-md text-center">
                {status === 'loading' ? (
                    <div className="flex flex-col items-center gap-3 py-6">
                        <Spinner className="h-6 w-6 text-[var(--accent)]" />
                        <p className="text-sm text-slate-500">Signing you in…</p>
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        <ErrorText>{error}</ErrorText>
                        <Link to="/login" className="text-sm font-medium text-[var(--accent)]">
                            Back to sign in
                        </Link>
                    </div>
                )}
            </Card>
        </div>
    );
}
