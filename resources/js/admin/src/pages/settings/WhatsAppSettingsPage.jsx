import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { Alert, Badge, Card, NumberRow, PageHeader, SaveBar, Spinner, Toggle, btn } from '../../components/ui';
import { useScope } from '../../context/ScopeContext';
import useClinicSettings from '../../hooks/useClinicSettings';

const FIELDS = ['whatsapp_booking_enabled', 'reminder_hours_before'];

const TEMPLATE_INFO = {
    booking_confirmed: ['Booking confirmed', 'Sent when an appointment is booked or confirmed.'],
    appointment_reminder: ['Appointment reminder', 'Sent before the visit, at the time set above.'],
    appointment_updated: ['Appointment changed', 'Sent when a visit is rescheduled or cancelled.'],
    prescription_ready: ['Prescription ready', 'Sends the prescription PDF after the visit.'],
    login_otp: ['Portal login code', 'One-time code for signing in to the patient portal.'],
    portal_link: ['Portal link', 'A sign-in link the front desk sends from the patient record.'],
    waitlist_slot_open: ['Waitlist slot offered', 'Offers a freed slot to the next patient waiting.'],
    waitlist_slot_taken: ['Waitlist slot taken', 'Tells a patient that the slot they were holding was booked.'],
};

export default function WhatsAppSettingsPage() {
    const scope = useScope() || {};
    const s = useClinicSettings(FIELDS);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');

    useEffect(() => {
        client.get('/clinic/whatsapp/status')
            .then((r) => setStatus(r.data?.data || null))
            .catch((e) => setStatusError(e?.response?.data?.message || 'Could not check the WhatsApp connection.'));
    }, []);

    const off = !s.canEdit;
    const reminderOn = Number(s.values.reminder_hours_before) > 0;

    return (
        <div className={`mx-auto max-w-3xl space-y-5 ${s.dirty ? 'pb-24' : ''}`}>
            <PageHeader
                back={{ to: '/settings', label: 'Settings' }}
                title="WhatsApp"
                subtitle="Booking, reminders and the messages patients get on WhatsApp."
            />
            {s.error ? <Alert onDismiss={() => s.setError('')}>{s.error}</Alert> : null}
            {s.notice ? <Alert tone="success">{s.notice}</Alert> : null}

            <Card>
                {statusError ? <p className="text-sm text-rose-700">{statusError}</p> : !status ? <Spinner className="py-4" /> : (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${status.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                <AppIcon name={status.connected ? 'check' : 'alert-triangle'} className="h-5 w-5" />
                            </span>
                            <div>
                                <p className="text-base font-semibold text-slate-900">{status.connected ? 'WhatsApp is connected' : 'WhatsApp is not connected yet'}</p>
                                <p className="text-sm text-slate-600">
                                    {status.connected
                                        ? 'Messages go out from the ClinicFlow WhatsApp number in your clinic’s name.'
                                        : 'Messages are paused until ClinicFlow finishes setting up the WhatsApp number.'}
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {scope.can?.('whatsapp.view') ? <Link to="/modules/whatsappConversations" className={btn.secondary}>WhatsApp chats</Link> : null}
                            {scope.can?.('whatsapp.view') ? <Link to="/workflows/communication/delivery-issues" className={btn.secondary}>Delivery issues</Link> : null}
                        </div>
                    </div>
                )}
            </Card>

            {s.loading ? <Spinner /> : (
                <Card title="Your clinic’s options" bodyClassName="divide-y divide-slate-100 px-5 py-1">
                    <Toggle id="wa_booking" title="Book on WhatsApp" hint="Patients can book, confirm, reschedule or cancel by chatting." checked={s.values.whatsapp_booking_enabled} onChange={s.set('whatsapp_booking_enabled')} disabled={off} />
                    <Toggle
                        id="reminders"
                        title="Appointment reminders"
                        hint="A reminder before every visit."
                        checked={reminderOn}
                        onChange={(on) => s.set('reminder_hours_before')(on ? 24 : 0)}
                        disabled={off}
                    />
                    {reminderOn ? (
                        <NumberRow id="reminder_hours" title="Send the reminder" hint="before the appointment" unit="hours" min={1} max={168} value={s.values.reminder_hours_before} onChange={s.set('reminder_hours_before')} disabled={off} />
                    ) : null}
                </Card>
            )}

            {status ? (
                <Card title="Messages patients receive" description="Message wording is approved by WhatsApp and managed by ClinicFlow.">
                    <ul className="-my-2 divide-y divide-slate-100">
                        {status.templates.map((t) => {
                            const [name, desc] = TEMPLATE_INFO[t.type] || [t.type.replace(/_/g, ' '), ''];
                            return (
                                <li key={t.type} className="flex items-start justify-between gap-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-900">{name}</p>
                                        {desc ? <p className="text-sm text-slate-600">{desc}</p> : null}
                                    </div>
                                    {t.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
                                </li>
                            );
                        })}
                    </ul>
                </Card>
            ) : null}

            <SaveBar visible={s.dirty && s.canEdit} saving={s.saving} onSave={s.save} onDiscard={s.discard} />
        </div>
    );
}
