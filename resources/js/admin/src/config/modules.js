import { humanizeValue } from '../utils/moduleRecord';

const text = (key, label, required = false) => ({ key, label, type: 'text', required });
const number = (key, label, required = false) => ({ key, label, type: 'number', required });
const date = (key, label, required = false) => ({ key, label, type: 'date', required });
const time = (key, label, required = false) => ({ key, label, type: 'time', required });
const select = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });
const textarea = (key, label, required = false) => ({ key, label, type: 'textarea', required });
const checkbox = (key, label) => ({ key, label, type: 'checkbox' });
const relation = (key, label, resource, required = false, multiple = false) => ({ key, label, type: 'relation', resource, required, multiple });
const image = (key, label, module, required = false) => ({ key, label, type: 'image', module, required });

// Presentation metadata for the generic list / view / form pages, kept beside
// the module definitions that use it. Every key is optional:
//   icon      an AppIcon name, shown in the sidebar, list header and empty state
//   singular  the record noun, used when a record has no name of its own
//   title     (record) => the record's own name, for the view page header
//   labels    human field labels; anything missing falls back to the prettifier
//   formats   per-field display: 'money' | 'percent' | 'minutes' | 'enum'
//   hidden    fields the view page never shows
//   sections  how the view page groups fields; unlisted fields land in "Other details"
//   empty     { title, body } for the empty list; `emptyAction: false` drops the
//             "add" button where records are created by the system, not by staff
// Related records show by name only when the API embeds the relation (see
// utils/moduleRecord.js); bare ids are never printed.
const viewMeta = {
    clinics: { icon: 'hospital' },
    doctors: { icon: 'stethoscope' },
    patients: { icon: 'user' },
    appointments: { icon: 'calendar' },
    followups: { icon: 'clipboard-check' },
    reviews: { icon: 'star' },
    auditLogs: { icon: 'shield' },

    users: {
        icon: 'users',
        singular: 'Staff user',
        title: (r) => r.full_name,
        labels: { clinic_id: 'Clinic', full_name: 'Name', email: 'Email', phone: 'Phone', password: 'Password', role: 'Role', doctor_ids: 'Assigned doctors', last_login_at: 'Last login' },
        formats: { role: 'enum' },
        hidden: ['uuid', 'email_verified_at', 'phone_verified_at', 'login_type', 'last_login_ip'],
        sections: [
            { title: 'Profile', keys: ['full_name', 'role', 'status'] },
            { title: 'Contact', keys: ['email', 'phone'] },
            { title: 'Access', keys: ['clinic_id', 'last_login_at'] },
        ],
        empty: {
            title: 'No staff users yet',
            body: 'Staff users are the people who sign in to run the clinic: reception, assistants and doctors. Add one to give them access.',
        },
    },
    services: {
        icon: 'briefcase',
        singular: 'Service',
        title: (r) => r.name,
        labels: { clinic_id: 'Clinic', name: 'Service name', code: 'Code', description: 'Description', duration_minutes: 'Duration', fee: 'Fee', image_url: 'Service image' },
        formats: { fee: 'money', duration_minutes: 'minutes' },
        hidden: ['image_url'],
        sections: [
            { title: 'About this service', keys: ['name', 'code', 'description'] },
            { title: 'Fee and time', keys: ['fee', 'duration_minutes'] },
            { title: 'Availability', keys: ['status'] },
        ],
        empty: {
            title: 'No services yet',
            body: 'Services are what your clinic offers to patients, such as a consultation or a procedure. Add each one with its fee and how long it takes.',
        },
    },
    reminders: {
        icon: 'bell',
        singular: 'Reminder',
        title: (r) => (r.reminder_type ? humanizeValue(r.reminder_type) : ''),
        labels: { clinic_id: 'Clinic', appointment_id: 'Appointment', patient_id: 'Patient', channel: 'Sent through', reminder_type: 'Reminder', scheduled_for: 'Scheduled for', sent_at: 'Sent at', delivery_status: 'Delivery', provider_message_id: 'Provider reference', failure_reason: 'Why it failed' },
        formats: { channel: 'enum', reminder_type: 'enum' },
        sections: [
            { title: 'Reminder', keys: ['reminder_type', 'channel', 'patient_id', 'appointment_id'] },
            { title: 'Delivery', keys: ['delivery_status', 'scheduled_for', 'sent_at', 'failure_reason', 'provider_message_id'] },
        ],
        empty: {
            title: 'No reminders yet',
            body: 'Reminders are the messages the clinic sends patients about their appointments, with whether each one was delivered.',
        },
        emptyAction: false,
    },
    domains: {
        icon: 'globe',
        singular: 'Domain',
        title: (r) => r.host,
        labels: { clinic_id: 'Clinic', host: 'Domain', type: 'Used for', is_primary: 'Primary domain', ssl_status: 'SSL certificate' },
        formats: { type: 'enum' },
        sections: [
            { title: 'Domain', keys: ['host', 'type', 'is_primary'] },
            { title: 'Status', keys: ['status', 'ssl_status'] },
        ],
        empty: {
            title: 'No domains yet',
            body: "A domain is the web address patients use to reach this clinic's booking page or patient portal.",
        },
    },
    clinicSettings: {
        icon: 'settings',
        singular: 'Clinic settings',
        title: (r) => (r.clinic?.name ? `${r.clinic.name} settings` : 'Clinic settings'),
        labels: {
            clinic: 'Clinic',
            clinic_id: 'Clinic',
            booking_enabled: 'Online booking',
            walkin_enabled: 'Walk-ins',
            token_system_enabled: 'Token system',
            whatsapp_booking_enabled: 'Booking over WhatsApp',
            auto_confirm_appointments: 'Auto-confirm appointments',
            max_advance_booking_days: 'Book up to (days ahead)',
            min_booking_notice_minutes: 'Minimum notice (minutes)',
            default_slot_duration_minutes: 'Default slot length (minutes)',
            booking_notice_text: 'Booking notice',
            allow_reschedule: 'Patients can reschedule',
            reschedule_cutoff_hours: 'Reschedule cut-off (hours before)',
            allow_cancel: 'Patients can cancel',
            cancel_cutoff_hours: 'Cancel cut-off (hours before)',
            reminder_hours_before: 'Reminder lead time (hours, 0 = off)',
            waitlist_enabled: 'Waitlist',
            waitlist_hold_minutes: 'Waitlist hold (minutes)',
            portal_enabled: 'Patient portal',
            terms_text: 'Terms',
            privacy_policy_text: 'Privacy policy',
            invoicing_enabled: 'Invoicing',
            online_payment_enabled: 'Online payments',
            invoice_prefix: 'Invoice prefix (max 10 characters)',
            invoice_tax_percent: 'Invoice tax',
            invoice_footer_note: 'Invoice footer note',
        },
        formats: { invoice_tax_percent: 'percent' },
        sections: [
            { title: 'Clinic', keys: ['clinic_id'] },
            { title: 'Booking', keys: ['booking_enabled', 'walkin_enabled', 'token_system_enabled', 'whatsapp_booking_enabled', 'auto_confirm_appointments', 'max_advance_booking_days', 'min_booking_notice_minutes', 'default_slot_duration_minutes', 'booking_notice_text'] },
            { title: 'Changes and cancellations', keys: ['allow_reschedule', 'reschedule_cutoff_hours', 'allow_cancel', 'cancel_cutoff_hours'] },
            { title: 'Reminders and waitlist', keys: ['reminder_hours_before', 'waitlist_enabled', 'waitlist_hold_minutes'] },
            { title: 'Patient portal', keys: ['portal_enabled', 'terms_text', 'privacy_policy_text'] },
            { title: 'Invoicing', keys: ['invoicing_enabled', 'online_payment_enabled', 'invoice_prefix', 'invoice_tax_percent', 'invoice_footer_note'] },
        ],
        empty: {
            title: 'No settings yet',
            body: 'Clinic settings control how booking, reminders, the patient portal and invoicing behave for a clinic.',
        },
    },
    whatsappConversations: {
        icon: 'message-circle',
        singular: 'Conversation',
        title: (r) => r.customer_phone,
        labels: { clinic_id: 'Clinic', patient_id: 'Patient', customer_phone: 'Customer phone', conversation_status: 'Status', current_owner_type: 'Handled by', current_owner_user_id: 'Assigned to', last_message_at: 'Last message', last_incoming_at: 'Last received', last_outgoing_at: 'Last sent', tags_json: 'Tags' },
        formats: { current_owner_type: 'enum' },
        sections: [
            { title: 'Conversation', keys: ['customer_phone', 'patient_id', 'conversation_status', 'tags_json'] },
            { title: 'Handling', keys: ['current_owner_type', 'current_owner_user_id'] },
            { title: 'Activity', keys: ['last_message_at', 'last_incoming_at', 'last_outgoing_at'] },
        ],
        empty: {
            title: 'No conversations yet',
            body: 'Conversations are the WhatsApp chats patients start with the clinic. They appear here as soon as someone sends a message.',
        },
        emptyAction: false,
    },
    whatsappMessages: {
        icon: 'message-circle',
        singular: 'Message',
        title: (r) => (r.direction ? `${humanizeValue(r.direction)} message` : ''),
        labels: { clinic_id: 'Clinic', conversation_id: 'Conversation', patient_id: 'Patient', appointment_id: 'Appointment', direction: 'Direction', message_type: 'Type', notification_type: 'Notification', template_name: 'Template', content_text: 'Message', from_phone: 'From', to_phone: 'To', delivery_status: 'Delivery', error_message: 'Error', provider_message_id: 'Provider reference' },
        formats: { direction: 'enum', message_type: 'enum', notification_type: 'enum' },
        hidden: ['payload_json'],
        sections: [
            { title: 'Message', keys: ['direction', 'message_type', 'content_text', 'template_name', 'notification_type'] },
            { title: 'Delivery', keys: ['delivery_status', 'error_message', 'from_phone', 'to_phone', 'provider_message_id'] },
            { title: 'Linked to', keys: ['conversation_id', 'patient_id', 'appointment_id'] },
        ],
        empty: {
            title: 'No messages yet',
            body: 'Messages are the individual WhatsApp messages sent to and received from patients.',
        },
        emptyAction: false,
    },
    whatsappSessions: {
        icon: 'git-branch',
        singular: 'Flow session',
        title: (r) => (r.flow_type ? humanizeValue(r.flow_type) : ''),
        labels: { clinic_id: 'Clinic', conversation_id: 'Conversation', patient_id: 'Patient', flow_type: 'Flow', current_step: 'Current step', started_at: 'Started', ended_at: 'Ended' },
        formats: { flow_type: 'enum', current_step: 'enum' },
        hidden: ['state_json'],
        sections: [
            { title: 'Flow', keys: ['flow_type', 'current_step', 'status'] },
            { title: 'Timing', keys: ['started_at', 'ended_at'] },
            { title: 'Linked to', keys: ['conversation_id', 'patient_id'] },
        ],
        empty: {
            title: 'No flow sessions yet',
            body: 'A flow session tracks a patient part-way through a guided WhatsApp flow, such as booking an appointment.',
        },
        emptyAction: false,
    },
};

export const modules = {
    clinics: { label: 'Clinics', ...viewMeta.clinics, group: 'organization', navOrder: 10, superAdmin: true, clinic: false, path: 'clinics', searchFields: ['name', 'slug', 'status'], filters: { super_admin: ['status'], clinic: [] }, formFields: [text('name', 'Clinic Name', true), text('slug', 'Slug', true), text('legal_name', 'Legal Name'), text('owner_name', 'Owner Name'), text('owner_email', 'Owner Email'), text('owner_phone', 'Owner Phone'), select('status', 'Status', ['active', 'trial', 'suspended', 'inactive'])] },
    domains: { label: 'Domains', ...viewMeta.domains, group: 'organization', navOrder: 30, superAdmin: true, clinic: true, path: 'domains', searchFields: ['host', 'type', 'status'], filters: { super_admin: ['clinic_id', 'status', 'type'], clinic: ['status', 'type'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), text('host', 'Host / Domain', true), select('type', 'Type', ['booking', 'portal', 'website', 'custom'], true), checkbox('is_primary', 'Primary Domain'), select('ssl_status', 'SSL Status', ['pending', 'active', 'failed']), select('status', 'Status', ['active', 'inactive'])] },
    // `role`'s options and `doctor_ids`'s visibility are filled in dynamically by
    // ModuleFormPage from GET /clinic/roles or /super-admin/roles (Task 7) — the
    // empty array/relation below are placeholders only.
    users: { label: 'Staff Users', ...viewMeta.users, group: 'people', navOrder: 10, superAdmin: true, clinic: true, path: 'users', searchFields: ['full_name', 'email', 'role', 'status'], filters: { super_admin: ['clinic_id', 'role', 'status'], clinic: ['role', 'status'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), text('full_name', 'Full Name', true), text('email', 'Email'), text('phone', 'Phone'), text('password', 'Password', true), select('role', 'Role', [], true), relation('doctor_ids', 'Assigned Doctors', 'doctors', false, true)] },
    doctors: { label: 'Doctors', ...viewMeta.doctors, group: 'people', navOrder: 20, superAdmin: true, clinic: true, path: 'doctors', searchFields: ['full_name', 'specialization', 'status'], filters: { super_admin: ['clinic_id', 'status', 'specialization'], clinic: ['status', 'specialization'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics', true), image('photo_url', 'Doctor Photo', 'doctors'), select('title', 'Title', ['Dr.', 'Prof.', 'Mr.', 'Ms.']), text('full_name', 'Full Name', true), text('specialization', 'Specialization'), text('qualification', 'Qualification'), number('experience_years', 'Experience (Years)'), select('gender', 'Gender', ['male', 'female', 'other']), text('phone', 'Phone'), text('email', 'Email'), number('consultation_fee', 'Consultation Fee'), number('followup_fee', 'Follow-up Fee'), number('slot_duration_minutes', 'Slot Duration (min)'), number('buffer_time_minutes', 'Buffer Time (min)')] },
    patients: { label: 'Patients', ...viewMeta.patients, group: 'people', navOrder: 30, superAdmin: true, clinic: true, path: 'patients', searchFields: ['full_name', 'phone', 'status_tag'], filters: { super_admin: ['clinic_id', 'status_tag', 'preferred_doctor_id'], clinic: ['status_tag', 'preferred_doctor_id'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), text('first_name', 'First Name', true), text('last_name', 'Last Name'), text('phone', 'Phone', true), text('email', 'Email'), select('gender', 'Gender', ['male', 'female', 'other']), date('dob', 'Date of Birth'), number('age', 'Age')] },
    services: { label: 'Services', ...viewMeta.services, group: 'care', navOrder: 10, superAdmin: true, clinic: true, path: 'services', searchFields: ['name', 'code', 'status'], filters: { super_admin: ['clinic_id', 'status'], clinic: ['status'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), image('image_url', 'Service Image', 'services'), text('name', 'Service Name', true), text('code', 'Code'), textarea('description', 'Description'), number('duration_minutes', 'Duration (Min)'), number('fee', 'Fee')] },
    appointments: { label: 'Appointments', ...viewMeta.appointments, group: 'care', navOrder: 20, superAdmin: true, clinic: true, path: 'appointments', searchFields: ['uuid', 'status', 'appointment_date'], filters: { super_admin: ['clinic_id', 'doctor_id', 'patient_id', 'status', 'appointment_date', 'booking_channel'], clinic: ['doctor_id', 'patient_id', 'status', 'appointment_date', 'booking_channel'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('patient_id', 'Patient', 'patients', true), relation('doctor_id', 'Doctor', 'doctors', true), relation('service_id', 'Service', 'services'), date('appointment_date', 'Appointment Date', true), time('start_time', 'Start Time', true), time('end_time', 'End Time', true), select('visit_type', 'Visit Type', ['new', 'followup', 'routine', 'urgent'], true), select('consultation_mode', 'Mode', ['in_person', 'video', 'phone']), select('booking_channel', 'Booking Channel', ['walk_in', 'phone', 'website', 'whatsapp', 'google', 'staff', 'portal', 'other'], true), select('status', 'Status', ['pending', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show', 'rescheduled'])] },
    followups: { label: 'Followups', ...viewMeta.followups, group: 'care', navOrder: 30, superAdmin: true, clinic: true, path: 'followups', searchFields: ['task_type', 'status', 'priority'], filters: { super_admin: ['clinic_id', 'doctor_id', 'assigned_to_user_id', 'status'], clinic: ['doctor_id', 'assigned_to_user_id', 'status'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('patient_id', 'Patient', 'patients', true), relation('appointment_id', 'Appointment', 'appointments'), relation('assigned_to_user_id', 'Assigned To', 'users'), date('due_date', 'Due Date', true), time('due_time', 'Due Time'), select('task_type', 'Task Type', ['call', 'whatsapp', 'review_request', 'followup_visit', 'lab_reminder', 'custom'], true), select('status', 'Status', ['pending', 'done', 'skipped', 'cancelled']), select('priority', 'Priority', ['low', 'medium', 'high']), text('note', 'Note')] },
    reminders: { label: 'Reminders', ...viewMeta.reminders, group: 'care', navOrder: 40, superAdmin: true, clinic: true, path: 'reminders', searchFields: ['channel', 'reminder_type', 'delivery_status'], filters: { super_admin: ['clinic_id', 'delivery_status', 'reminder_type', 'appointment_id', 'patient_id'], clinic: ['delivery_status', 'reminder_type', 'appointment_id', 'patient_id'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('appointment_id', 'Appointment', 'appointments', true), relation('patient_id', 'Patient', 'patients', true), select('channel', 'Channel', ['whatsapp', 'sms', 'email', 'call'], true), select('reminder_type', 'Reminder Type', ['booking_confirmation', '24h_before', '2h_before', 'missed_visit', 'followup_due', 'review_request'], true), text('scheduled_for', 'Scheduled For'), select('delivery_status', 'Delivery Status', ['pending', 'sent', 'failed', 'read', 'delivered'])] },
    whatsappConversations: { label: 'WhatsApp Conversations', ...viewMeta.whatsappConversations, group: 'whatsapp', navOrder: 30, superAdmin: true, clinic: true, path: 'whatsapp/conversations', searchFields: ['customer_phone', 'conversation_status'], filters: { super_admin: ['clinic_id', 'conversation_status', 'current_owner_type'], clinic: ['conversation_status', 'current_owner_type'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('patient_id', 'Patient', 'patients'), text('customer_phone', 'Customer Phone', true), select('conversation_status', 'Conversation Status', ['open', 'closed', 'bot_active', 'staff_active']), select('current_owner_type', 'Owner Type', ['bot', 'staff', 'system'])] },
    whatsappMessages: { label: 'WhatsApp Messages', ...viewMeta.whatsappMessages, group: 'whatsapp', navOrder: 40, superAdmin: true, clinic: true, path: 'whatsapp/messages', searchFields: ['provider_message_id', 'delivery_status'], filters: { super_admin: ['clinic_id', 'conversation_id', 'delivery_status', 'direction'], clinic: ['conversation_id', 'delivery_status', 'direction'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('conversation_id', 'Conversation', 'whatsapp/conversations', true), relation('patient_id', 'Patient', 'patients'), relation('appointment_id', 'Appointment', 'appointments'), select('direction', 'Direction', ['incoming', 'outgoing'], true), select('message_type', 'Message Type', ['text', 'template', 'image', 'document', 'interactive', 'button', 'location', 'other'], true), text('notification_type', 'Notification Type'), text('content_text', 'Content Text'), select('delivery_status', 'Delivery Status', ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'received'])] },
    whatsappSessions: { label: 'WhatsApp Sessions', ...viewMeta.whatsappSessions, group: 'whatsapp', navOrder: 50, superAdmin: true, clinic: true, path: 'whatsapp/sessions', searchFields: ['flow_type', 'status'], filters: { super_admin: ['clinic_id', 'conversation_id', 'status'], clinic: ['conversation_id', 'status'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('conversation_id', 'Conversation', 'whatsapp/conversations', true), relation('patient_id', 'Patient', 'patients'), select('flow_type', 'Flow Type', ['appointment_booking', 'confirmation', 'reschedule', 'cancellation', 'review_request', 'support'], true), text('current_step', 'Current Step', true), select('status', 'Status', ['active', 'completed', 'expired', 'cancelled', 'handover']), text('started_at', 'Started At')] },
    clinicSettings: { label: 'Clinic Settings', ...viewMeta.clinicSettings, group: 'settings', navOrder: 10, superAdmin: true, clinic: true, path: 'settings/clinic', searchFields: ['clinic_id'], filters: { super_admin: ['clinic_id'], clinic: [] }, formFields: [relation('clinic_id', 'Clinic', 'clinics', true), checkbox('booking_enabled', 'Booking Enabled'), checkbox('walkin_enabled', 'Walkin Enabled'), checkbox('token_system_enabled', 'Token System Enabled'), number('max_advance_booking_days', 'Max Advance Booking Days'), number('min_booking_notice_minutes', 'Min Booking Notice Minutes'), checkbox('whatsapp_booking_enabled', 'WhatsApp Booking Enabled'), checkbox('auto_confirm_appointments', 'Auto Confirm Appointments'), checkbox('allow_reschedule', 'Allow Reschedule'), checkbox('allow_cancel', 'Allow Cancel'), number('reschedule_cutoff_hours', 'Reschedule Cutoff Hours'), number('cancel_cutoff_hours', 'Cancel Cutoff Hours'), number('reminder_hours_before', 'Reminder Hours Before (0 = off)'), checkbox('portal_enabled', 'Patient portal enabled'), checkbox('waitlist_enabled', 'Waitlist enabled'), number('waitlist_hold_minutes', 'Waitlist hold (minutes)'), text('invoice_prefix', 'Invoice number prefix (max 10 characters)'), number('invoice_tax_percent', 'Invoice tax (%)'), textarea('invoice_footer_note', 'Invoice footer note')] },
    auditLogs: { label: 'Audit Logs', ...viewMeta.auditLogs, group: 'audit', navOrder: 10, superAdmin: true, clinic: true, path: 'audit-logs', searchFields: ['module', 'action'], filters: { super_admin: ['clinic_id', 'user_id', 'module', 'action'], clinic: ['user_id', 'module', 'action'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), relation('user_id', 'User', 'users'), text('module', 'Module', true), text('entity_type', 'Entity Type', true), number('entity_id', 'Entity ID'), text('action', 'Action', true)] },

    reviews: { label: 'Reviews', ...viewMeta.reviews, group: 'communication', navOrder: 60, superAdmin: true, clinic: true, path: 'reviews', searchFields: ['reviewer_name', 'message', 'sentiment'], filters: { super_admin: ['clinic_id', 'rating', 'sentiment'], clinic: ['rating', 'sentiment'] }, formFields: [relation('clinic_id', 'Clinic', 'clinics'), text('reviewer_name', 'Reviewer Name'), textarea('message', 'Review Message', true), select('rating', 'Rating', ['1', '2', '3', '4', '5'], true), date('review_date', 'Review Date')] },
};

export const sidebarByRole = {
    super_admin: ['clinics', 'domains', 'users', 'doctors', 'services', 'patients', 'followups', 'reminders', 'whatsappConversations', 'clinicSettings'],
    clinic_admin: ['users', 'doctors', 'services', 'patients', 'whatsappConversations', 'reminders'],
    doctor: ['patients', 'followups', 'whatsappConversations'],
    receptionist: ['patients', 'followups', 'reminders', 'whatsappConversations'],
    assistant: ['patients', 'followups'],
};
