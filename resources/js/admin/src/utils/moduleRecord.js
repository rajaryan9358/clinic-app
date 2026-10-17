// Helpers shared by the generic list / view / form pages. They read the
// optional presentation keys that config/modules.js carries per module
// (`labels`, `sections`, `formats`, `hidden`, `title`, `singular`, `icon`)
// and fall back to generic behaviour when a module declares none.

/** The original prettifier: `assigned_to_user_id` -> `Assigned To User Id`. */
export function prettifyKey(key) {
    return String(key)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** `appointment_reminder` -> `Appointment reminder`. For enum-like values. */
export function humanizeValue(value) {
    const text = String(value).replaceAll('_', ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The human label for a record field: the module's own `labels` map first,
 * then `fallback` (e.g. a form field's own label), then the prettifier.
 */
export function fieldLabel(module, key, fallback) {
    return module?.labels?.[key] || fallback || prettifyKey(key);
}

const NAME_KEYS = ['name', 'full_name', 'host', 'title', 'label'];

/** A display name for an embedded relation object, or '' when it has none. */
export function relationName(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const hit = NAME_KEYS.map((k) => value[k]).find((v) => typeof v === 'string' && v.trim().length);
    return hit || '';
}

/** The record's own name for the page header. */
export function recordTitle(module, record) {
    if (!record) return '';
    const custom = typeof module?.title === 'function' ? module.title(record) : '';
    if (custom && String(custom).trim()) return String(custom).trim();
    return `${module?.singular || module?.label || 'Record'} #${record.id}`;
}

/** Display format for a field: the module's explicit one, else 'boolean' for checkbox fields (a DB 1/0 is not "1"). */
export function formatFor(module, key) {
    if (module?.formats?.[key]) return module.formats[key];
    const isCheckbox = (module?.formFields || []).some((f) => f.key === key && f.type === 'checkbox');
    return isCheckbox ? 'boolean' : undefined;
}

const ALWAYS_HIDDEN = new Set(['id', 'password', 'remember_token', 'deleted_at']);
const TIMESTAMP_KEYS = ['created_at', 'updated_at'];

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Turn a record into display sections: [{ title, fields: [{ key, label, value, format }] }].
 *
 * Related records are shown by name only when the API response already
 * embeds the relation (`assigned_to_user_id` + `assigned_to_user: { name }`).
 * A bare `*_id` / `*_ids` with no embedded relation is omitted rather than
 * printed as a number - this never triggers a lookup request.
 */
export function buildSections(module, record) {
    if (!record) return [];

    const hidden = new Set([...ALWAYS_HIDDEN, ...(module?.hidden || [])]);
    const fields = new Map();

    Object.entries(record).forEach(([key, value]) => {
        if (hidden.has(key) || TIMESTAMP_KEYS.includes(key)) return;
        if (key.endsWith('_ids')) return;

        if (key.endsWith('_id')) {
            const name = relationName(record[key.slice(0, -3)]);
            if (!name) return;
            fields.set(key, { key, label: fieldLabel(module, key), value: name, format: 'text' });
            return;
        }

        // The embedded relation object itself is already shown via its `*_id`.
        if (value && typeof value === 'object' && !Array.isArray(value) && `${key}_id` in record) return;

        if (Array.isArray(value)) {
            // Only flat lists read well; lists of objects are technical payloads.
            if (!value.every((v) => typeof v === 'string' || typeof v === 'number')) return;
            fields.set(key, { key, label: fieldLabel(module, key), value: value.join(', '), format: 'text' });
            return;
        }

        if (value && typeof value === 'object') {
            const name = relationName(value);
            if (!name) return;
            fields.set(key, { key, label: fieldLabel(module, key), value: name, format: 'text' });
            return;
        }

        fields.set(key, { key, label: fieldLabel(module, key), value, format: formatFor(module, key) });
    });

    const sections = [];
    const placed = new Set();

    (module?.sections || []).forEach((section) => {
        // Fields a section names are shown even when empty, so a gap is visible.
        const items = section.keys
            .filter((key) => !hidden.has(key))
            .map((key) => {
                placed.add(key);
                if (fields.has(key)) return fields.get(key);
                // A listed key the loop above skipped (absent, a bare id, a payload) stays out.
                const raw = record[key];
                const isPlain = key in record && !key.endsWith('_id') && !key.endsWith('_ids') && (raw === null || typeof raw !== 'object');
                return isPlain ? { key, label: fieldLabel(module, key), value: raw, format: formatFor(module, key) } : null;
            })
            .filter(Boolean);
        if (items.length) sections.push({ title: section.title, fields: items });
    });

    const rest = [...fields.values()].filter((f) => !placed.has(f.key) && !isEmpty(f.value));
    if (rest.length) sections.push({ title: sections.length ? 'Other details' : 'Details', fields: rest });

    const stamps = TIMESTAMP_KEYS
        .filter((key) => !isEmpty(record[key]))
        .map((key) => ({ key, label: fieldLabel(module, key, key === 'created_at' ? 'Created' : 'Last updated'), value: record[key], format: undefined }));
    if (stamps.length) sections.push({ title: 'Record', fields: stamps });

    return sections;
}
