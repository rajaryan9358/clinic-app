import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';

export default function CommunicationDeliveryIssuesPage() {
    const { user } = useAuth();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const [failedReminders, setFailedReminders] = useState([]);
    const [failedWhatsappMessages, setFailedWhatsappMessages] = useState([]);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const [remRes, msgRes] = await Promise.all([
                client.get(`${base}/reminders`, {
                    params: { delivery_status: 'failed', per_page: 50, sort_by: 'id', sort_dir: 'desc' },
                }),
                client.get(`${base}/whatsapp/messages`, {
                    params: { delivery_status: 'failed', per_page: 50, sort_by: 'id', sort_dir: 'desc' },
                }),
            ]);

            setFailedReminders(remRes.data?.data || []);
            setFailedWhatsappMessages(msgRes.data?.data || []);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load delivery issues');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base]);

    if (user?.role !== 'super_admin') {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Not available</h2>
                <p className="mt-1 text-sm text-slate-600">Delivery issues are available for Super Admin only.</p>
                <Link to="/dashboard" className="mt-4 inline-block rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Back to Dashboard</Link>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="module" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Delivery Issues</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Failed reminders and WhatsApp messages across the network.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={load} disabled={loading} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <Link to="/dashboard" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Back</Link>
                </div>
            </div>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold">Failed Reminders</h3>
                    <p className="mt-1 text-sm text-slate-600">Source: reminder logs.</p>

                    {loading ? <div className="mt-3 text-sm text-slate-600">Loading…</div> : null}
                    {!loading && !failedReminders.length ? <div className="mt-3 text-sm text-slate-600">No failed reminders.</div> : null}

                    <div className="mt-3 space-y-2">
                        {failedReminders.map((r) => (
                            <Link key={r.id} to={`/modules/reminders/${r.id}`} className="block rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <div className="font-semibold text-slate-900">{r.channel} · {r.reminder_type}</div>
                                    <StatusBadge status={r.delivery_status} />
                                </div>
                                <div className="mt-1 text-xs text-slate-500">Clinic #{r.clinic_id} · Appointment #{r.appointment_id} · Patient #{r.patient_id}</div>
                                {r.failure_reason ? <div className="mt-1 text-xs text-rose-700">{r.failure_reason}</div> : null}
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold">Failed WhatsApp Messages</h3>
                    <p className="mt-1 text-sm text-slate-600">Source: WhatsApp messages.</p>

                    {loading ? <div className="mt-3 text-sm text-slate-600">Loading…</div> : null}
                    {!loading && !failedWhatsappMessages.length ? <div className="mt-3 text-sm text-slate-600">No failed messages.</div> : null}

                    <div className="mt-3 space-y-2">
                        {failedWhatsappMessages.map((m) => (
                            <Link key={m.id} to={`/modules/whatsappConversations/${m.conversation_id}`} className="block rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <div className="font-semibold text-slate-900">{m.direction} · {m.message_type}</div>
                                    <StatusBadge status={m.delivery_status} />
                                </div>
                                <div className="mt-1 text-xs text-slate-500">Clinic #{m.clinic_id} · Conversation #{m.conversation_id}</div>
                                <div className="mt-1 text-xs text-slate-600 break-words">{m.error_message || m.content_text || '—'}</div>
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
