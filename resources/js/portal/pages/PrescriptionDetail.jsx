import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { formatDate } from '../lib/format';
import { Button, Card, CardTitle, ErrorText, Loading, PageHeader } from '../components/ui';
import { DownloadIcon } from '../components/icons';

/**
 * `GET prescriptions/{id}`: the same `data` fields the clinic's PDF
 * (resources/views/reports/prescription.blade.php) renders — complaints,
 * diagnosis, medicines, advice, follow-up — plus a PDF download (fetched as
 * a blob so the bearer token can be attached; the browser can't do that on
 * a plain `<a href>`) and a "Book follow-up" shortcut, which needs the
 * visit's doctor — not returned by this endpoint — so it's resolved via one
 * extra `GET appointments/{appointment_id}` call before navigating.
 */
export default function PrescriptionDetail() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [rx, setRx] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState('');

    const [followUpLoading, setFollowUpLoading] = useState(false);
    const [followUpError, setFollowUpError] = useState('');

    useEffect(() => {
        let active = true;
        api.get(`/prescriptions/${id}`)
            .then(({ data }) => {
                if (active) setRx(data.data);
            })
            .catch((err) => {
                if (active) setLoadError(err?.response?.data?.message || 'Could not load this prescription.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [id]);

    async function downloadPdf() {
        setDownloading(true);
        setDownloadError('');
        let url;
        try {
            const response = await api.get(`/prescriptions/${id}/pdf`, { responseType: 'blob' });
            url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `prescription-${id}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            setDownloadError('Could not download the prescription PDF.');
        } finally {
            if (url) window.URL.revokeObjectURL(url);
            setDownloading(false);
        }
    }

    async function bookFollowUp() {
        setFollowUpLoading(true);
        setFollowUpError('');
        try {
            const { data } = await api.get(`/appointments/${rx.appointment_id}`);
            const doctorId = data.data?.doctor?.id;
            navigate(`/book?doctor_id=${doctorId ?? ''}&visit_type=followup`);
        } catch (err) {
            setFollowUpError(err?.response?.data?.message || 'Could not start a follow-up booking.');
        } finally {
            setFollowUpLoading(false);
        }
    }

    if (loading) {
        return <Loading />;
    }

    if (loadError || !rx) {
        return <ErrorText>{loadError || 'Prescription not found.'}</ErrorText>;
    }

    const data = rx.data || {};
    const complaints = Array.isArray(data.complaints) ? data.complaints : [];
    const medicines = Array.isArray(data.medicines) ? data.medicines : [];
    const advice = Array.isArray(data.advice) ? data.advice : [];
    const diagnosis = typeof data.diagnosis === 'string' ? data.diagnosis.trim() : '';
    const followUp = typeof data.follow_up === 'string' ? data.follow_up.trim() : '';

    return (
        <div className="space-y-5">
            <PageHeader title="Prescription" back={{ label: 'Back to prescriptions', onClick: () => navigate('/prescriptions') }} />

            <Card>
                <p className="text-base font-semibold text-slate-900">{formatDate(rx.date)}</p>
                <p className="mt-0.5 text-sm text-slate-600">
                    {rx.doctor?.name}
                    {rx.doctor?.specialization ? ` · ${rx.doctor.specialization}` : ''}
                </p>
                {rx.clinic?.name && <p className="mt-0.5 text-sm text-slate-500">{rx.clinic.name}</p>}
            </Card>

            {complaints.length > 0 && (
                <Card>
                    <CardTitle>Complaints</CardTitle>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 marker:text-slate-400">
                        {complaints.map((c, i) => (
                            <li key={i}>{c}</li>
                        ))}
                    </ul>
                </Card>
            )}

            {diagnosis && (
                <Card>
                    <CardTitle className="mb-1">Diagnosis</CardTitle>
                    <p className="whitespace-pre-line text-sm text-slate-700">{diagnosis}</p>
                </Card>
            )}

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Medicines</h2>
                {medicines.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-600">No medicines.</p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {medicines.map((m, i) => {
                            // Older/legacy rows may carry timing as a
                            // separate `frequency`/`timing` field instead of
                            // folded into dosage (the AI service's current
                            // schema); fold it in here so this list matches
                            // the PDF (resources/views/reports/prescription.blade.php)
                            // and the staff admin viewer's
                            // Medicine/Dosage/Duration layout.
                            const dosage = [m.dosage, m.frequency || m.timing].filter(Boolean).join(' • ');
                            const duration = m.duration || m.days || m.duration_days || '-';
                            return (
                                <li key={i} className="px-4 py-3">
                                    <p className="text-sm font-semibold text-slate-900">{m.name || m.medicine || '-'}</p>
                                    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                                        <dt className="text-slate-500">Dosage</dt>
                                        <dd className="text-slate-700">{dosage || '-'}</dd>
                                        <dt className="text-slate-500">Duration</dt>
                                        <dd className="text-slate-700">{duration}</dd>
                                    </dl>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {advice.length > 0 && (
                <Card>
                    <CardTitle>Advice</CardTitle>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 marker:text-slate-400">
                        {advice.map((a, i) => (
                            <li key={i}>{a}</li>
                        ))}
                    </ul>
                </Card>
            )}

            {followUp && (
                <Card>
                    <CardTitle className="mb-1">Follow-up</CardTitle>
                    <p className="whitespace-pre-line text-sm text-slate-700">{followUp}</p>
                </Card>
            )}

            <div className="space-y-2">
                {downloadError ? <ErrorText>{downloadError}</ErrorText> : null}
                <Button variant="secondary" onClick={downloadPdf} loading={downloading}>
                    {!downloading ? <DownloadIcon className="h-5 w-5" /> : null}
                    Download PDF
                </Button>

                {followUpError ? <ErrorText>{followUpError}</ErrorText> : null}
                <Button variant="ghost" onClick={bookFollowUp} loading={followUpLoading}>
                    Book follow-up
                </Button>
            </div>
        </div>
    );
}
