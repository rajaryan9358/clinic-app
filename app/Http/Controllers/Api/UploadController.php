<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\FileUpload;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class UploadController
{
    use ApiResponse;

    public function storeImage(Request $request)
    {
        $isSuperAdmin = (string) ($request->user()?->role ?? '') === 'super_admin';
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->input('clinic_id') ?? 0);
        if (! $clinicId && ! $isSuperAdmin) {
            return $this->error('clinic_id is required', null, 422);
        }

        $data = validator($request->all(), [
            'module' => ['required', 'string', 'max:64'],
            'file' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'visibility' => ['nullable', 'in:private,clinic,patient'],
        ])->validate();

        $module = Str::slug($data['module']);
        $visibility = $data['visibility'] ?? 'clinic';

        /** @var \Illuminate\Http\UploadedFile $file */
        $file = $request->file('file');
        $folder = $clinicId ? "uploads/{$clinicId}/{$module}" : "uploads/global/{$module}";
        $path = $file->storePublicly($folder, ['disk' => 'public']);
        $url = asset('storage/'.ltrim($path, '/'));

        if ($clinicId) {
            FileUpload::create([
                'clinic_id' => $clinicId,
                'patient_id' => null,
                'appointment_id' => null,
                'uploaded_by_user_id' => $request->user()?->id,
                'module' => $module,
                'file_name' => $file->getClientOriginalName(),
                'file_path' => $path,
                'mime_type' => $file->getClientMimeType(),
                'file_size' => $file->getSize(),
                'visibility' => $visibility,
                'created_at' => now(),
            ]);
        }

        return $this->success('Image uploaded', [
            'url' => $url,
            'path' => $path,
        ], 201);
    }
}
