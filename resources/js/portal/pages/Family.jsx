import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { formatDate } from '../lib/format';
import { Button, Card, ErrorText, Spinner } from '../components/ui';

const RELATION_LABELS = {
    self: 'You',
    dependent: 'Dependent',
    family: 'Family',
    same_phone: 'Linked profile',
};

/**
 * `GET/POST family`: the account's profile roster (self, dependents added
 * from here, family links, and other account holders sharing this phone
 * number). Switching is pure client state (session.setProfile) followed by
 * a home navigation — if the target profile's consent isn't current, the
 * protected layout / api.js 401-428 handling bounces to /consent on its
 * own, so this page doesn't need to check `consent_current` itself.
 */
export default function Family() {
    const navigate = useNavigate();
    const { activeProfileId, setProfile } = useSession();

    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [switchingId, setSwitchingId] = useState(null);

    const [showForm, setShowForm] = useState(false);
    const [fullName, setFullName] = useState('');
    const [dob, setDob] = useState('');
    const [gender, setGender] = useState('');
    const [formError, setFormError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    function load() {
        setLoading(true);
        setError('');
        return api
            .get('/family')
            .then(({ data }) => setProfiles(data.data || []))
            .catch((err) => setError(err?.response?.data?.message || 'Could not load your family profiles.'))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function switchTo(profileId) {
        setSwitchingId(profileId);
        setProfile(profileId);
        navigate('/');
    }

    async function submitNewMember(e) {
        e.preventDefault();
        if (!fullName.trim()) {
            setFormError('Enter a full name.');
            return;
        }
        setSubmitting(true);
        setFormError('');
        try {
            await api.post('/family', {
                full_name: fullName.trim(),
                dob: dob || undefined,
                gender: gender || undefined,
            });
            setFullName('');
            setDob('');
            setGender('');
            setShowForm(false);
            await load();
        } catch (err) {
            setFormError(err?.response?.data?.message || 'Could not add this profile.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Family</h1>

            {loading && (
                <div className="flex justify-center py-12">
                    <Spinner className="h-6 w-6 text-[var(--accent)]" />
                </div>
            )}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && (
                <ul className="space-y-3">
                    {profiles.map((p) => {
                        const isActive = p.id === activeProfileId;
                        return (
                            <li key={p.id}>
                                <Card>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{p.full_name}</p>
                                            <p className="text-xs text-slate-500">
                                                {RELATION_LABELS[p.relation] || p.relation}
                                                {p.dob ? ` · ${formatDate(p.dob)}` : ''}
                                            </p>
                                        </div>
                                        {isActive && (
                                            <span className="shrink-0 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                                                Viewing
                                            </span>
                                        )}
                                    </div>
                                    {!isActive && (
                                        <div className="mt-3">
                                            <Button
                                                variant="secondary"
                                                onClick={() => switchTo(p.id)}
                                                loading={switchingId === p.id}
                                            >
                                                Switch to this profile
                                            </Button>
                                        </div>
                                    )}
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}

            {!showForm ? (
                <Button variant="secondary" onClick={() => setShowForm(true)}>
                    Add family member
                </Button>
            ) : (
                <Card>
                    <h2 className="mb-3 text-sm font-medium text-slate-900">Add family member</h2>
                    <form onSubmit={submitNewMember} className="space-y-3">
                        <div>
                            <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-slate-700">
                                Full name
                            </label>
                            <input
                                id="full_name"
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                            />
                        </div>
                        <div>
                            <label htmlFor="dob" className="mb-1 block text-sm font-medium text-slate-700">
                                Date of birth (optional)
                            </label>
                            <input
                                id="dob"
                                type="date"
                                value={dob}
                                onChange={(e) => setDob(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                            />
                        </div>
                        <div>
                            <label htmlFor="gender" className="mb-1 block text-sm font-medium text-slate-700">
                                Gender (optional)
                            </label>
                            <select
                                id="gender"
                                value={gender}
                                onChange={(e) => setGender(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                            >
                                <option value="">Prefer not to say</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        {formError ? <ErrorText>{formError}</ErrorText> : null}
                        <div className="space-y-2">
                            <Button type="submit" loading={submitting}>
                                Add
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                    setShowForm(false);
                                    setFormError('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </form>
                </Card>
            )}
        </div>
    );
}
