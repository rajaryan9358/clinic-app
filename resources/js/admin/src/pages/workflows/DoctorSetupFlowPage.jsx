import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';

function tabButton(active) {
    return active
        ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white'
        : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
}

const inputBase = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(d) {
    return DAY_NAMES[Number(d)] ?? String(d);
}

function fmtTime(t) {
    if (!t) return '';
    return String(t).slice(0, 5);
}

function generateSlots(startTime, endTime, durationMin) {
    if (!startTime || !endTime || !durationMin) return [];
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const slots = [];
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    while (cur + durationMin <= end) {
        slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
        cur += durationMin;
    }
    return slots;
}

function toYmd(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseTimeToMin(t) {
    if (!t) return null;
    const [h, m] = String(t).slice(0, 5).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
}

function fmtMinToTime(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function startOfWeek(date, weekStartsOn = 1) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = (day - weekStartsOn + 7) % 7;
    d.setDate(d.getDate() - diff);
    return d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function diffDays(a, b) {
    const ms = a.getTime() - b.getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000));
}

function timeRows(stepMin) {
    const step = Math.max(5, Math.min(60, Number(stepMin) || 15));
    const rows = [];
    for (let m = 0; m < 24 * 60; m += step) rows.push(fmtMinToTime(m));
    return rows;
}

function slotsToRanges(slotTimes, stepMin) {
    const step = Math.max(5, Math.min(240, Number(stepMin) || 15));
    const mins = (slotTimes || [])
        .map((t) => parseTimeToMin(String(t).slice(0, 5)))
        .filter((m) => m != null)
        .sort((a, b) => a - b);
    if (!mins.length) return [];

    const ranges = [];
    let start = mins[0];
    let prev = mins[0];
    for (let i = 1; i < mins.length; i++) {
        const cur = mins[i];
        if (cur === prev + step) {
            prev = cur;
            continue;
        }
        ranges.push({ startMin: start, endMin: prev + step });
        start = cur;
        prev = cur;
    }
    ranges.push({ startMin: start, endMin: prev + step });
    return ranges;
}

function normalizeRanges(ranges) {
    const sorted = (ranges || [])
        .map((r) => ({ startMin: Number(r.startMin), endMin: Number(r.endMin) }))
        .filter((r) => Number.isFinite(r.startMin) && Number.isFinite(r.endMin) && r.endMin > r.startMin)
        .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    if (!sorted.length) return [];
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const cur = sorted[i];
        if (cur.startMin <= last.endMin) {
            last.endMin = Math.max(last.endMin, cur.endMin);
            continue;
        }
        merged.push(cur);
    }
    return merged;
}

function subtractRanges(baseRanges, cutRanges) {
    const base = normalizeRanges(baseRanges);
    const cuts = normalizeRanges(cutRanges);
    if (!base.length) return [];
    if (!cuts.length) return base;

    const out = [];
    for (const b of base) {
        let segments = [b];
        for (const c of cuts) {
            const nextSegs = [];
            for (const s of segments) {
                // no overlap
                if (c.endMin <= s.startMin || c.startMin >= s.endMin) {
                    nextSegs.push(s);
                    continue;
                }
                // cut eats whole segment
                if (c.startMin <= s.startMin && c.endMin >= s.endMin) {
                    continue;
                }
                // cut splits segment
                if (c.startMin > s.startMin) {
                    nextSegs.push({ startMin: s.startMin, endMin: Math.min(c.startMin, s.endMin) });
                }
                if (c.endMin < s.endMin) {
                    nextSegs.push({ startMin: Math.max(c.endMin, s.startMin), endMin: s.endMin });
                }
            }
            segments = nextSegs;
            if (!segments.length) break;
        }
        out.push(...segments);
    }
    return normalizeRanges(out);
}

function layoutOverlapping(items) {
    const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const lanesEnd = [];
    let maxLanes = 0;
    const placed = sorted.map((it) => {
        let lane = lanesEnd.findIndex((end) => end <= it.startMin);
        if (lane === -1) {
            lane = lanesEnd.length;
            lanesEnd.push(it.endMin);
        } else {
            lanesEnd[lane] = it.endMin;
        }
        maxLanes = Math.max(maxLanes, lanesEnd.length);
        return { ...it, lane };
    });
    return { items: placed, lanes: Math.max(1, maxLanes) };
}

function modeChipClass(mode) {
    if (mode === 'video') return 'bg-purple-100 text-purple-700 border-purple-200';
    if (mode === 'both') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return 'bg-blue-100 text-blue-700 border-blue-200';
}

function modeLabel(mode) {
    if (mode === 'in_person') return 'Walk-in';
    if (mode === 'video') return 'Video';
    if (mode === 'both') return 'Both';
    return mode;
}

// The self-view-lock redirect (a doctor may only view their own doctor
// record here) lives in the default-exported wrapper below, not here, so
// this component can call every hook it needs unconditionally. (An
// early-return between two hook calls can change how many hooks run
// between renders of the same mounted instance, which React forbids and
// crashes on.)
function DoctorSetupFlowPageInner() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { roleKind, can } = useScope() || {};
    const canAddSchedule = Boolean(can?.('doctor_schedules.create'));
    const canRemoveSchedule = Boolean(can?.('doctor_schedules.delete'));
    // Doctor-kind users edit their own details from their profile page (the
    // generic doctor write route 403s for them); everyone else needs
    // doctors.edit to change the profile fields or photo here.
    const canEditDoctorProfile = roleKind !== 'doctor' && Boolean(can?.('doctors.edit'));
    const [searchParams] = useSearchParams();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const allowedTabs = useMemo(() => {
        if (roleKind === 'doctor') {
            return new Set(['calendar', 'availability', 'summary', 'profile']);
        }
        return new Set(['calendar', 'availability', 'summary', 'profile', 'services']);
    }, [roleKind]);
    const initialTab = useMemo(() => {
        const t = String(searchParams.get('tab') || '').trim();
        return allowedTabs.has(t) ? t : 'calendar';
    }, [allowedTabs, searchParams]);
    const [tab, setTab] = useState(initialTab);

    useEffect(() => {
        const t = String(searchParams.get('tab') || '').trim();
        if (t && allowedTabs.has(t) && t !== tab) {
            setTab(t);
        }
    }, [allowedTabs, searchParams, tab]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [services, setServices] = useState([]);

    const [savingProfile, setSavingProfile] = useState(false);
    const [savingMappings, setSavingMappings] = useState(false);

    const photoInputRef = useRef(null);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreview, setPhotoPreview] = useState('');

    const [profileDraft, setProfileDraft] = useState({
        title: '',
        full_name: '',
        specialization: '',
        qualification: '',
        experience_years: '',
        gender: '',
        phone: '',
        email: '',
        photo_url: '',
        consultation_fee: '',
        followup_fee: '',
        slot_duration_minutes: 15,
        buffer_time_minutes: 0,
        status: 'active',
    });

    const [mappingDraft, setMappingDraft] = useState({ service_ids: [] });

    const [scheduleDraft, setScheduleDraft] = useState({
        day_of_week: '1',
        start_time: '10:00',
        end_time: '13:00',
        consultation_mode: 'in_person',
        max_patients: '',
        slot_duration_minutes: '',
        buffer_time_minutes: '',
        is_active: true,
    });
    const [scheduleSaving, setScheduleSaving] = useState(false);

    const [exceptionDraft, setExceptionDraft] = useState({
        exception_date: new Date().toISOString().slice(0, 10),
        type: 'leave',
        start_time: '',
        end_time: '',
        reason: '',
    });
    const [exceptionSaving, setExceptionSaving] = useState(false);

    // Availability side sheet (opened from calendar click on empty space)
    const [availSheet, setAvailSheet] = useState({ open: false, mode: 'schedule' }); // mode: 'schedule' | 'exception'

    // Appointment confirm dialog (opened from calendar click on available slot)
    const [apptConfirm, setApptConfirm] = useState({ open: false, date: '', time: '', endTime: '' });

    // Calendar
    const CALENDAR_PAST_DAYS = 30;
    const CALENDAR_FUTURE_DAYS_WANTED = 14;
    const CALENDAR_SHIFT_DAYS = 7;
    const CALENDAR_TIME_COL_WIDTH = 96;
    const CALENDAR_DAY_COL_WIDTH = 240;

    const [calendarRangeStart, setCalendarRangeStart] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return addDays(d, -CALENDAR_PAST_DAYS);
    });
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [calendarError, setCalendarError] = useState('');
    const [calendarAvailByDate, setCalendarAvailByDate] = useState({}); // { ymd: Set(start_time) }
    const [calendarAvailRangesByDate, setCalendarAvailRangesByDate] = useState({}); // { ymd: [{startMin,endMin}] }
    const [calendarBookedByDate, setCalendarBookedByDate] = useState({}); // { ymd: Set(start_time) }
    const [calendarApptsByDate, setCalendarApptsByDate] = useState({}); // { ymd: [{id,startMin,endMin,raw}] }
    const [calendarMaxAdvanceDays, setCalendarMaxAdvanceDays] = useState(30);

    const calendarScrollRef = useRef(null);
    const calendarDidInitScrollRef = useRef(false);
    const calendarIsShiftingRef = useRef(false);
    const calendarRangeStartRef = useRef(calendarRangeStart);
    useEffect(() => {
        calendarRangeStartRef.current = calendarRangeStart;
    }, [calendarRangeStart]);

    const loadProfile = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await client.get(`${base}/doctors/${id}/profile`);
            setData(res.data?.data || null);

            const doc = res.data?.data?.doctor;
            setProfileDraft({
                title: doc?.title || '',
                full_name: doc?.full_name || '',
                specialization: doc?.specialization || '',
                qualification: doc?.qualification || '',
                experience_years: doc?.experience_years ?? '',
                gender: doc?.gender || '',
                phone: doc?.phone || '',
                email: doc?.email || '',
                photo_url: doc?.photo_url || '',
                consultation_fee: doc?.consultation_fee ?? '',
                followup_fee: doc?.followup_fee ?? '',
                slot_duration_minutes: doc?.slot_duration_minutes ?? 15,
                buffer_time_minutes: doc?.buffer_time_minutes ?? 0,
                status: doc?.status || 'active',
            });
            setPhotoPreview(doc?.photo_url || '');
            setPhotoFile(null);

            setMappingDraft({
                service_ids: (res.data?.data?.service_ids || []).map((x) => String(x)),
            });
            setScheduleDraft((prev) => ({
                ...prev,
                slot_duration_minutes: doc?.slot_duration_minutes ?? 15,
                buffer_time_minutes: doc?.buffer_time_minutes ?? 0,
            }));
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load doctor');
        } finally {
            setLoading(false);
        }
    };

    const loadOptions = async (clinicId) => {
        try {
            const params = { per_page: 200 };
            if (user?.role === 'super_admin' && clinicId) params.clinic_id = clinicId;

            const sRes = await client.get(`${base}/services`, { params });

            setServices(sRes.data?.data || []);
        } catch {
            setServices([]);
        }
    };

    useEffect(() => {
        loadProfile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, id]);

    useEffect(() => {
        const clinicId = data?.doctor?.clinic_id;
        if (data) loadOptions(clinicId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    // Fetch clinic settings for calendar future limit (max_advance_booking_days)
    useEffect(() => {
        if (tab !== 'calendar') return;
        if (!data?.doctor) return;

        const controller = new AbortController();
        const run = async () => {
            try {
                const params = {
                    per_page: 1,
                    ...(user?.role === 'super_admin' ? { clinic_id: Number(data?.doctor?.clinic_id) } : {}),
                };
                const res = await client.get(`${base}/settings/clinic`, { params, signal: controller.signal });
                const row = Array.isArray(res.data?.data) ? res.data.data[0] : (Array.isArray(res.data?.data?.data) ? res.data.data.data[0] : null);
                const days = Number(row?.max_advance_booking_days);
                setCalendarMaxAdvanceDays(Number.isFinite(days) && days > 0 ? days : 30);
            } catch (e) {
                if (e?.name === 'CanceledError' || e?.name === 'AbortError') return;
                setCalendarMaxAdvanceDays(30);
            }
        };
        run();
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, base, data?.doctor?.clinic_id]);

    const handlePhotoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoFile(file);
        setPhotoPreview(URL.createObjectURL(file));
    };

    const saveProfile = async () => {
        setSavingProfile(true);
        setError('');
        try {
            let photoUrl = profileDraft.photo_url;
            if (photoFile) {
                const clinicId = data?.doctor?.clinic_id;
                const fd = new FormData();
                fd.append('file', photoFile);
                fd.append('module', 'doctors');
                if (clinicId) fd.append('clinic_id', String(clinicId));
                const upRes = await client.post(`${base}/uploads/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                photoUrl = upRes.data?.data?.url || photoUrl;
            }
            const payload = {
                ...profileDraft,
                photo_url: photoUrl || undefined,
                experience_years: profileDraft.experience_years === '' ? null : Number(profileDraft.experience_years),
                consultation_fee: profileDraft.consultation_fee === '' ? null : Number(profileDraft.consultation_fee),
                followup_fee: profileDraft.followup_fee === '' ? null : Number(profileDraft.followup_fee),
                slot_duration_minutes: profileDraft.slot_duration_minutes === '' ? null : Number(profileDraft.slot_duration_minutes),
                buffer_time_minutes: profileDraft.buffer_time_minutes === '' ? null : Number(profileDraft.buffer_time_minutes),
            };
            await client.put(`${base}/doctors/${id}/profile`, payload);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to save');
        } finally {
            setSavingProfile(false);
        }
    };

    const saveMappings = async () => {
        setSavingMappings(true);
        setError('');
        try {
            const payload = {
                service_ids: mappingDraft.service_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)),
            };
            await client.put(`${base}/doctors/${id}/profile`, payload);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to save');
        } finally {
            setSavingMappings(false);
        }
    };

    const addSchedule = async () => {
        setScheduleSaving(true);
        setError('');
        try {
            await client.post(`${base}/doctors/${id}/schedules`, {
                day_of_week: Number(scheduleDraft.day_of_week),
                start_time: scheduleDraft.start_time,
                end_time: scheduleDraft.end_time,
                consultation_mode: scheduleDraft.consultation_mode,
                max_patients: scheduleDraft.max_patients === '' ? null : Number(scheduleDraft.max_patients),
                slot_duration_minutes: scheduleDraft.slot_duration_minutes === '' ? null : Number(scheduleDraft.slot_duration_minutes),
                buffer_time_minutes: scheduleDraft.buffer_time_minutes === '' ? null : Number(scheduleDraft.buffer_time_minutes),
                is_active: Boolean(scheduleDraft.is_active),
            });
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to add schedule');
        } finally {
            setScheduleSaving(false);
        }
    };

    const removeSchedule = async (scheduleId) => {
        setError('');
        try {
            await client.delete(`${base}/doctors/${id}/schedules/${scheduleId}`);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to remove schedule');
        }
    };

    const addException = async () => {
        setExceptionSaving(true);
        setError('');
        try {
            await client.post(`${base}/doctors/${id}/exceptions`, {
                exception_date: exceptionDraft.exception_date,
                type: exceptionDraft.type,
                start_time: exceptionDraft.start_time || null,
                end_time: exceptionDraft.end_time || null,
                reason: exceptionDraft.reason || null,
            });
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to add exception');
        } finally {
            setExceptionSaving(false);
        }
    };

    const removeException = async (exceptionId) => {
        setError('');
        try {
            await client.delete(`${base}/doctors/${id}/exceptions/${exceptionId}`);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to remove exception');
        }
    };

    const doctor = data?.doctor;
    const setup = data?.setup || {};

    // Group schedules by day of week for display
    const schedulesByDay = useMemo(() => {
        const map = {};
        for (const s of (data?.doctor?.schedules || [])) {
            const d = String(s.day_of_week);
            if (!map[d]) map[d] = [];
            map[d].push(s);
        }
        return map;
    }, [data]);

    const toggleService = (serviceId) => {
        const sid = String(serviceId);
        setMappingDraft((p) => {
            const ids = p.service_ids;
            return { ...p, service_ids: ids.includes(sid) ? ids.filter((x) => x !== sid) : [...ids, sid] };
        });
    };

    const effectiveSlotStep = Math.max(5, Math.min(60, Number(profileDraft.slot_duration_minutes) || 15));
    const calendarToday = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);
    const maxAllowedDate = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + Math.max(0, Number(calendarMaxAdvanceDays) || 0));
        return d;
    }, [calendarMaxAdvanceDays]);

    const calendarFutureDays = useMemo(() => {
        const allowed = Math.max(0, diffDays(maxAllowedDate, calendarToday));
        return Math.min(CALENDAR_FUTURE_DAYS_WANTED, allowed);
    }, [maxAllowedDate, calendarToday]);

    const calendarVisibleDays = useMemo(() => {
        return CALENDAR_PAST_DAYS + calendarFutureDays + 1;
    }, [calendarFutureDays]);

    const maxCalendarRangeStartAllowed = useMemo(() => {
        const d = new Date(maxAllowedDate);
        d.setHours(0, 0, 0, 0);
        return addDays(d, -(calendarVisibleDays - 1));
    }, [maxAllowedDate, calendarVisibleDays]);

    // Default: start from (today - pastDays) when opening calendar.
    useEffect(() => {
        if (tab !== 'calendar') return;
        calendarDidInitScrollRef.current = false;
        setCalendarRangeStart(addDays(calendarToday, -CALENDAR_PAST_DAYS));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    // Clamp range start so the visible range never exceeds future limit.
    useEffect(() => {
        if (tab !== 'calendar') return;
        setCalendarRangeStart((cur) => {
            const curEnd = addDays(cur, calendarVisibleDays - 1);
            if (curEnd.getTime() <= maxAllowedDate.getTime()) return cur;
            return maxCalendarRangeStartAllowed;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, maxAllowedDate, maxCalendarRangeStartAllowed]);
    const calendarDays = useMemo(() => {
        const start = calendarRangeStart;
        return Array.from({ length: calendarVisibleDays }, (_, i) => {
            const d = addDays(start, i);
            return {
                date: d,
                ymd: toYmd(d),
                dow: d.getDay(),
            };
        });
    }, [calendarRangeStart, calendarVisibleDays]);

    const handleCalendarScroll = () => {
        const el = calendarScrollRef.current;
        if (!el) return;
        if (calendarIsShiftingRef.current) return;

        const thresholdPx = Math.max(80, CALENDAR_DAY_COL_WIDTH * 0.75);
        const nearLeft = el.scrollLeft < thresholdPx;
        const nearRight = el.scrollLeft > (el.scrollWidth - el.clientWidth - thresholdPx);
        if (!nearLeft && !nearRight) return;

        const cur = calendarRangeStartRef.current;
        let next = cur;

        if (nearLeft) {
            next = addDays(cur, -CALENDAR_SHIFT_DAYS);
        } else if (nearRight) {
            const candidate = addDays(cur, CALENDAR_SHIFT_DAYS);
            next = candidate.getTime() > maxCalendarRangeStartAllowed.getTime() ? maxCalendarRangeStartAllowed : candidate;
        }

        if (next.getTime() === cur.getTime()) return;

        const delta = diffDays(next, cur);
        calendarIsShiftingRef.current = true;
        setCalendarRangeStart(next);
        requestAnimationFrame(() => {
            const elNow = calendarScrollRef.current;
            if (elNow) elNow.scrollLeft -= delta * CALENDAR_DAY_COL_WIDTH;
            calendarIsShiftingRef.current = false;
        });
    };

    const calendarExceptionsByDate = useMemo(() => {
        const ex = Array.isArray(data?.doctor?.exceptions) ? data.doctor.exceptions : [];
        const map = {};
        for (const e of ex) {
            const ymd = String(e.exception_date || '').slice(0, 10);
            if (!ymd) continue;
            if (!map[ymd]) map[ymd] = [];
            map[ymd].push(e);
        }
        return map;
    }, [data]);

    const calendarScheduleWindowsByDate = useMemo(() => {
        const schedules = Array.isArray(data?.doctor?.schedules) ? data.doctor.schedules : [];

        const scheduleDowValues = schedules
            .filter((s) => s?.is_active)
            .map((s) => Number(s.day_of_week))
            .filter((n) => Number.isFinite(n));

        // Determine the stored convention:
        // - Preferred (and backend-validated): 0=Sun..6=Sat
        // - Legacy possibility: ISO 1=Mon..7=Sun (only detect if we actually see a 7)
        const hasSeven = scheduleDowValues.includes(7);
        const dowMode = hasSeven ? 'iso' : 'js';

        const getLookupDowKey = (jsDow) => {
            if (dowMode === 'js') return String(jsDow);
            // ISO: 1=Mon..7=Sun
            return String(jsDow === 0 ? 7 : jsDow);
        };

        const byDow = {};
        for (const s of schedules) {
            if (!s?.is_active) continue;
            const dow = String(Number(s.day_of_week));
            if (!byDow[dow]) byDow[dow] = [];
            byDow[dow].push(s);
        }

        const map = {};
        for (const day of calendarDays) {
            const ymd = day.ymd;
            const exceptions = calendarExceptionsByDate[ymd] || [];
            const special = exceptions.filter((e) => e.type === 'special_hours' && e.start_time && e.end_time);
            if (special.length) {
                map[ymd] = special.map((e) => ({ start_time: String(e.start_time).slice(0, 5), end_time: String(e.end_time).slice(0, 5) }));
                continue;
            }

            const key = getLookupDowKey(day.dow);
            const dowSchedules = byDow[key] || [];
            map[ymd] = dowSchedules.map((s) => ({ start_time: String(s.start_time).slice(0, 5), end_time: String(s.end_time).slice(0, 5) }));
        }
        return map;
    }, [data, calendarDays, calendarExceptionsByDate]);

    const calendarAvailRangesEffectiveByDate = useMemo(() => {
        const map = {};
        for (const day of calendarDays) {
            const ymd = day.ymd;

            const ex = calendarExceptionsByDate[ymd] || [];
            const fullDayLeave = ex.some((e) => e.type === 'leave');
            const fullDayBlocked = ex.some((e) => e.type === 'blocked' && !e.start_time && !e.end_time);
            if (fullDayLeave || fullDayBlocked) {
                map[ymd] = [];
                continue;
            }

            // Fallback: derive from schedules/special_hours and subtract blocked ranges.
            const windows = calendarScheduleWindowsByDate[ymd] || [];
            const baseRanges = windows
                .map((w) => ({
                    startMin: parseTimeToMin(w.start_time),
                    endMin: parseTimeToMin(w.end_time),
                }))
                .filter((r) => r.startMin != null && r.endMin != null && r.endMin > r.startMin);

            const blockedCuts = ex
                .filter((e) => e.type === 'blocked' && e.start_time && e.end_time)
                .map((e) => ({
                    startMin: parseTimeToMin(String(e.start_time).slice(0, 5)),
                    endMin: parseTimeToMin(String(e.end_time).slice(0, 5)),
                }))
                .filter((r) => r.startMin != null && r.endMin != null && r.endMin > r.startMin);

            const scheduleRanges = subtractRanges(baseRanges, blockedCuts);

            // Prefer API availability when it returned actual slots for this day.
            if (Object.prototype.hasOwnProperty.call(calendarAvailRangesByDate, ymd)) {
                const apiSlotCount = calendarAvailByDate[ymd]?.size || 0;
                const apiRanges = calendarAvailRangesByDate[ymd] || [];
                if (apiSlotCount > 0 || apiRanges.length > 0) {
                    map[ymd] = apiRanges;
                    continue;
                }
                // If API returned empty but schedules exist, trust schedules.
                if (scheduleRanges.length) {
                    map[ymd] = scheduleRanges;
                    continue;
                }
                map[ymd] = apiRanges;
                continue;
            }

            map[ymd] = scheduleRanges;
        }
        return map;
    }, [calendarDays, calendarExceptionsByDate, calendarAvailRangesByDate, calendarAvailByDate, calendarScheduleWindowsByDate]);

    const calendarAvailSlotCountByDate = useMemo(() => {
        const map = {};
        for (const day of calendarDays) {
            const ymd = day.ymd;
            const apiCount = calendarAvailByDate[ymd]?.size || 0;
            if (Object.prototype.hasOwnProperty.call(calendarAvailByDate, ymd) && apiCount > 0) {
                map[ymd] = apiCount;
                continue;
            }
            const ranges = calendarAvailRangesEffectiveByDate[ymd] || [];
            let count = 0;
            for (const r of ranges) {
                count += Math.max(0, Math.floor((r.endMin - r.startMin) / effectiveSlotStep));
            }
            map[ymd] = count;
        }
        return map;
    }, [calendarDays, calendarAvailByDate, calendarAvailRangesEffectiveByDate, effectiveSlotStep]);

    const isTimeInAnyWindow = (ymd, t) => {
        const windows = calendarScheduleWindowsByDate[ymd] || [];
        const m = parseTimeToMin(t);
        if (m == null) return false;
        for (const w of windows) {
            const ws = parseTimeToMin(w.start_time);
            const we = parseTimeToMin(w.end_time);
            if (ws == null || we == null) continue;
            if (m >= ws && m < we) return true;
        }
        return false;
    };

    const isBlockedByException = (ymd, t) => {
        const m = parseTimeToMin(t);
        if (m == null) return false;
        const ex = calendarExceptionsByDate[ymd] || [];
        const fullDayLeave = ex.some((e) => e.type === 'leave');
        const fullDayBlocked = ex.some((e) => e.type === 'blocked' && !e.start_time && !e.end_time);
        if (fullDayLeave || fullDayBlocked) return true;
        for (const e of ex) {
            if (e.type !== 'blocked') continue;
            if (!e.start_time || !e.end_time) continue;
            const s = parseTimeToMin(String(e.start_time).slice(0, 5));
            const end = parseTimeToMin(String(e.end_time).slice(0, 5));
            if (s == null || end == null) continue;
            if (m >= s && m < end) return true;
        }
        return false;
    };

    // Compute smart view hour range from doctor's schedule & exception times
    const calendarViewHours = useMemo(() => {
        const schedules = data?.doctor?.schedules || [];
        const exceptions = data?.doctor?.exceptions || [];
        const times = [];
        for (const s of schedules) {
            if (s.start_time) times.push(parseTimeToMin(String(s.start_time).slice(0, 5)));
            if (s.end_time) times.push(parseTimeToMin(String(s.end_time).slice(0, 5)));
        }
        for (const e of exceptions) {
            if (e.start_time) times.push(parseTimeToMin(String(e.start_time).slice(0, 5)));
            if (e.end_time) times.push(parseTimeToMin(String(e.end_time).slice(0, 5)));
        }
        const valid = times.filter((t) => t != null && Number.isFinite(t));
        if (!valid.length) return { viewStartMin: 6 * 60, viewEndMin: 21 * 60 };
        const minT = Math.min(...valid);
        const maxT = Math.max(...valid);
        return {
            viewStartMin: Math.max(0, Math.floor((minT - 60) / 60) * 60),
            viewEndMin: Math.min(24 * 60, Math.ceil((maxT + 60) / 60) * 60),
        };
    }, [data]);

    // Fetch week availability + booked appointments for calendar
    useEffect(() => {
        if (tab !== 'calendar') return;
        if (!data?.doctor) return;

        const controller = new AbortController();
        const run = async () => {
            setCalendarLoading(true);
            setCalendarError('');
            try {
                const from = toYmd(calendarRangeStart);
                const to = toYmd(addDays(calendarRangeStart, calendarVisibleDays - 1));
                const clinicId = data?.doctor?.clinic_id;
                const doctorId = Number(id);

                // Availability
                const availParams = {
                    doctor_id: doctorId,
                    from_date: from,
                    to_date: to,
                };
                if (user?.role === 'super_admin') availParams.clinic_id = Number(clinicId);

                const [availRes, apptRes] = await Promise.all([
                    client.get(`${base}/appointments/availability`, { params: availParams, signal: controller.signal }),
                    client.get(`${base}/appointments`, {
                        params: {
                            per_page: 500,
                            sort_by: 'appointment_date',
                            sort_dir: 'asc',
                            ...(user?.role === 'super_admin' ? { clinic_id: Number(clinicId) } : {}),
                            doctor_id: doctorId,
                            appointment_date_from: from,
                            appointment_date_to: to,
                        },
                        signal: controller.signal,
                    }),
                ]);

                const nextAvail = {};
                const nextAvailRanges = {};
                const days = availRes.data?.data?.days || [];
                for (const d of days) {
                    const ymd = String(d.date || '').slice(0, 10);
                    const slots = Array.isArray(d.slots) ? d.slots : [];
                    // Slots are objects { start_time, end_time, available } — extract start_time strings.
                    const toTime = (s) => typeof s === 'string' ? s.slice(0, 5) : String(s?.start_time || '').slice(0, 5);
                    const allSlotTimes = slots.map(toTime).filter(Boolean);
                    const availSlotTimes = slots.filter((s) => typeof s === 'string' || s?.available !== false).map(toTime).filter(Boolean);
                    nextAvail[ymd] = new Set(availSlotTimes);
                    // Build ranges from ALL slots (including booked) so the full schedule window is visible;
                    // individual slot buttons are coloured available/booked via calendarBookedByDate.
                    nextAvailRanges[ymd] = slotsToRanges(allSlotTimes, effectiveSlotStep);
                }

                const nextBooked = {};
                const nextApptsByDate = {};
                // paginated() returns { data: [...], meta: {...} } — one level, not nested.
                const appts = Array.isArray(apptRes.data?.data) ? apptRes.data.data : [];
                for (const a of appts) {
                    const ymd = String(a.appointment_date || '').slice(0, 10);
                    if (!ymd) continue;
                    if (['cancelled', 'rescheduled'].includes(String(a.status || '').toLowerCase())) continue;

                    const start = parseTimeToMin(String(a.start_time || '').slice(0, 5));
                    const endRaw = parseTimeToMin(String(a.end_time || '').slice(0, 5));
                    const end = endRaw != null ? endRaw : (start != null ? start + effectiveSlotStep : null);
                    if (start == null || end == null) continue;
                    if (!nextBooked[ymd]) nextBooked[ymd] = new Set();
                    if (!nextApptsByDate[ymd]) nextApptsByDate[ymd] = [];

                    for (let m = start; m < end; m += effectiveSlotStep) {
                        nextBooked[ymd].add(fmtMinToTime(m));
                    }

                    nextApptsByDate[ymd].push({
                        id: a.id,
                        startMin: start,
                        endMin: end,
                        raw: a,
                    });
                }

                setCalendarAvailByDate(nextAvail);
                setCalendarAvailRangesByDate(nextAvailRanges);
                setCalendarBookedByDate(nextBooked);
                setCalendarApptsByDate(nextApptsByDate);
            } catch (e) {
                if (e?.name === 'CanceledError' || e?.name === 'AbortError') return;
                setCalendarError(e?.response?.data?.message || e?.message || 'Failed to load calendar');
            } finally {
                setCalendarLoading(false);
            }
        };

        run();
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, calendarRangeStart, calendarVisibleDays, base, id, data?.doctor?.clinic_id]);

    // Initial horizontal scroll positioning: land on Today by default.
    useEffect(() => {
        if (tab !== 'calendar') return;
        const el = calendarScrollRef.current;
        if (!el) return;
        if (calendarDidInitScrollRef.current) return;

        calendarDidInitScrollRef.current = true;
        const todayYmd = toYmd(calendarToday);
        const idx = calendarDays.findIndex((d) => d.ymd === todayYmd);

        requestAnimationFrame(() => {
            const elNow = calendarScrollRef.current;
            if (!elNow) return;
            const safeIdx = idx >= 0 ? idx : Math.min(CALENDAR_PAST_DAYS, Math.floor(calendarVisibleDays / 2));
            const target = Math.max(0, CALENDAR_TIME_COL_WIDTH + safeIdx * CALENDAR_DAY_COL_WIDTH);
            elNow.scrollLeft = target;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, calendarDays]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="module" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Doctor Setup</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Profile, services, schedules and exceptions.</p>
                    </div>
                </div>
                <Link to="/modules/doctors" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Back to Doctors</Link>
            </div>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

            {/* Doctor summary card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {loading ? (
                    <div className="text-sm text-slate-600">Loading…</div>
                ) : doctor ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-4">
                            {doctor.photo_url ? (
                                <img src={doctor.photo_url} alt={doctor.full_name} className="h-16 w-14 rounded-xl border border-slate-200 object-cover" />
                            ) : (
                                <div className="flex h-16 w-14 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-400">
                                    {(doctor.full_name || '?')[0]}
                                </div>
                            )}
                            <div>
                                <div className="text-lg font-semibold text-slate-900">{[doctor?.title, doctor?.full_name].filter(Boolean).join(' ')}</div>
                                {doctor.specialization && <div className="mt-0.5 text-sm text-slate-500">{doctor.specialization}{doctor.qualification ? ` · ${doctor.qualification}` : ''}</div>}
                                <div className="mt-1"><StatusBadge status={doctor.status} /></div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                            {[
                                { label: 'Services', ok: setup.has_services },
                                { label: 'Schedule', ok: setup.has_schedules },
                            ].map(({ label, ok }) => (
                                <div key={label} className={`rounded-xl border px-3 py-2 ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                    <div className={`text-xs font-semibold uppercase tracking-wide ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>{label}</div>
                                    <div className={`mt-0.5 text-sm font-semibold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{ok ? '✓ Ready' : '✗ Missing'}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-slate-600">Doctor not found.</div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                {[
                    { key: 'calendar',     label: 'Calendar' },
                    { key: 'availability', label: 'Availability' },
                    { key: 'summary',      label: 'Summary' },
                    { key: 'profile',      label: 'Profile' },
                    { key: 'services',     label: 'Services' },
                ].filter(({ key }) => allowedTabs.has(key)).map(({ key, label }) => (
                    <button key={key} type="button" onClick={() => setTab(key)} className={tabButton(tab === key)}>
                        {label}
                    </button>
                ))}
            </div>

            {/* ── Summary Tab ── */}
            {tab === 'summary' && (
                <div className="grid gap-4 lg:grid-cols-2">
                    {/* Services summary */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Services</h3>
                        {!(data?.doctor?.services || []).length ? (
                            <p className="text-sm text-slate-400">No services assigned.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {data.doctor.services.map((s) => (
                                    <span key={s.id} className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                                        {s.name || `#${s.id}`}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Schedules summary */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Weekly Schedule</h3>
                        {Object.keys(schedulesByDay).length === 0 ? (
                            <p className="text-sm text-slate-400">No schedules yet.</p>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {Object.entries(schedulesByDay).sort(([a], [b]) => Number(a) - Number(b)).map(([day, daySchedules]) => (
                                    <div key={day} className="rounded-xl border border-slate-200 p-3">
                                        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{dayLabel(day)}</div>
                                        <div className="space-y-1.5">
                                            {daySchedules.map((s) => (
                                                <div key={s.id} className={`rounded-lg border px-2.5 py-1.5 text-xs ${modeChipClass(s.consultation_mode)}`}>
                                                    <span className="font-semibold">{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
                                                    <span className="ml-2 opacity-75">{modeLabel(s.consultation_mode)}</span>
                                                    {!s.is_active && <span className="ml-1 opacity-60">(inactive)</span>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Profile Tab ── */}
            {tab === 'profile' && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold">Profile</h3>
                        {canEditDoctorProfile && (
                            <button
                                type="button"
                                onClick={saveProfile}
                                disabled={savingProfile}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                {savingProfile ? 'Saving…' : 'Save Changes'}
                            </button>
                        )}
                    </div>

                    {/* Photo */}
                    <div className="mt-4 mb-5 flex items-center gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="relative h-28 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                            {photoPreview ? (
                                <img src={photoPreview} alt="profile" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-400">
                                    <AppIcon name="user" className="h-6 w-6" />
                                    <span className="text-xs">No photo</span>
                                </div>
                            )}
                        </div>
                        {canEditDoctorProfile && (
                            <div>
                                <p className="text-sm font-medium text-slate-700">Doctor Photo</p>
                                <p className="mt-0.5 text-xs text-slate-500">Portrait or square · JPG, PNG, WebP · max 2 MB</p>
                                <div className="mt-2 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => photoInputRef.current?.click()}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        {photoPreview ? 'Change Photo' : 'Upload Photo'}
                                    </button>
                                    {photoPreview && (
                                        <button
                                            type="button"
                                            onClick={() => { setPhotoFile(null); setPhotoPreview(''); setProfileDraft((p) => ({ ...p, photo_url: '' })); }}
                                            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                                <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
                            </div>
                        )}
                    </div>

                    {roleKind === 'doctor' ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {[
                                { label: 'Title',               value: profileDraft.title },
                                { label: 'Doctor Name',         value: profileDraft.full_name },
                                { label: 'Specialization',      value: profileDraft.specialization },
                                { label: 'Qualification',       value: profileDraft.qualification },
                                { label: 'Experience Years',    value: profileDraft.experience_years },
                                { label: 'Gender',              value: profileDraft.gender },
                                { label: 'Phone',               value: profileDraft.phone },
                                { label: 'Email',               value: profileDraft.email },
                                { label: 'Consultation Fee (₹)',value: profileDraft.consultation_fee },
                                { label: 'Follow-up Fee (₹)',   value: profileDraft.followup_fee },
                                { label: 'Slot Duration (min)', value: profileDraft.slot_duration_minutes },
                                { label: 'Buffer Time (min)',   value: profileDraft.buffer_time_minutes },
                                { label: 'Status',              value: profileDraft.status },
                            ].map(({ label, value }) => (
                                <div key={label} className="space-y-1">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                                    <p className="text-sm text-slate-900">{value !== '' && value != null ? String(value) : '—'}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Title</label>
                                <select className={inputBase} value={profileDraft.title} onChange={(e) => setProfileDraft((p) => ({ ...p, title: e.target.value }))}>
                                    <option value="Dr.">Dr.</option>
                                    <option value="Prof.">Prof.</option>
                                    <option value="Mr.">Mr.</option>
                                    <option value="Ms.">Ms.</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Doctor Name</label>
                                <input className={inputBase} value={profileDraft.full_name} onChange={(e) => setProfileDraft((p) => ({ ...p, full_name: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Specialization</label>
                                <input className={inputBase} value={profileDraft.specialization} onChange={(e) => setProfileDraft((p) => ({ ...p, specialization: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Qualification</label>
                                <input className={inputBase} value={profileDraft.qualification} onChange={(e) => setProfileDraft((p) => ({ ...p, qualification: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Experience Years</label>
                                <input className={inputBase} type="number" value={profileDraft.experience_years} onChange={(e) => setProfileDraft((p) => ({ ...p, experience_years: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Gender</label>
                                <select className={inputBase} value={profileDraft.gender} onChange={(e) => setProfileDraft((p) => ({ ...p, gender: e.target.value }))}>
                                    <option value="">Select…</option>
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</label>
                                <input className={inputBase} value={profileDraft.phone} onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
                                <input className={inputBase} type="email" value={profileDraft.email} onChange={(e) => setProfileDraft((p) => ({ ...p, email: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Consultation Fee (₹)</label>
                                <input className={inputBase} type="number" value={profileDraft.consultation_fee} onChange={(e) => setProfileDraft((p) => ({ ...p, consultation_fee: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-up Fee (₹)</label>
                                <input className={inputBase} type="number" value={profileDraft.followup_fee} onChange={(e) => setProfileDraft((p) => ({ ...p, followup_fee: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Duration (min)</label>
                                <input className={inputBase} type="number" value={profileDraft.slot_duration_minutes} onChange={(e) => setProfileDraft((p) => ({ ...p, slot_duration_minutes: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buffer Time (min)</label>
                                <input className={inputBase} type="number" value={profileDraft.buffer_time_minutes} onChange={(e) => setProfileDraft((p) => ({ ...p, buffer_time_minutes: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
                                <select className={inputBase} value={profileDraft.status} onChange={(e) => setProfileDraft((p) => ({ ...p, status: e.target.value }))}>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Services Tab ── */}
            {tab === 'services' && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <h3 className="text-lg font-semibold">Service Assignment</h3>
                            <p className="mt-0.5 text-sm text-slate-500">
                                {mappingDraft.service_ids.length
                                    ? `${mappingDraft.service_ids.length} service${mappingDraft.service_ids.length > 1 ? 's' : ''} selected`
                                    : 'No services selected'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={saveMappings}
                            disabled={savingMappings}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                            {savingMappings ? 'Saving…' : 'Save'}
                        </button>
                    </div>

                    {!services.length ? (
                        <p className="mt-4 text-sm text-slate-400">No services available.</p>
                    ) : (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {services.map((s) => {
                                const selected = mappingDraft.service_ids.includes(String(s.id));
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => toggleService(s.id)}
                                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                                            selected
                                                ? 'border-slate-700 bg-slate-900 text-white'
                                                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                    >
                                        <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-xs ${
                                            selected ? 'border-white bg-white text-slate-900' : 'border-slate-300 bg-white'
                                        }`}>
                                            {selected && '✓'}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium leading-tight">{s.name}</div>
                                            {s.description && (
                                                <div className={`mt-0.5 truncate text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{s.description}</div>
                                            )}
                                            {s.price != null && (
                                                <div className={`mt-1 text-xs font-semibold ${selected ? 'text-slate-200' : 'text-slate-600'}`}>₹{s.price}</div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Schedules Tab ── */}
            {tab === 'availability' && (
                <div className="grid gap-4 xl:grid-cols-2">

                    {/* ── LEFT: Schedules ── */}
                    <div className="space-y-3">
                        {/* Add schedule form */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-lg font-semibold">Add Schedule</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">Recurring weekly working hours per day</p>
                                </div>
                                {canAddSchedule ? (
                                    <button
                                        type="button"
                                        onClick={addSchedule}
                                        disabled={scheduleSaving}
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                    >
                                        {scheduleSaving ? 'Saving…' : 'Add'}
                                    </button>
                                ) : null}
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Day</label>
                                    <select className={inputBase} value={scheduleDraft.day_of_week} onChange={(e) => setScheduleDraft((p) => ({ ...p, day_of_week: e.target.value }))}>
                                        {DAY_NAMES.map((name, i) => <option key={i} value={String(i)}>{name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Start Time</label>
                                    <input type="time" className={inputBase} value={scheduleDraft.start_time} onChange={(e) => setScheduleDraft((p) => ({ ...p, start_time: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">End Time</label>
                                    <input type="time" className={inputBase} value={scheduleDraft.end_time} onChange={(e) => setScheduleDraft((p) => ({ ...p, end_time: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</label>
                                    <select className={inputBase} value={scheduleDraft.consultation_mode} onChange={(e) => setScheduleDraft((p) => ({ ...p, consultation_mode: e.target.value }))}>
                                        <option value="in_person">Walk-in (In Person)</option>
                                        <option value="video">Video</option>
                                        <option value="both">Both</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Duration (min)</label>
                                    <input type="number" className={inputBase} placeholder={`Default: ${data?.doctor?.slot_duration_minutes ?? 15}`} value={scheduleDraft.slot_duration_minutes} onChange={(e) => setScheduleDraft((p) => ({ ...p, slot_duration_minutes: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buffer Time (min)</label>
                                    <input type="number" className={inputBase} placeholder={`Default: ${data?.doctor?.buffer_time_minutes ?? 0}`} value={scheduleDraft.buffer_time_minutes} onChange={(e) => setScheduleDraft((p) => ({ ...p, buffer_time_minutes: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Max Patients (optional)</label>
                                    <input type="number" className={inputBase} value={scheduleDraft.max_patients} onChange={(e) => setScheduleDraft((p) => ({ ...p, max_patients: e.target.value }))} />
                                </div>
                                <div className="flex items-end">
                                    <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                                        <input type="checkbox" checked={Boolean(scheduleDraft.is_active)} onChange={(e) => setScheduleDraft((p) => ({ ...p, is_active: e.target.checked }))} />
                                        Active
                                    </label>
                                </div>
                            </div>

                            {/* Slot preview */}
                            {scheduleDraft.start_time && scheduleDraft.end_time && (scheduleDraft.slot_duration_minutes || profileDraft.slot_duration_minutes) && (
                                <div className="mt-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Preview</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {generateSlots(
                                            scheduleDraft.start_time,
                                            scheduleDraft.end_time,
                                            Number(scheduleDraft.slot_duration_minutes || profileDraft.slot_duration_minutes)
                                        ).map((slot) => (
                                            <span key={slot} className={`rounded-lg border px-2 py-1 text-xs font-medium ${modeChipClass(scheduleDraft.consultation_mode)}`}>
                                                {fmtTime(slot)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Current schedules grouped by day */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="mb-4 text-lg font-semibold">Current Schedules</h3>
                            {Object.keys(schedulesByDay).length === 0 ? (
                                <p className="text-sm text-slate-400">No schedules yet.</p>
                            ) : (
                                <div className="space-y-4">
                                    {Object.entries(schedulesByDay)
                                        .sort(([a], [b]) => Number(a) - Number(b))
                                        .map(([day, daySchedules]) => {
                                            const slotDur = Number(profileDraft.slot_duration_minutes) || 0;
                                            return (
                                                <div key={day}>
                                                    <div className="mb-2 flex items-center gap-2">
                                                        <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{dayLabel(day)}</span>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {daySchedules.map((s) => {
                                                            const effectiveDur = s.slot_duration_minutes || slotDur;
                                                            const slots = generateSlots(s.start_time, s.end_time, effectiveDur);
                                                            return (
                                                                <div key={s.id} className={`rounded-xl border p-3 ${modeChipClass(s.consultation_mode)}`}>
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <span className="font-semibold text-sm">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</span>
                                                                            <span className="rounded-full border px-2 py-0.5 text-xs font-medium opacity-80">{modeLabel(s.consultation_mode)}</span>
                                                                            {!s.is_active && <span className="text-xs opacity-60">(inactive)</span>}
                                                                        </div>
                                                                        {canRemoveSchedule ? (
                                                                            <button type="button" onClick={() => removeSchedule(s.id)} className="rounded-lg border border-current px-2 py-1 text-xs opacity-60 hover:opacity-100">Remove</button>
                                                                        ) : null}
                                                                    </div>
                                                                    {slots.length > 0 && (
                                                                        <div className="mt-2 flex flex-wrap gap-1">
                                                                            {slots.map((slot) => (
                                                                                <span key={slot} className="rounded border border-current bg-white/40 px-1.5 py-0.5 text-xs">{fmtTime(slot)}</span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── RIGHT: Exceptions ── */}
                    <div className="space-y-3">
                        {/* Add exception form */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-lg font-semibold">Add Exception</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">One-off overrides: leave, block or special hours</p>
                                </div>
                                {canAddSchedule ? (
                                    <button
                                        type="button"
                                        onClick={addException}
                                        disabled={exceptionSaving}
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                    >
                                        {exceptionSaving ? 'Saving…' : 'Add'}
                                    </button>
                                ) : null}
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
                                    <input type="date" className={inputBase} value={exceptionDraft.exception_date} onChange={(e) => setExceptionDraft((p) => ({ ...p, exception_date: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</label>
                                    <select className={inputBase} value={exceptionDraft.type} onChange={(e) => setExceptionDraft((p) => ({ ...p, type: e.target.value }))}>
                                        <option value="leave">Leave (Full Day Off)</option>
                                        <option value="blocked">Blocked</option>
                                        <option value="special_hours">Special Hours</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason (optional)</label>
                                    <input className={inputBase} value={exceptionDraft.reason} onChange={(e) => setExceptionDraft((p) => ({ ...p, reason: e.target.value }))} placeholder="e.g. Public holiday" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Start Time <span className="font-normal normal-case text-slate-400">(partial day)</span>
                                    </label>
                                    <input type="time" className={inputBase} value={exceptionDraft.start_time} onChange={(e) => setExceptionDraft((p) => ({ ...p, start_time: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        End Time <span className="font-normal normal-case text-slate-400">(partial day)</span>
                                    </label>
                                    <input type="time" className={inputBase} value={exceptionDraft.end_time} onChange={(e) => setExceptionDraft((p) => ({ ...p, end_time: e.target.value }))} />
                                </div>
                            </div>
                        </div>

                        {/* Current exceptions */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 className="mb-4 text-lg font-semibold">Current Exceptions</h3>
                            {!(data?.doctor?.exceptions || []).length ? (
                                <p className="text-sm text-slate-400">No exceptions.</p>
                            ) : (
                                <div className="space-y-2">
                                    {(data.doctor.exceptions).map((ex) => {
                                        const typeColors = {
                                            leave: 'border-red-200 bg-red-50 text-red-800',
                                            blocked: 'border-orange-200 bg-orange-50 text-orange-800',
                                            special_hours: 'border-blue-200 bg-blue-50 text-blue-800',
                                        };
                                        const typeLabel = {
                                            leave: 'Leave',
                                            blocked: 'Blocked',
                                            special_hours: 'Special Hours',
                                        };
                                        return (
                                            <div key={ex.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${typeColors[ex.type] || 'border-slate-200 bg-slate-50 text-slate-800'}`}>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <div>
                                                        <span className="font-semibold text-sm">{String(ex.exception_date).slice(0, 10)}</span>
                                                        <span className="ml-2 rounded-full border border-current bg-white/50 px-2 py-0.5 text-xs font-medium">{typeLabel[ex.type] || ex.type}</span>
                                                    </div>
                                                    {ex.start_time && ex.end_time && (
                                                        <span className="text-xs">
                                                            {fmtTime(ex.start_time)} – {fmtTime(ex.end_time)}
                                                        </span>
                                                    )}
                                                    {ex.reason && <span className="text-xs italic opacity-70">"{ex.reason}"</span>}
                                                </div>
                                                {canRemoveSchedule ? (
                                                    <button type="button" onClick={() => removeException(ex.id)} className="rounded-lg border border-current px-2.5 py-1 text-xs opacity-60 hover:opacity-100">Remove</button>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            )}

            {/* ── Calendar Tab ── */}
            {tab === 'calendar' && (
                <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold">Calendar</h3>
                                <p className="mt-0.5 text-sm text-slate-500">Click an available slot to book · click an appointment to view detail · click empty space to add a schedule or exception.</p>
                            </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</label>
                                <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                                    {toYmd(calendarRangeStart)} → {toYmd(addDays(calendarRangeStart, calendarVisibleDays - 1))}
                                </div>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Step</label>
                                <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                                    {effectiveSlotStep} min
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 text-xs text-slate-500">
                            Future limit: {calendarMaxAdvanceDays} days (max date: {toYmd(maxAllowedDate)})
                        </div>

{calendarError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{calendarError}</div> : null}

                        {(() => {
                            const pxPerMin = 1.5;
                            const { viewStartMin, viewEndMin } = calendarViewHours;

                            const heightPx = (viewEndMin - viewStartMin) * pxPerMin;
                            const tickStep = 30;
                            const ticks = [];
                            for (let m = viewStartMin; m < viewEndMin; m += tickStep) ticks.push(m);
                            const hours = [];
                            for (let m = Math.ceil(viewStartMin / 60) * 60; m < viewEndMin; m += 60) hours.push(m);

                            const gridCols = `${CALENDAR_TIME_COL_WIDTH}px repeat(${calendarDays.length}, ${CALENDAR_DAY_COL_WIDTH}px)`;
                            const todayYmd = toYmd(calendarToday);
                            const nowDate = new Date();
                            const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

                            return (
                                <>
                                {/* Legend */}
                                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Legend</span>
                                    {[
                                        { cls: 'bg-indigo-50 border border-indigo-300', label: 'Scheduled hours' },
                                        { cls: 'bg-purple-50 border border-purple-300', label: 'Special hours' },
                                        { cls: 'bg-emerald-100 border border-emerald-200', label: 'Available slot' },
                                        { cls: 'bg-slate-100 border border-slate-200', label: 'Booked slot' },
                                        { cls: 'bg-rose-100 border border-rose-300', label: 'Leave' },
                                        { cls: 'bg-orange-100 border border-orange-300', label: 'Blocked' },
                                        { cls: 'bg-slate-900', label: 'Appointment' },
                                        { cls: 'bg-indigo-600', label: 'Checked in' },
                                        { cls: 'bg-emerald-600', label: 'Completed' },
                                        { cls: 'bg-violet-600', label: 'In consultation' },
                                    ].map(({ cls, label }) => (
                                        <div key={label} className="flex items-center gap-1.5">
                                            <span className={`inline-block h-3 w-5 flex-shrink-0 rounded ${cls}`} />
                                            <span>{label}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
                                    <div ref={calendarScrollRef} onScroll={handleCalendarScroll} className="max-h-[72vh] overflow-auto bg-white">
                                        {/* Single unified grid — header cells in row 1, body cells in row 2.
                                            Keeping header and body in ONE grid means sticky top-0 header cells
                                            have the full grid height as their containing block, so they stay
                                            pinned while scrolling vertically through the body. */}
                                        <div className="w-max">
                                        <div className="grid" style={{ gridTemplateColumns: gridCols }}>

                                            {/* ── Row 1: header cells ── */}
                                            <div className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Time</div>
                                            {calendarDays.map((d) => {
                                                const ymd = d.ymd;
                                                const availSlots = calendarAvailSlotCountByDate[ymd] || 0;
                                                const apptCount = (calendarApptsByDate[ymd] || []).length;
                                                const ex = calendarExceptionsByDate[ymd] || [];
                                                const hasLeave = ex.some((e) => e.type === 'leave');
                                                const hasFullBlocked = ex.some((e) => e.type === 'blocked' && !e.start_time && !e.end_time);
                                                const hasSpecialHours = ex.some((e) => e.type === 'special_hours');
                                                const isToday = ymd === todayYmd;
                                                return (
                                                    <div key={`hdr-${ymd}`} className={`sticky top-0 z-20 border-b border-l border-slate-200 px-3 py-2 ${isToday ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                                                        <div className={`text-sm font-semibold ${isToday ? 'text-indigo-700' : 'text-slate-900'}`}>
                                                            {DAY_NAMES[d.date.getDay()]}
                                                            {isToday && <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-indigo-400">Today</span>}
                                                            <span className="ml-1 font-normal text-slate-500">{ymd}</span>
                                                        </div>
                                                        <div className="mt-0.5 text-xs">
                                                            {hasLeave ? (
                                                                <span className="font-medium text-rose-600">Leave</span>
                                                            ) : hasFullBlocked ? (
                                                                <span className="font-medium text-orange-600">Blocked</span>
                                                            ) : hasSpecialHours ? (
                                                                <span className="font-medium text-purple-600">Special hours</span>
                                                            ) : (
                                                                <span className="text-slate-500">{apptCount} appt · {availSlots} slots</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* ── Row 2: body cells ── */}
                                                {/* Time axis */}
                                                <div className="sticky left-0 z-20 relative border-r border-slate-200 bg-white" style={{ height: `${heightPx}px` }}>
                                                    {hours.map((m) => (
                                                        <div
                                                            key={m}
                                                            className="absolute left-0 right-0 px-3 text-xs font-semibold text-slate-500"
                                                            style={{ top: `${(m - viewStartMin) * pxPerMin}px` }}
                                                        >
                                                            {fmtTime(fmtMinToTime(m))}
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Day columns */}
                                                {calendarDays.map((d) => {
                                                    const ymd = d.ymd;
                                                    const isToday = ymd === todayYmd;
                                                    const ex = calendarExceptionsByDate[ymd] || [];
                                                    const fullDayLeave = ex.some((e) => e.type === 'leave');
                                                    const fullDayBlocked = ex.some((e) => e.type === 'blocked' && !e.start_time && !e.end_time);
                                                    const hasSpecialHours = ex.some((e) => e.type === 'special_hours' && e.start_time && e.end_time);
                                                    const blockedRanges = ex
                                                        .filter((e) => e.type === 'blocked' && e.start_time && e.end_time)
                                                        .map((e) => ({
                                                            startMin: parseTimeToMin(String(e.start_time).slice(0, 5)),
                                                            endMin: parseTimeToMin(String(e.end_time).slice(0, 5)),
                                                            reason: e.reason,
                                                        }))
                                                        .filter((r) => r.startMin != null && r.endMin != null && r.endMin > r.startMin);

                                                    const scheduleWindows = (calendarScheduleWindowsByDate[ymd] || [])
                                                        .map((w) => ({
                                                            startMin: parseTimeToMin(w.start_time),
                                                            endMin: parseTimeToMin(w.end_time),
                                                        }))
                                                        .filter((w) => w.startMin != null && w.endMin != null && w.endMin > w.startMin);

                                                    const availRanges = calendarAvailRangesEffectiveByDate[ymd] || [];
                                                    const dayAppts = calendarApptsByDate[ymd] || [];
                                                    const { items: apptsPlaced, lanes } = layoutOverlapping(
                                                        dayAppts.map((a) => ({
                                                            ...a,
                                                            title: a?.raw?.patient?.full_name || a?.raw?.patient?.phone || `Appt #${a.id}`,
                                                            status: a?.raw?.status,
                                                            startTime: String(a?.raw?.start_time || '').slice(0, 5),
                                                            endTime: String(a?.raw?.end_time || '').slice(0, 5),
                                                        }))
                                                    );

                                                    const slotBlocks = [];
                                                    if (!fullDayLeave && !fullDayBlocked && availRanges.length) {
                                                        for (const r of availRanges) {
                                                            for (let m = r.startMin; m + effectiveSlotStep <= r.endMin; m += effectiveSlotStep) {
                                                                slotBlocks.push(m);
                                                            }
                                                        }
                                                    }

                                                    const handleColumnClick = (e) => {
                                                        if (fullDayLeave || fullDayBlocked) return;
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        const relY = e.clientY - rect.top;
                                                        const clickedMin = viewStartMin + relY / pxPerMin;
                                                        const snapped = Math.round(clickedMin / effectiveSlotStep) * effectiveSlotStep;
                                                        const safeMin = Math.max(0, Math.min(23 * 60, snapped));
                                                        const endMin = Math.min(24 * 60, safeMin + 60);
                                                        const clickedTime = fmtMinToTime(safeMin);

                                                        if (!scheduleWindows.length) {
                                                            setScheduleDraft((p) => ({
                                                                ...p,
                                                                day_of_week: String(d.dow),
                                                                start_time: clickedTime,
                                                                end_time: fmtMinToTime(endMin),
                                                            }));
                                                            setAvailSheet({ open: true, mode: 'schedule' });
                                                        } else {
                                                            setExceptionDraft((p) => ({
                                                                ...p,
                                                                exception_date: ymd,
                                                                start_time: clickedTime,
                                                                end_time: fmtMinToTime(endMin),
                                                                type: 'blocked',
                                                            }));
                                                            setAvailSheet({ open: true, mode: 'exception' });
                                                        }
                                                    };

                                                    return (
                                                        <div key={ymd} onClick={handleColumnClick} className={`relative border-l border-slate-200 ${isToday ? 'bg-indigo-50/20' : 'bg-white'} ${!fullDayLeave && !fullDayBlocked ? 'cursor-pointer' : ''}`} style={{ height: `${heightPx}px` }}>
                                                            {/* Grid lines */}
                                                            {ticks.map((m) => (
                                                                <div
                                                                    key={m}
                                                                    className={`absolute left-0 right-0 border-t ${m % 60 === 0 ? 'border-slate-200' : 'border-slate-100'}`}
                                                                    style={{ top: `${(m - viewStartMin) * pxPerMin}px` }}
                                                                />
                                                            ))}

                                                            {/* Now-line (today only) */}
                                                            {isToday && nowMin >= viewStartMin && nowMin < viewEndMin && (
                                                                <div
                                                                    className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-red-400"
                                                                    style={{ top: `${(nowMin - viewStartMin) * pxPerMin}px` }}
                                                                >
                                                                    <div className="absolute -top-1 left-0.5 h-2 w-2 rounded-full bg-red-400" />
                                                                </div>
                                                            )}

                                                            {/* Schedule window bands (base scheduled hours) */}
                                                            {!fullDayLeave && !fullDayBlocked && scheduleWindows.map((w, idx) => {
                                                                const cs = Math.max(w.startMin, viewStartMin);
                                                                const ce = Math.min(w.endMin, viewEndMin);
                                                                if (ce <= cs) return null;
                                                                return (
                                                                    <div
                                                                        key={`${ymd}-sched-${idx}`}
                                                                        className={`pointer-events-none absolute left-0 right-0 border-l-2 ${hasSpecialHours ? 'bg-purple-50 border-l-purple-400' : 'bg-indigo-50 border-l-indigo-300'}`}
                                                                        style={{ top: `${(cs - viewStartMin) * pxPerMin}px`, height: `${Math.max(4, (ce - cs) * pxPerMin)}px` }}
                                                                    />
                                                                );
                                                            })}

                                                            {/* Effective availability bands */}
                                                            {!fullDayLeave && !fullDayBlocked && availRanges.map((r, idx) => {
                                                                const cs = Math.max(r.startMin, viewStartMin);
                                                                const ce = Math.min(r.endMin, viewEndMin);
                                                                if (ce <= cs) return null;
                                                                return (
                                                                    <div
                                                                        key={`${ymd}-avail-${idx}`}
                                                                        className="pointer-events-none absolute left-2 right-2 rounded-lg bg-emerald-50"
                                                                        style={{ top: `${(cs - viewStartMin) * pxPerMin}px`, height: `${Math.max(4, (ce - cs) * pxPerMin)}px` }}
                                                                    />
                                                                );
                                                            })}

                                                            {/* Slot blocks (selectable / booked) */}
                                                            {!fullDayLeave && !fullDayBlocked && slotBlocks.map((m) => {
                                                                if (m >= viewEndMin || m + effectiveSlotStep <= viewStartMin) return null;
                                                                const top = (m - viewStartMin) * pxPerMin;
                                                                const h = Math.max(8, effectiveSlotStep * pxPerMin);
                                                                const time = fmtMinToTime(m);
                                                                const slotEndMin = m + effectiveSlotStep;
                                                                // A slot is booked if ANY active appointment overlaps [m, slotEndMin).
                                                                // Overlap check is required because appointment start_time may not align
                                                                // exactly with the slot grid (e.g. appt at 10:20 overlaps slot 10:15–10:30).
                                                                const isBooked = dayAppts.some((a) => a.startMin < slotEndMin && a.endMin > m);
                                                                const cls = isBooked
                                                                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                                                    : 'bg-emerald-100/80 border-emerald-300 hover:bg-emerald-200 text-emerald-900 cursor-pointer';
                                                                return (
                                                                    <button
                                                                        key={`${ymd}-slot-${m}`}
                                                                        type="button"
                                                                        disabled={isBooked}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (isBooked) return;
                                                                            setApptConfirm({ open: true, date: ymd, time, endTime: fmtMinToTime(m + effectiveSlotStep) });
                                                                        }}
                                                                        className={`absolute z-10 left-2 right-2 overflow-hidden rounded border ${cls}`}
                                                                        style={{ top: `${top}px`, height: `${Math.max(10, h - 1)}px` }}
                                                                        title={isBooked ? `Booked · ${fmtTime(time)}` : `Available · ${fmtTime(time)}`}
                                                                    >
                                                                        {h >= 16 && (
                                                                            <span className="absolute left-1 top-0.5 text-[10px] font-medium leading-none">
                                                                                {fmtTime(time)}
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                );
                                                            })}

                                                            {/* Full-day leave overlay */}
                                                            {fullDayLeave && (
                                                                <div className="absolute inset-0 bg-rose-50/90">
                                                                    <div className="sticky top-2 mx-2 mt-2 rounded-lg border border-rose-200 bg-rose-100 px-2 py-1.5 text-xs font-semibold text-rose-700">
                                                                        Leave
                                                                        {(() => { const r = ex.find((e) => e.type === 'leave' && e.reason); return r ? <span className="ml-1 font-normal italic opacity-80">— {r.reason}</span> : null; })()}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Full-day blocked overlay */}
                                                            {!fullDayLeave && fullDayBlocked && (
                                                                <div className="absolute inset-0 bg-orange-50/90">
                                                                    <div className="sticky top-2 mx-2 mt-2 rounded-lg border border-orange-200 bg-orange-100 px-2 py-1.5 text-xs font-semibold text-orange-700">
                                                                        Blocked
                                                                        {(() => { const r = ex.find((e) => e.type === 'blocked' && !e.start_time && e.reason); return r ? <span className="ml-1 font-normal italic opacity-80">— {r.reason}</span> : null; })()}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Partial blocked time ranges */}
                                                            {!fullDayLeave && !fullDayBlocked && blockedRanges.map((r, idx) => {
                                                                const cs = Math.max(r.startMin, viewStartMin);
                                                                const ce = Math.min(r.endMin, viewEndMin);
                                                                if (ce <= cs) return null;
                                                                const h = Math.max(10, (ce - cs) * pxPerMin);
                                                                return (
                                                                    <div
                                                                        key={`${ymd}-block-${idx}`}
                                                                        className="absolute z-10 left-1 right-1 overflow-hidden rounded-lg border border-orange-200 bg-orange-100/90 px-2 py-1 text-[11px] font-semibold text-orange-800"
                                                                        style={{ top: `${(cs - viewStartMin) * pxPerMin}px`, height: `${h}px` }}
                                                                    >
                                                                        <div className="truncate">Blocked{r.reason ? `: ${r.reason}` : ''}</div>
                                                                        {h >= 30 && (
                                                                            <div className="text-[10px] font-normal opacity-75">
                                                                                {fmtTime(fmtMinToTime(r.startMin))}–{fmtTime(fmtMinToTime(r.endMin))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}

                                                            {/* Appointment blocks */}
                                                            {!fullDayLeave && apptsPlaced.map((a) => {
                                                                const cs = Math.max(a.startMin, viewStartMin);
                                                                const ce = Math.min(a.endMin, viewEndMin);
                                                                if (ce <= cs) return null;
                                                                const top = (cs - viewStartMin) * pxPerMin;
                                                                const h = Math.max(18, (ce - cs) * pxPerMin);
                                                                const leftPct = (a.lane * (100 / lanes));
                                                                const widthPct = (100 / lanes);
                                                                const status = String(a.status || '').toLowerCase();
                                                                const statusClass =
                                                                    status === 'completed' ? 'bg-emerald-600' :
                                                                    status === 'checked_in' ? 'bg-indigo-600' :
                                                                    status === 'in_consultation' ? 'bg-violet-600' :
                                                                    status === 'cancelled' ? 'bg-slate-400' :
                                                                    status === 'no_show' ? 'bg-rose-400' :
                                                                    'bg-slate-900';
                                                                return (
                                                                    <div
                                                                        key={`${ymd}-appt-${a.id}`}
                                                                        role="button"
                                                                        tabIndex={0}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            navigate(`/workflows/appointments/${a.id}`);
                                                                        }}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                                e.stopPropagation();
                                                                                navigate(`/workflows/appointments/${a.id}`);
                                                                            }
                                                                        }}
                                                                        className={`absolute z-20 cursor-pointer overflow-hidden rounded-lg px-2 py-1 text-[11px] font-semibold text-white shadow-sm hover:brightness-110 ${statusClass}`}
                                                                        style={{
                                                                            top: `${top}px`,
                                                                            height: `${h}px`,
                                                                            left: `calc(${leftPct}% + 4px)`,
                                                                            width: `calc(${widthPct}% - 8px)`,
                                                                        }}
                                                                        title={`${a.title} · ${a.status} (${a.startTime}${a.endTime ? `–${a.endTime}` : ''})`}
                                                                    >
                                                                        <div className="truncate">{a.title}</div>
                                                                        {h >= 28 && (
                                                                            <div className="mt-0.5 text-[10px] font-medium opacity-90">
                                                                                {fmtTime(a.startTime)}{a.endTime ? `–${fmtTime(a.endTime)}` : ''}
                                                                            </div>
                                                                        )}
                                                                        {h >= 42 && a.status && (
                                                                            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-75">
                                                                                {String(a.status).replace(/_/g, ' ')}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}

                                                            {calendarLoading && (
                                                                <div className="absolute inset-0 bg-white/60" />
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

        {/* ── Availability Side Sheet (opened by clicking empty calendar column) ── */}
        {availSheet.open && (
            <>
                {/* Backdrop */}
                <div
                    className="fixed inset-0 z-40 bg-black/30"
                    onClick={() => setAvailSheet({ open: false, mode: 'schedule' })}
                />
                {/* Panel */}
                <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                        <div>
                            <h2 className="text-base font-semibold">
                                {availSheet.mode === 'schedule' ? 'Add Schedule' : 'Add Exception'}
                            </h2>
                            <p className="mt-0.5 text-xs text-slate-500">
                                {availSheet.mode === 'schedule'
                                    ? 'Recurring weekly working hours'
                                    : 'One-off override: leave, block or special hours'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setAvailSheet({ open: false, mode: 'schedule' })}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-4">
                        {availSheet.mode === 'schedule' ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Day</label>
                                    <select className={inputBase} value={scheduleDraft.day_of_week} onChange={(e) => setScheduleDraft((p) => ({ ...p, day_of_week: e.target.value }))}>
                                        {DAY_NAMES.map((name, i) => <option key={i} value={String(i)}>{name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Start Time</label>
                                    <input type="time" className={inputBase} value={scheduleDraft.start_time} onChange={(e) => setScheduleDraft((p) => ({ ...p, start_time: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">End Time</label>
                                    <input type="time" className={inputBase} value={scheduleDraft.end_time} onChange={(e) => setScheduleDraft((p) => ({ ...p, end_time: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</label>
                                    <select className={inputBase} value={scheduleDraft.consultation_mode} onChange={(e) => setScheduleDraft((p) => ({ ...p, consultation_mode: e.target.value }))}>
                                        <option value="in_person">Walk-in (In Person)</option>
                                        <option value="video">Video</option>
                                        <option value="both">Both</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Duration (min)</label>
                                    <input type="number" className={inputBase} placeholder={`Default: ${data?.doctor?.slot_duration_minutes ?? 15}`} value={scheduleDraft.slot_duration_minutes} onChange={(e) => setScheduleDraft((p) => ({ ...p, slot_duration_minutes: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buffer Time (min)</label>
                                    <input type="number" className={inputBase} placeholder={`Default: ${data?.doctor?.buffer_time_minutes ?? 0}`} value={scheduleDraft.buffer_time_minutes} onChange={(e) => setScheduleDraft((p) => ({ ...p, buffer_time_minutes: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Max Patients (optional)</label>
                                    <input type="number" className={inputBase} value={scheduleDraft.max_patients} onChange={(e) => setScheduleDraft((p) => ({ ...p, max_patients: e.target.value }))} />
                                </div>
                                <div className="flex items-end sm:col-span-2">
                                    <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                                        <input type="checkbox" checked={Boolean(scheduleDraft.is_active)} onChange={(e) => setScheduleDraft((p) => ({ ...p, is_active: e.target.checked }))} />
                                        Active
                                    </label>
                                </div>
                                {/* Slot preview */}
                                {scheduleDraft.start_time && scheduleDraft.end_time && (scheduleDraft.slot_duration_minutes || profileDraft.slot_duration_minutes) && (
                                    <div className="sm:col-span-2">
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Preview</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {generateSlots(
                                                scheduleDraft.start_time,
                                                scheduleDraft.end_time,
                                                Number(scheduleDraft.slot_duration_minutes || profileDraft.slot_duration_minutes)
                                            ).map((slot) => (
                                                <span key={slot} className={`rounded-lg border px-2 py-1 text-xs font-medium ${modeChipClass(scheduleDraft.consultation_mode)}`}>
                                                    {fmtTime(slot)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
                                    <input type="date" className={inputBase} value={exceptionDraft.exception_date} onChange={(e) => setExceptionDraft((p) => ({ ...p, exception_date: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</label>
                                    <select className={inputBase} value={exceptionDraft.type} onChange={(e) => setExceptionDraft((p) => ({ ...p, type: e.target.value }))}>
                                        <option value="leave">Leave (Full Day Off)</option>
                                        <option value="blocked">Blocked</option>
                                        <option value="special_hours">Special Hours</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason (optional)</label>
                                    <input className={inputBase} value={exceptionDraft.reason} onChange={(e) => setExceptionDraft((p) => ({ ...p, reason: e.target.value }))} placeholder="e.g. Public holiday" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Start Time <span className="font-normal normal-case text-slate-400">(partial day)</span>
                                    </label>
                                    <input type="time" className={inputBase} value={exceptionDraft.start_time} onChange={(e) => setExceptionDraft((p) => ({ ...p, start_time: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        End Time <span className="font-normal normal-case text-slate-400">(partial day)</span>
                                    </label>
                                    <input type="time" className={inputBase} value={exceptionDraft.end_time} onChange={(e) => setExceptionDraft((p) => ({ ...p, end_time: e.target.value }))} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-slate-200 px-5 py-4">
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setAvailSheet({ open: false, mode: 'schedule' })}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            {canAddSchedule ? (
                                <button
                                    type="button"
                                    disabled={availSheet.mode === 'schedule' ? scheduleSaving : exceptionSaving}
                                    onClick={async () => {
                                        if (availSheet.mode === 'schedule') {
                                            await addSchedule();
                                        } else {
                                            await addException();
                                        }
                                        setAvailSheet({ open: false, mode: 'schedule' });
                                    }}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                    {(availSheet.mode === 'schedule' ? scheduleSaving : exceptionSaving) ? 'Saving…' : 'Save'}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            </>
        )}

        {/* ── Appointment Confirm Dialog (opened by clicking available slot) ── */}
        {apptConfirm.open && (
            <>
                {/* Backdrop */}
                <div
                    className="fixed inset-0 z-40 bg-black/40"
                    onClick={() => setApptConfirm({ open: false, date: '', time: '', endTime: '' })}
                />
                {/* Dialog */}
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
                        <div className="px-6 pt-6 pb-2">
                            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                                <svg className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <h2 className="text-base font-semibold text-slate-900">Create Appointment?</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                Book a new appointment for the selected slot:
                            </p>
                            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                                <p className="text-sm font-semibold text-emerald-900">
                                    {(() => {
                                        try {
                                            const [y, m, d] = apptConfirm.date.split('-').map(Number);
                                            const dt = new Date(y, m - 1, d);
                                            return dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                                        } catch { return apptConfirm.date; }
                                    })()}
                                </p>
                                <p className="mt-0.5 text-sm text-emerald-700">
                                    {fmtTime(apptConfirm.time)}{apptConfirm.endTime ? ` – ${fmtTime(apptConfirm.endTime)}` : ''}
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setApptConfirm({ open: false, date: '', time: '', endTime: '' })}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const params = new URLSearchParams({
                                        doctor_id: String(id),
                                        date: apptConfirm.date,
                                        time: apptConfirm.time,
                                    });
                                    setApptConfirm({ open: false, date: '', time: '', endTime: '' });
                                    navigate(`/workflows/appointments?${params.toString()}`);
                                }}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                            >
                                Create Appointment
                            </button>
                        </div>
                    </div>
                </div>
            </>
        )}

        </div>
    );
}

export default function DoctorSetupFlowPage() {
    const { id } = useParams();
    const { context, roleKind } = useScope() || {};

    if (roleKind === 'doctor' && context?.active_doctor_id && String(context.active_doctor_id) !== String(id)) {
        return <Navigate to="/workflows/my-profile" replace />;
    }

    return <DoctorSetupFlowPageInner />;
}
