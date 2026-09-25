<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Models\SubscriptionTransaction;
use Illuminate\Http\Request;

class SubscriptionTransactionController
{
    public function index(Request $request)
    {
        $query = SubscriptionTransaction::query()
            ->when($request->filled('clinic_id'), fn ($q) => $q->where('clinic_id', (int) $request->input('clinic_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->input('status')))
            ->when($request->filled('source'), fn ($q) => $q->where('source', $request->input('source')))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('created_at', '>=', $request->input('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('created_at', '<=', $request->input('to')));

        $total = (clone $query)->where('status', 'captured')->sum('amount');
        $rows = $query->with(['clinic:id,name', 'plan:id,name'])->latest()->paginate(25);

        return response()->json([
            'success' => true,
            'message' => 'Transactions fetched',
            'data' => $rows,
            'meta' => ['total_captured' => (int) $total],
        ]);
    }
}
