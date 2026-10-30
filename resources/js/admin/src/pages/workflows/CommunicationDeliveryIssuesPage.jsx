import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import { PageHeader, Card, Alert, Spinner, EmptyState, btn } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';

export default function CommunicationDeliveryIssuesPage() {
    const { user } = useAuth();
    const scope = useScope() || {};
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    // Each list needs its own permission; the super admin sees both.
    const allowed = (perm) => user?.role === 'super_admin' || Boolean(scope.can?.(perm));
    const canReminders = allowed('reminders.view');
    const canMessages = allowed('whatsapp.view');

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const [failedReminders, setFailedReminders] = useState([]);
    const [failedWhatsappMessages, setFailedWhatsappMessages] = useState([]);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const params = { delivery_status: 'failed', per_page: 50, sort_by: 'id', sort_dir: 'desc' };
            const none = Promise.resolve({ data: { data: [] } });
            const [remRes, msgRes] = await Promise.all([
                canReminders ? client.get(`${base}/reminders`, { params }) : none,
                canMessages ? client.get(`${base}/whatsapp/messages`, { params }) : none,
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
    }, [base, canReminders, canMessages]);

    if (!canReminders && !canMessages) {
        return (
            <div className="mx-auto max-w-3xl">
                <Card>
                    <EmptyState icon="shield" title="Not available">
                        <p>Your role can’t view reminders or WhatsApp messages.</p>
                        <Link to="/dashboard" className={`${btn.secondary} mt-4`}>Back to dashboard</Link>
                    </EmptyState>
                </Card>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                title="Delivery issues"
                subtitle={user?.role === 'super_admin' ? 'Failed reminders and WhatsApp messages across the network.' : 'Reminders and WhatsApp messages that did not reach the patient.'}
                back={{ to: '/dashboard', label: 'Back' }}
                actions={(
                    <button type="button" onClick={load} disabled={loading} className={btn.secondary}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                )}
            />

            {error ? <Alert>{error}</Alert> : null}

            <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Failed reminders" description="Source: reminder logs." bodyClassName="">
                    {loading ? <Spinner className="py-10" /> : null}
                    {!loading && !failedReminders.length ? <EmptyState icon="bell" title="No failed reminders" /> : null}

                    {!loading && failedReminders.length ? (
                        <ul className="divide-y divide-slate-100">
                            {failedReminders.map((r) => (
                                <li key={r.id}>
                                    <Link to={`/modules/reminders/${r.id}`} className="block px-5 py-3 hover:bg-slate-50">
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                            <div className="font-semibold text-slate-900">{r.channel} · {r.reminder_type}</div>
                                            <StatusBadge status={r.delivery_status} />
                                        </div>
                                        <div className="mt-1 text-xs text-slate-600">Clinic #{r.clinic_id} · Appointment #{r.appointment_id} · Patient #{r.patient_id}</div>
                                        {r.failure_reason ? <div className="mt-1 text-xs text-rose-700">{r.failure_reason}</div> : null}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </Card>

                <Card title="Failed WhatsApp messages" description="Source: WhatsApp messages." bodyClassName="">
                    {loading ? <Spinner className="py-10" /> : null}
                    {!loading && !failedWhatsappMessages.length ? <EmptyState icon="share" title="No failed messages" /> : null}

                    {!loading && failedWhatsappMessages.length ? (
                        <ul className="divide-y divide-slate-100">
                            {failedWhatsappMessages.map((m) => (
                                <li key={m.id}>
                                    <Link to={`/modules/whatsappConversations/${m.conversation_id}`} className="block px-5 py-3 hover:bg-slate-50">
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                            <div className="font-semibold text-slate-900">{m.direction} · {m.message_type}</div>
                                            <StatusBadge status={m.delivery_status} />
                                        </div>
                                        <div className="mt-1 text-xs text-slate-600">Clinic #{m.clinic_id} · Conversation #{m.conversation_id}</div>
                                        <div className="mt-1 break-words text-xs text-slate-700">{m.error_message || m.content_text || '—'}</div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </Card>
            </div>
        </div>
    );
}
