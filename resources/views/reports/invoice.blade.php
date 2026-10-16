<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title }} {{ $invoiceNumber }}</title>
    <style>
        * { font-family: DejaVu Sans, sans-serif; }
        body { font-size: 12px; color: #0f172a; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        h2 { font-size: 14px; margin: 16px 0 6px; }
        .muted { color: #64748b; }
        .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; }
        th { background: #f8fafc; text-align: left; }
        .num { text-align: right; }
        .totals { width: 50%; margin-left: 50%; margin-top: 10px; }
        .totals td { border: 0; border-bottom: 1px solid #e2e8f0; }
        .strong { font-weight: bold; }
        .footer { margin-top: 24px; font-size: 11px; color: #64748b; }
    </style>
</head>
<body>
    <h1>{{ $title }}</h1>
    <div class="muted">{{ $clinicName }}</div>

    <div class="box">
        <div><strong>{{ $title }} no.:</strong> {{ $invoiceNumber }}</div>
        <div><strong>Date:</strong> {{ $invoiceDate }}</div>
        <div><strong>Patient:</strong> {{ $patientName }}</div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Description</th>
                <th class="num" style="width: 8%">Qty</th>
                <th class="num" style="width: 18%">Unit price</th>
                <th class="num" style="width: 18%">Amount</th>
            </tr>
        </thead>
        <tbody>
            @foreach($items as $item)
                <tr>
                    <td>{{ $item['description'] }}</td>
                    <td class="num">{{ $item['quantity'] }}</td>
                    <td class="num">{{ $item['unit'] }}</td>
                    <td class="num">{{ $item['amount'] }}</td>
                </tr>
            @endforeach
        </tbody>
    </table>

    <table class="totals">
        <tr><td>Subtotal</td><td class="num">{{ $subtotal }}</td></tr>
        @if($discount !== null)
            <tr><td>Discount</td><td class="num">{{ $discount }}</td></tr>
        @endif
        @if($tax !== null)
            <tr><td>Tax</td><td class="num">{{ $tax }}</td></tr>
        @endif
        <tr class="strong"><td>Total</td><td class="num">{{ $total }}</td></tr>
        <tr><td>Paid</td><td class="num">{{ $paid }}</td></tr>
        <tr class="strong"><td>Balance</td><td class="num">{{ $balance }}</td></tr>
    </table>

    @if(count($payments))
        <h2>Payments</h2>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th class="num">Amount</th>
                </tr>
            </thead>
            <tbody>
                @foreach($payments as $payment)
                    <tr>
                        <td>{{ $payment['date'] }}</td>
                        <td>{{ $payment['method'] }}</td>
                        <td>{{ $payment['reference'] ?: '-' }}</td>
                        <td>{{ $payment['status'] }}</td>
                        <td class="num">{{ $payment['amount'] }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif

    @if(filled($notes))
        <h2>Notes</h2>
        <div class="box">{!! nl2br(e($notes)) !!}</div>
    @endif

    @if(filled($footerNote))
        <div class="footer">{!! nl2br(e($footerNote)) !!}</div>
    @endif
</body>
</html>
