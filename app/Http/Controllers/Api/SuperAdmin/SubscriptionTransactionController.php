<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Models\SubscriptionTransaction;
use Illuminate\Http\Request;

class SubscriptionTransactionController
{
    public function index(Request $request)
    {
        $base = SubscriptionTransaction::query()
            ->when($request->filled('clinic_id'), fn ($q) => $q->where('clinic_id', (int) $request->input('clinic_id')))
            ->when($request->filled('source'), fn ($q) => $q->where('source', $request->input('source')))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('created_at', '>=', $request->input('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('created_at', '<=', $request->input('to')));

        $total = (int) (clone $base)->where('status', 'captured')->sum('amount');

        $rows = (clone $base)
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->input('status')))
            ->with(['clinic:id,name', 'plan:id,name'])
            ->latest()
            ->paginate(25);

        return response()->json([
            'success' => true,
            'message' => 'Transactions fetched',
            'data' => $rows,
            'meta' => ['total_captured' => $total],
        ]);
    }
}
