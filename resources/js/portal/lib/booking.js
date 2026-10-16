// Visit-type / consultation-mode choices shared by the booking form
// (pages/Book.jsx) and the waitlist offer page (pages/WaitlistOffer.jsx).

export const VISIT_TYPES = [
    { value: 'new', label: 'New visit' },
    { value: 'followup', label: 'Follow-up' },
];

export const MODE_LABELS = {
    in_person: 'In person',
    video: 'Video call',
    phone: 'Phone call',
};

// A doctor's offered modes, falling back to in-person when none are set.
export function modeOptionsFor(doctor) {
    return doctor?.consultation_modes?.length ? doctor.consultation_modes : ['in_person'];
}
