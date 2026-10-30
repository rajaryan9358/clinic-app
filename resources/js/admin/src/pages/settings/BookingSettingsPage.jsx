import { Alert, Card, NumberRow, PageHeader, SaveBar, Spinner, Toggle, input, label } from '../../components/ui';
import useClinicSettings from '../../hooks/useClinicSettings';

const FIELDS = [
    'booking_enabled', 'auto_confirm_appointments', 'max_advance_booking_days', 'min_booking_notice_minutes',
    'default_slot_duration_minutes', 'booking_notice_text', 'walkin_enabled', 'token_system_enabled',
    'allow_reschedule', 'reschedule_cutoff_hours', 'allow_cancel', 'cancel_cutoff_hours',
    'waitlist_enabled', 'waitlist_hold_minutes', 'portal_enabled', 'terms_text', 'privacy_policy_text',
];

export default function BookingSettingsPage() {
    const s = useClinicSettings(FIELDS);
    const v = s.values;
    const off = !s.canEdit;

    return (
        <div className={`mx-auto max-w-3xl space-y-5 ${s.dirty ? 'pb-24' : ''}`}>
            <PageHeader
                back={{ to: '/settings', label: 'Settings' }}
                title="Booking & visits"
                subtitle="How patients book, change and wait for appointments."
            />
            {s.error ? <Alert onDismiss={() => s.setError('')}>{s.error}</Alert> : null}
            {s.notice ? <Alert tone="success">{s.notice}</Alert> : null}
            {!s.canEdit && !s.loading ? <Alert tone="info">You can view these settings. Ask a clinic admin to change them.</Alert> : null}

            {s.loading ? <Spinner /> : (
                <>
                    <Card title="Online booking" description="Patients booking through the portal or WhatsApp." bodyClassName="divide-y divide-slate-100 px-5 py-1">
                        <Toggle id="booking_enabled" title="Accept online bookings" checked={v.booking_enabled} onChange={s.set('booking_enabled')} disabled={off} />
                        <Toggle id="auto_confirm" title="Confirm bookings automatically" hint="Otherwise the front desk confirms each one." checked={v.auto_confirm_appointments} onChange={s.set('auto_confirm_appointments')} disabled={off} />
                        <NumberRow id="advance" title="Book up to" unit="days ahead" min={0} max={365} value={v.max_advance_booking_days} onChange={s.set('max_advance_booking_days')} disabled={off} />
                        <NumberRow id="notice" title="Minimum notice" hint="How soon before a slot it can still be booked." unit="minutes" min={0} max={10080} value={v.min_booking_notice_minutes} onChange={s.set('min_booking_notice_minutes')} disabled={off} />
                        <NumberRow id="slot" title="Default visit length" hint="Used when a doctor has no slot length of their own." unit="minutes" min={1} max={480} value={v.default_slot_duration_minutes} onChange={s.set('default_slot_duration_minutes')} disabled={off} />
                        <div className="py-3">
                            <label htmlFor="booking_notice" className={label}>Message shown when booking (optional)</label>
                            <textarea id="booking_notice" rows={2} className={input} value={v.booking_notice_text || ''} onChange={(e) => s.set('booking_notice_text')(e.target.value)} disabled={off} placeholder="e.g. Please arrive 10 minutes early with your previous reports." />
                        </div>
                    </Card>

                    <Card title="Front desk" bodyClassName="divide-y divide-slate-100 px-5 py-1">
                        <Toggle id="walkin" title="Walk-ins" hint="Let the front desk add patients without a booking." checked={v.walkin_enabled} onChange={s.set('walkin_enabled')} disabled={off} />
                        <Toggle id="tokens" title="Token numbers" hint="Give each visit a queue number for the day." checked={v.token_system_enabled} onChange={s.set('token_system_enabled')} disabled={off} />
                    </Card>

                    <Card title="Changes by patients" bodyClassName="divide-y divide-slate-100 px-5 py-1">
                        <Toggle id="resched" title="Patients can reschedule" checked={v.allow_reschedule} onChange={s.set('allow_reschedule')} disabled={off} />
                        {v.allow_reschedule ? (
                            <NumberRow id="resched_cut" title="Up to" hint="before the appointment" unit="hours" min={0} max={8760} value={v.reschedule_cutoff_hours} onChange={s.set('reschedule_cutoff_hours')} disabled={off} />
                        ) : null}
                        <Toggle id="cancel" title="Patients can cancel" checked={v.allow_cancel} onChange={s.set('allow_cancel')} disabled={off} />
                        {v.allow_cancel ? (
                            <NumberRow id="cancel_cut" title="Up to" hint="before the appointment" unit="hours" min={0} max={8760} value={v.cancel_cutoff_hours} onChange={s.set('cancel_cutoff_hours')} disabled={off} />
                        ) : null}
                    </Card>

                    <Card title="Waitlist" description="When a slot frees up, the next patient waiting is offered it on WhatsApp." bodyClassName="divide-y divide-slate-100 px-5 py-1">
                        <Toggle id="waitlist" title="Use the waitlist" checked={v.waitlist_enabled} onChange={s.set('waitlist_enabled')} disabled={off} />
                        {v.waitlist_enabled ? (
                            <NumberRow id="hold" title="Hold an offered slot for" unit="minutes" min={5} max={240} value={v.waitlist_hold_minutes} onChange={s.set('waitlist_hold_minutes')} disabled={off} />
                        ) : null}
                    </Card>

                    <Card title="Patient portal" bodyClassName="divide-y divide-slate-100 px-5 py-1">
                        <Toggle id="portal" title="Patient portal" hint="Patients sign in to see visits, prescriptions and bills, and to book." checked={v.portal_enabled} onChange={s.set('portal_enabled')} disabled={off} />
                        <div className="py-3">
                            <label htmlFor="terms" className={label}>Terms shown to patients (optional)</label>
                            <textarea id="terms" rows={3} className={input} value={v.terms_text || ''} onChange={(e) => s.set('terms_text')(e.target.value)} disabled={off} />
                        </div>
                        <div className="py-3">
                            <label htmlFor="privacy" className={label}>Privacy policy (optional)</label>
                            <textarea id="privacy" rows={3} className={input} value={v.privacy_policy_text || ''} onChange={(e) => s.set('privacy_policy_text')(e.target.value)} disabled={off} />
                        </div>
                    </Card>
                </>
            )}

            <SaveBar visible={s.dirty && s.canEdit} saving={s.saving} onSave={s.save} onDiscard={s.discard} />
        </div>
    );
}
