import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';

function prettyDate(ymd) {
    try {
        if (!ymd) return '—';
        const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
        return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).format(d);
    } catch {
        return String(ymd || '—');
    }
}

export default function PrescriptionPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const scope = useScope();
    const canPrescribe = Boolean(scope?.can?.('appointments.prescribe'));
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [appointment, setAppointment] = useState(null);
    const [prescription, setPrescription] = useState(null);

    const recorderRef = useRef(null);
    const streamRef = useRef(null);
    const chunksRef = useRef([]);

    const [voice, setVoice] = useState({
        open: false,
        phase: 'idle',
        error: '',
    });

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            setLoading(true);
            setError('');
            try {
                const [detailRes, rxRes] = await Promise.all([
                    client.get(`${base}/appointments/${id}/detail`),
                    client.get(`${base}/appointments/${id}/prescription`).catch(() => null),
                ]);

                const appt = detailRes?.data?.data?.appointment || null;
                const rx = rxRes?.data?.data?.prescription || null;

                if (!cancelled) {
                    setAppointment(appt);
                    setPrescription(rx);
                    setVoice((p) => ({ ...p, open: !rx && canPrescribe, error: '' }));
                }
            } catch (e) {
                if (!cancelled) setError(e?.response?.data?.message || e?.message || 'Failed to load appointment');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        if (id) {
            run();
        } else {
            setLoading(false);
            setError('Missing appointment id');
        }
        return () => {
            cancelled = true;
        };
    }, [base, id]);

    const downloadBlob = (data, filename) => {
        try {
            const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            // no-op
        }
    };

    const downloadPrescriptionPdf = async () => {
        if (!id) return;
        setError('');
        try {
            const res = await client.get(`${base}/appointments/${id}/prescription.pdf`, { responseType: 'blob' });
            downloadBlob(res.data, `prescription-${id}.pdf`);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to download PDF');
        }
    };

    useEffect(() => {
        return () => {
            try {
                recorderRef.current?.stop?.();
            } catch {
                // ignore
            }
            try {
                streamRef.current?.getTracks?.().forEach((t) => t.stop());
            } catch {
                // ignore
            }
        };
    }, []);

    const rxData = prescription?.data && typeof prescription.data === 'object' ? prescription.data : {};
    const complaints = Array.isArray(rxData?.complaints) ? rxData.complaints : [];
    const diagnosis = String(rxData?.diagnosis || '').trim();
    const medicines = Array.isArray(rxData?.medicines) ? rxData.medicines : [];
    const advice = Array.isArray(rxData?.advice) ? rxData.advice : [];
    const followUp = String(rxData?.follow_up || '').trim();

    const startRecording = async () => {
        setVoice({ open: true, phase: 'requesting', error: '' });
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            chunksRef.current = [];

            const recorder = new MediaRecorder(stream);
            recorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size) chunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
                chunksRef.current = [];
                setVoice((p) => ({ ...p, phase: 'processing', error: '' }));

                try {
                    const fd = new FormData();
                    const mime = String(recorder.mimeType || blob.type || '').toLowerCase();
                    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('wav') ? 'wav' : 'webm';
                    fd.append('audio', blob, `recording.${ext}`);
                    const res = await client.post(`${base}/appointments/${id}/prescription/voice`, fd);
                    const rx = res?.data?.data || null;
                    setPrescription(rx);
                    setVoice({ open: false, phase: 'idle', error: '' });
                } catch (e) {
                    setVoice({ open: true, phase: 'idle', error: e?.response?.data?.message || e?.message || 'Failed to generate prescription' });
                } finally {
                    try {
                        streamRef.current?.getTracks?.().forEach((t) => t.stop());
                    } catch {
                        // ignore
                    }
                    streamRef.current = null;
                    recorderRef.current = null;
                }
            };

            recorder.start();
            setVoice({ open: true, phase: 'recording', error: '' });
        } catch (e) {
            setVoice({ open: true, phase: 'idle', error: e?.message || 'Microphone permission denied' });
        }
    };

    const stopRecording = async () => {
        if (!recorderRef.current) return;
        setVoice((p) => ({ ...p, phase: 'stopping', error: '' }));
        try {
            recorderRef.current.stop();
        } catch (e) {
            setVoice((p) => ({ ...p, phase: 'idle', error: e?.message || 'Failed to stop recording' }));
        }
    };

    const patientName = appointment?.patient?.full_name || (appointment?.patient_id ? `Patient #${appointment.patient_id}` : '—');
    const doctorName = appointment?.doctor?.full_name || (appointment?.doctor_id ? `Doctor #${appointment.doctor_id}` : '—');
    const visitType = appointment?.visit_type
        ? String(appointment.visit_type).replace('_', ' ')
        : '—';

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-6">
            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { background: white !important; }
                    body * { visibility: hidden !important; }
                    #rx-print, #rx-print * { visibility: visible !important; }
                    #rx-print { position: absolute; left: 0; top: 0; width: 100%; }
                    .rx-surface { box-shadow: none !important; border: none !important; }
                }
                @keyframes rxbar { 0%, 100% { transform: scaleY(0.35); opacity: .55; } 50% { transform: scaleY(1); opacity: 1; } }
                @keyframes dots { 0%, 20% { content: '.'; } 40% { content: '..'; } 60% { content: '...'; } 80%, 100% { content: ''; } }
            `}</style>

            <div className="no-print mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <AppIcon name="section" className="h-5 w-5 text-slate-700" />
                    <h1 className="text-lg font-semibold text-slate-900">Prescription</h1>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        to="/workflows/appointments"
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Back
                    </Link>
                            <button
                                type="button"
                                onClick={downloadPrescriptionPdf}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Download PDF
                            </button>
                    <button
                        type="button"
                        onClick={() => window.print()}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                        Print
                    </button>
                    {!prescription && canPrescribe ? (
                        <button
                            type="button"
                            onClick={() => setVoice((p) => ({ ...p, open: true, error: '' }))}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Start Recording
                        </button>
                    ) : null}
                </div>
            </div>

            {loading ? (
                <div className="rx-surface rounded-2xl bg-white p-5 text-sm text-slate-600">Loading…</div>
            ) : error ? (
                <div className="rx-surface rounded-2xl bg-rose-50 p-5 text-sm text-rose-700">{error}</div>
            ) : (
                <div id="rx-print" className="rx-surface rounded-2xl bg-white p-6">
                    <div className="hidden print:block">
                        <div className="text-lg font-semibold text-slate-900">Prescription</div>
                        <div className="mt-2 border-t border-slate-200" />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-sm text-slate-600">Patient</div>
                            <div className="text-xl font-semibold text-slate-900">{patientName}</div>
                            <div className="mt-1 text-sm text-slate-600">Visit: <span className="font-semibold text-slate-900">{visitType}</span></div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-slate-600">Doctor</div>
                            <div className="text-base font-semibold text-slate-900">{doctorName}</div>
                            <div className="mt-1 text-sm text-slate-600">
                                {prettyDate(appointment?.appointment_date)}
                                {appointment?.start_time ? ` • ${String(appointment.start_time).slice(0, 5)}` : ''}
                            </div>
                        </div>
                    </div>

                    <div className="my-5 border-t border-slate-200" />

                    <div className="grid grid-cols-1 gap-5">
                        <section>
                            <div className="text-sm font-semibold text-slate-900">Complaints</div>
                            <div className="mt-2 min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                                {complaints.length ? complaints.map((c, idx) => (
                                    <div key={idx}>• {c}</div>
                                )) : ''}
                            </div>
                        </section>

                        <section>
                            <div className="text-sm font-semibold text-slate-900">Diagnosis</div>
                            <div className="mt-2 min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                                {diagnosis || ''}
                            </div>
                        </section>

                        <section>
                            <div className="text-sm font-semibold text-slate-900">Medicines</div>
                            <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
                                <div className="grid grid-cols-12 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                                    <div className="col-span-6">Medicine</div>
                                    <div className="col-span-3">Dosage</div>
                                    <div className="col-span-3">Duration</div>
                                </div>
                                {(() => {
                                    const rows = medicines.slice(0, 10);
                                    const minRows = 5;
                                    const total = Math.max(minRows, rows.length);
                                    return Array.from({ length: total }).map((_, i) => {
                                        const m = rows[i];
                                        return (
                                            <div key={i} className="grid grid-cols-12 border-t border-slate-200 px-3 py-3 text-sm text-slate-800">
                                                <div className="col-span-6">{m?.name ? String(m.name) : ' '}</div>
                                                <div className="col-span-3">{m?.dosage ? String(m.dosage) : ' '}</div>
                                                <div className="col-span-3">{m?.duration ? String(m.duration) : ' '}</div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </section>

                        <section>
                            <div className="text-sm font-semibold text-slate-900">Advice</div>
                            <div className="mt-2 min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                                {advice.length ? advice.map((a, idx) => (
                                    <div key={idx}>• {a}</div>
                                )) : ''}
                            </div>
                        </section>

                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <div className="text-sm font-semibold text-slate-900">Follow-up</div>
                                <div className="mt-2 min-h-[40px] w-64 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                                    {followUp || ''}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-semibold text-slate-900">Signature</div>
                                <div className="mt-10 w-56 border-t border-slate-300" />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {voice.open ? (
                <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => {
                    if (voice.phase === 'recording' || voice.phase === 'processing' || voice.phase === 'stopping') return;
                    setVoice((p) => ({ ...p, open: false }));
                }}>
                    <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-5 py-4 text-white">
                            <div className="flex items-center gap-2">
                                <AppIcon name="section" className="h-5 w-5" />
                                <h3 className="text-lg font-semibold">Voice Prescription</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (voice.phase === 'recording' || voice.phase === 'processing' || voice.phase === 'stopping') return;
                                    setVoice((p) => ({ ...p, open: false }));
                                }}
                                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            {voice.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {voice.error}
                                </div>
                            ) : null}

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recording</div>
                                <div className="mt-3 flex items-center justify-center gap-2">
                                    {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                                        const active = voice.phase === 'recording' || voice.phase === 'stopping';
                                        return (
                                            <div
                                                key={i}
                                                className={active ? 'h-8 w-1 rounded bg-slate-700/70' : 'h-2 w-1 rounded bg-slate-400/60'}
                                                style={active ? { animation: `rxbar 0.9s ${i * 0.08}s infinite ease-in-out`, transformOrigin: 'center' } : undefined}
                                            />
                                        );
                                    })}
                                </div>

                                {voice.phase === 'processing' ? (
                                    <div className="mt-3 text-center text-sm text-slate-700">
                                        Processing audio…
                                    </div>
                                ) : voice.phase === 'requesting' ? (
                                    <div className="mt-3 text-center text-sm text-slate-700">Requesting microphone…</div>
                                ) : null}
                            </div>

                            <div className="flex items-center justify-center gap-2">
                                {voice.phase === 'recording' ? (
                                    <button
                                        type="button"
                                        onClick={stopRecording}
                                        className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                                    >
                                        Stop Recording
                                    </button>
                                ) : voice.phase === 'processing' || voice.phase === 'stopping' ? (
                                    <button
                                        type="button"
                                        disabled
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white opacity-60"
                                    >
                                        Processing…
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={startRecording}
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                    >
                                        Start Recording
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
