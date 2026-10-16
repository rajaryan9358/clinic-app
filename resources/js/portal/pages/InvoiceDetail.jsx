import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Button, Card, ErrorText, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';
import { balanceLine, formatMoney, statusChip } from '../lib/money';
import { loadRazorpay } from '../lib/razorpay';

const NOTICE_TONES = {
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    info: 'bg-slate-50 text-slate-700 ring-slate-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
};

const PAYMENT_STATUS_LABELS = { success: 'Paid', refunded: 'Refunded' };

function paymentTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * `/invoices/:id` — items, totals, payment history, PDF and online payment.
 *
 * Paying: POST pay -> open Razorpay Checkout (script loaded on demand) ->
 * on success POST confirm with the three Razorpay fields. confirm is
 * idempotent and the webhook often settles first, so a 200 showing the
 * invoice as paid is the normal outcome, not an error. A dismissed or failed
 * checkout changes nothing and says so; only a successful confirm (or a
 * reload showing `paid`) ever reports success.
 *
 * `paying` (a ref mirror guards the synchronous double-tap) blocks a second
 * checkout while one is open; `requestRef`/`idRef` drop responses that belong
 * to a previous invoice id or profile.
 */
export default function InvoiceDetail() {
    const { id } = useParams();
    const { activeProfileId } = useSession();

    const [invoice, setInvoice] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const requestRef = useRef(0);
    const scopeRef = useRef('');
    scopeRef.current = `${id}:${activeProfileId}`;

    // In-flight payment stage per invoice scope ('starting' | 'checkout' | 'confirming'), so each
    // invoice's flow owns its own lock and survives navigating away and back.
    const [payingMap, setPayingMap] = useState({});
    const inflightRef = useRef(new Set()); // synchronous double-tap guard, same keys as payingMap
    const paying = payingMap[scopeRef.current] ?? null;
    const setStage = (scope, stage) =>
        setPayingMap((m) => {
            const next = { ...m };
            if (stage) next[scope] = stage;
            else delete next[scope];
            return next;
        });
    const unlock = (scope) => {
        inflightRef.current.delete(scope);
        setStage(scope, null);
    };
    const [notice, setNotice] = useState(null); // { tone, text }
    const [payError, setPayError] = useState('');
    const [payUnavailable, setPayUnavailable] = useState(false);

    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState('');

    const fetchInvoice = useCallback(
        ({ quiet = false } = {}) => {
            const requestId = ++requestRef.current;
            if (!quiet) {
                setLoading(true);
                setLoadError('');
            }
            return api
                .get(`/invoices/${id}`)
                .then(({ data }) => {
                    if (requestRef.current !== requestId) return;
                    setInvoice(data.data);
                    if (data.data?.status === 'paid') {
                        // A paid invoice contradicts any failure or "unchanged" message.
                        setPayError('');
                        setNotice((n) => (n?.tone === 'success' ? n : null));
                    }
                })
                .catch((err) => {
                    if (requestRef.current !== requestId || quiet) return;
                    setInvoice(null);
                    setLoadError(
                        err?.response?.status === 404
                            ? 'We couldn’t find this invoice for the selected profile.'
                            : err?.response?.data?.message || 'Could not load this invoice.',
                    );
                })
                .finally(() => {
                    if (requestRef.current === requestId && !quiet) setLoading(false);
                });
        },
        [id],
    );

    useEffect(() => {
        // New invoice or profile: forget everything about the previous one.
        setInvoice(null);
        setNotice(null);
        setPayError('');
        setPayUnavailable(false);
        setDownloadError('');
        fetchInvoice();
        return () => {
            requestRef.current += 1;
        };
    }, [fetchInvoice, activeProfileId]);

    // True while the page is still showing the invoice/profile a callback started for.
    const stillHere = (scope) => scopeRef.current === scope;

    async function confirmPayment(scope, response) {
        setStage(scope, 'confirming');
        try {
            const { data } = await api.post(`/invoices/${id}/confirm`, {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
            });
            if (!stillHere(scope)) return;
            requestRef.current += 1; // supersede any in-flight refetch with this fresher detail
            setInvoice(data.data);
            setNotice(
                Number(data.data.balance) <= 0
                    ? { tone: 'success', text: 'Payment received. Thank you.' }
                    : { tone: 'success', text: 'Payment recorded.' },
            );
        } catch (err) {
            if (!stillHere(scope)) return;
            if (err?.response?.status === 409) {
                setPayError(err?.response?.data?.message || 'This payment belongs to a different invoice.');
            } else {
                setPayError(
                    'We couldn’t confirm your payment just yet. If money left your account it will appear on this invoice shortly — check again in a few minutes.',
                );
            }
            fetchInvoice({ quiet: true });
        } finally {
            unlock(scope);
        }
    }

    async function pay() {
        const scope = scopeRef.current;
        if (inflightRef.current.has(scope)) return;
        inflightRef.current.add(scope);
        setStage(scope, 'starting');
        setPayError('');
        setNotice(null);

        let order;
        try {
            const { data } = await api.post(`/invoices/${id}/pay`);
            order = data.data;
        } catch (err) {
            unlock(scope);
            if (!stillHere(scope)) return;
            setStage(scope, null);
            const status = err?.response?.status;
            if (status === 404) {
                setPayUnavailable(true);
            } else if (status === 422) {
                setPayError(err?.response?.data?.message || 'The amount due changed. Please try again.');
                fetchInvoice({ quiet: true });
            } else {
                setPayError(err?.response?.data?.message || 'Could not start the payment. Please try again.');
            }
            return;
        }

        let Razorpay;
        try {
            Razorpay = await loadRazorpay();
        } catch {
            unlock(scope);
            if (stillHere(scope)) {
                setStage(scope, null);
                setPayError('Could not load the payment window. Check your connection and try again. Nothing was charged.');
            }
            return;
        }

        if (!stillHere(scope)) {
            unlock(scope);
            return;
        }

        let finished = false; // success handler ran; ignore a late dismiss
        const release = (nextNotice) => {
            unlock(scope);
            if (!stillHere(scope)) return;
            setStage(scope, null);
            if (nextNotice) setNotice(nextNotice);
            fetchInvoice({ quiet: true });
        };

        try {
            const checkout = new Razorpay({
                key: order.key_id,
                order_id: order.order_id,
                amount: Math.round(Number(order.amount) * 100), // rupees -> paise
                currency: order.currency || 'INR',
                name: 'Invoice payment',
                description: order.invoice_number ? `Invoice ${order.invoice_number}` : undefined,
                handler: (response) => {
                    finished = true;
                    confirmPayment(scope, response);
                },
                modal: {
                    ondismiss: () => {
                        if (finished) return;
                        release({
                            tone: 'info',
                            text: 'Payment window closed. This invoice has not changed — no payment was recorded from this attempt.',
                        });
                    },
                },
            });
            checkout.on('payment.failed', () => {
                // Checkout stays open so the patient can retry inside it; just
                // record that the attempt failed. Nothing is marked paid.
                if (finished || !stillHere(scope)) return;
                setNotice({
                    tone: 'warning',
                    text: 'That payment did not go through. This invoice has not changed — you can try again.',
                });
            });
            setStage(scope, 'checkout');
            checkout.open();
        } catch {
            release();
            if (stillHere(scope)) setPayError('Could not open the payment window. Please try again.');
        }
    }

    async function downloadPdf() {
        if (downloading) return;
        setDownloading(true);
        setDownloadError('');
        let url;
        try {
            const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
            url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `invoice-${String(invoice?.invoice_number || id).replace(/[\\/]/g, '-')}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch {
            setDownloadError('Could not download the invoice PDF.');
        } finally {
            if (url) window.URL.revokeObjectURL(url);
            setDownloading(false);
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner className="h-6 w-6 text-[var(--accent)]" />
            </div>
        );
    }

    if (loadError || !invoice) {
        return (
            <div className="space-y-4">
                <ErrorText>{loadError || 'Invoice not found.'}</ErrorText>
                <Link to="/invoices" className="text-sm font-medium text-[var(--accent)]">
                    Back to invoices
                </Link>
            </div>
        );
    }

    const chip = statusChip(invoice);
    const balance = balanceLine(invoice);
    const canPay = invoice.can_pay_online === true && invoice.status !== 'paid' && Number(invoice.balance) > 0 && !payUnavailable;
    const busy = paying !== null;
    const discount = Number(invoice.discount_amount) || 0;
    const tax = Number(invoice.tax_amount) || 0;

    return (
        <div className="space-y-4">
            <Link to="/invoices" className="text-sm font-medium text-[var(--accent)]">
                ← Invoices
            </Link>

            <Card>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-lg font-semibold text-slate-900">
                            {invoice.invoice_number || `Invoice #${invoice.id}`}
                        </h1>
                        <p className="text-sm text-slate-500">
                            {formatDate(invoice.invoice_date)}
                            {invoice.doctor_name ? ` · ${invoice.doctor_name}` : ''}
                        </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${chip.className}`}>
                        {chip.label}
                    </span>
                </div>
            </Card>

            {notice && (
                <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${NOTICE_TONES[notice.tone]}`} role="status" aria-live="polite">
                    {notice.text}
                </div>
            )}
            <ErrorText>{payError}</ErrorText>

            <Card>
                <h2 className="mb-2 text-sm font-medium text-slate-500">Items</h2>
                <ul className="divide-y divide-slate-100">
                    {(invoice.items || []).map((item) => (
                        <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <p className="text-sm text-slate-900">{item.description}</p>
                                {item.quantity > 1 && (
                                    <p className="text-xs text-slate-500">
                                        {item.quantity} × {formatMoney(item.unit_amount)}
                                    </p>
                                )}
                            </div>
                            <p className="shrink-0 text-sm tabular-nums text-slate-900">{formatMoney(item.amount)}</p>
                        </li>
                    ))}
                </ul>

                <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                    <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
                    {discount > 0 && <Row label="Discount" value={`− ${formatMoney(discount)}`} />}
                    {tax > 0 && <Row label="Tax" value={formatMoney(tax)} />}
                    <Row label="Total" value={formatMoney(invoice.total_amount)} strong />
                    <Row label="Paid" value={formatMoney(invoice.amount_paid)} />
                    <Row
                        label={balance.label}
                        value={balance.text}
                        strong
                        valueClass={balance.tone === 'due' ? 'text-amber-700' : balance.tone === 'settled' ? 'text-emerald-700' : 'text-slate-900'}
                    />
                </dl>

                {balance.tone === 'credit' && (
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        You have paid {formatMoney(Math.abs(invoice.balance))} more than this invoice total. The clinic will arrange a refund
                        of the difference.
                    </p>
                )}
            </Card>

            {(invoice.payments || []).length > 0 && (
                <Card>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Payments</h2>
                    <ul className="divide-y divide-slate-100">
                        {invoice.payments.map((p) => (
                            <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-sm capitalize text-slate-900">{p.payment_method}</p>
                                    <p className="text-xs text-slate-500">
                                        {paymentTime(p.paid_at)}
                                        {p.refunded_at ? ` · refunded ${paymentTime(p.refunded_at)}` : ''}
                                    </p>
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="text-sm tabular-nums text-slate-900">{formatMoney(p.amount)}</p>
                                    <p className={`text-xs ${p.status === 'refunded' ? 'text-slate-500' : 'text-emerald-700'}`}>
                                        {PAYMENT_STATUS_LABELS[p.status] || p.status}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <div className="space-y-2">
                {canPay && (
                    <Button onClick={pay} loading={paying === 'starting' || paying === 'confirming'} disabled={busy}>
                        {paying === 'confirming' ? 'Confirming payment…' : `Pay ${formatMoney(invoice.balance)}`}
                    </Button>
                )}
                {payUnavailable && invoice.status !== 'paid' && Number(invoice.balance) > 0 && (
                    <p className="text-sm text-slate-600">Online payment is not available right now. Please pay at the clinic.</p>
                )}
                <Button variant="secondary" onClick={downloadPdf} loading={downloading} disabled={downloading}>
                    Download PDF
                </Button>
                <ErrorText>{downloadError}</ErrorText>
            </div>
        </div>
    );
}

function Row({ label, value, strong = false, valueClass = 'text-slate-900' }) {
    return (
        <div className="flex items-center justify-between">
            <dt className={strong ? 'font-medium text-slate-900' : 'text-slate-600'}>{label}</dt>
            <dd className={`tabular-nums ${strong ? 'font-semibold' : ''} ${valueClass}`}>{value}</dd>
        </div>
    );
}
