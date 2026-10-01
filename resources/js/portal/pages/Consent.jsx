import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Button, Card, ErrorText, Spinner } from '../components/ui';

/**
 * The privacy-notice gate for the *acting* profile. If it's already
 * current (e.g. reached via a stale link, or another tab just accepted
 * it) we bounce straight home instead of re-prompting.
 */
// Only an in-app path (single leading slash, no backslash) is returned to.
function returnPath(from) {
    if (typeof from !== 'string' || !/^\/(?![\/\\])/.test(from) || from.includes('\\') || from.startsWith('/consent')) return '/';
    return from;
}

export default function Consent() {
    const navigate = useNavigate();
    const location = useLocation();
    const next = returnPath(location.state?.from);
    const { refresh, logout } = useSession();
    const [consent, setConsent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;

        api.get('/consent')
            .then(({ data }) => {
                if (!active) return;
                if (data.data.current) {
                    navigate(next, { replace: true });
                    return;
                }
                setConsent(data.data);
            })
            .catch((err) => {
                if (active) setError(err?.response?.data?.message || 'Could not load the privacy notice.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [navigate, next]);

    async function accept() {
        setSubmitting(true);
        setError('');
        try {
            await api.post('/consent');
            await refresh();
            navigate(next, { replace: true });
        } catch (err) {
            setError(err?.response?.data?.message || 'Could not save your consent.');
        } finally {
            setSubmitting(false);
        }
    }

    async function signOutInstead() {
        await logout();
        navigate('/login', { replace: true });
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
            <Card className="w-full max-w-md">
                <h1 className="mb-2 text-xl font-semibold text-slate-900">Privacy notice</h1>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Spinner className="h-6 w-6 text-[var(--accent)]" />
                    </div>
                ) : (
                    <>
                        <div className="max-h-72 space-y-2 overflow-y-auto text-sm leading-relaxed text-slate-600">
                            {(consent?.text || '').split('\n').filter(Boolean).map((line, i) => (
                                <p key={i}>{line}</p>
                            ))}
                        </div>
                        <div className="mt-3">
                            <ErrorText>{error}</ErrorText>
                        </div>
                        <div className="mt-4 space-y-2">
                            <Button onClick={accept} loading={submitting}>
                                I agree, continue
                            </Button>
                            <button
                                type="button"
                                onClick={signOutInstead}
                                className="w-full text-center text-sm text-slate-500"
                            >
                                Sign out instead
                            </button>
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}
