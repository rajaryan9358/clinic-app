import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { formatDate } from '../lib/format';
import { Button, Card, ErrorText, Spinner } from '../components/ui';

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
        return (
            <div className="flex justify-center py-12">
                <Spinner className="h-6 w-6 text-[var(--accent)]" />
            </div>
        );
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
        <div className="space-y-4">
            <button
                type="button"
                onClick={() => navigate('/prescriptions')}
                className="text-sm font-medium text-[var(--accent)]"
            >
                &larr; Back to prescriptions
            </button>

            <Card>
                <p className="text-base font-semibold text-slate-900">{formatDate(rx.date)}</p>
                <p className="text-sm text-slate-600">
                    {rx.doctor?.name}
                    {rx.doctor?.specialization ? ` · ${rx.doctor.specialization}` : ''}
                </p>
                {rx.clinic?.name && <p className="text-xs text-slate-500">{rx.clinic.name}</p>}
            </Card>

            {complaints.length > 0 && (
                <Card>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Complaints</h2>
                    <ul className="space-y-1 text-sm text-slate-700">
                        {complaints.map((c, i) => (
                            <li key={i}>&bull; {c}</li>
                        ))}
                    </ul>
                </Card>
            )}

            {diagnosis && (
                <Card>
                    <h2 className="mb-1 text-sm font-medium text-slate-500">Diagnosis</h2>
                    <p className="whitespace-pre-line text-sm text-slate-700">{diagnosis}</p>
                </Card>
            )}

            <Card>
                <h2 className="mb-2 text-sm font-medium text-slate-500">Medicines</h2>
                {medicines.length === 0 ? (
                    <p className="text-sm text-slate-500">No medicines.</p>
                ) : (
                    <div className="-mx-4 overflow-x-auto">
                        <table className="w-full min-w-[480px] text-left text-sm">
                            <thead>
                                <tr className="text-xs text-slate-500">
                                    <th className="px-4 py-1">Medicine</th>
                                    <th className="px-4 py-1">Dosage</th>
                                    <th className="px-4 py-1">Frequency</th>
                                    <th className="px-4 py-1">Days</th>
                                    <th className="px-4 py-1">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {medicines.map((m, i) => (
                                    <tr key={i} className="border-t border-slate-100">
                                        <td className="px-4 py-2 font-medium text-slate-900">{m.name || m.medicine || '-'}</td>
                                        <td className="px-4 py-2 text-slate-600">{m.dosage || '-'}</td>
                                        <td className="px-4 py-2 text-slate-600">{m.frequency || m.timing || '-'}</td>
                                        <td className="px-4 py-2 text-slate-600">{m.days || m.duration_days || '-'}</td>
                                        <td className="px-4 py-2 text-slate-600">{m.notes || m.instructions || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {advice.length > 0 && (
                <Card>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Advice</h2>
                    <ul className="space-y-1 text-sm text-slate-700">
                        {advice.map((a, i) => (
                            <li key={i}>&bull; {a}</li>
                        ))}
                    </ul>
                </Card>
            )}

            {followUp && (
                <Card>
                    <h2 className="mb-1 text-sm font-medium text-slate-500">Follow-up</h2>
                    <p className="whitespace-pre-line text-sm text-slate-700">{followUp}</p>
                </Card>
            )}

            <div className="space-y-2">
                {downloadError ? <ErrorText>{downloadError}</ErrorText> : null}
                <Button variant="secondary" onClick={downloadPdf} loading={downloading}>
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
