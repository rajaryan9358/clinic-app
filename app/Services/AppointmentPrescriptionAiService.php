<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AppointmentPrescriptionAiService
{
    private function openAiKey(): string
    {
        return (string) config('services.openai.key');
    }

    private function chatModel(): string
    {
        return (string) (config('services.openai.prescription_model') ?: config('services.openai.model') ?: 'gpt-4o-mini');
    }

    private function sttModel(): string
    {
        return (string) (config('services.openai.stt_model') ?: 'whisper-1');
    }

    private function extractJson(string $text): array
    {
        $text = trim($text);
        $first = strpos($text, '{');
        $last = strrpos($text, '}');
        if ($first === false || $last === false || $last <= $first) {
            throw new \RuntimeException('LLM output did not contain JSON');
        }
        $json = substr($text, $first, $last - $first + 1);
        $decoded = json_decode($json, true);
        if (! is_array($decoded)) {
            throw new \RuntimeException('Failed to parse LLM JSON');
        }
        return $decoded;
    }

    private function normalizePrescriptionData(array $data, string $transcript, array $context = []): array
    {
        $key = $this->openAiKey();
        if (! $key) {
            return $data;
        }

        $patientName = (string) ($context['patient_name'] ?? '');
        $doctorName = (string) ($context['doctor_name'] ?? '');
        $visitType = (string) ($context['visit_type'] ?? '');

        $system = implode("\n", [
            'You are a medical terminology normalizer for outpatient prescriptions.',
            'Goal: Ensure diagnosis and medicine names are real-world terms and correctly spelled.',
            'You must also expand common Indian doctor shortcodes and Hindi timing phrases into clear readable instructions.',
            'IMPORTANT CONSTRAINTS:',
            '- Do NOT add new medicines or remove medicines. Keep the same number of medicines and preserve their order.',
            '- Do NOT change dosage or duration content except to fix obvious spelling/typos (e.g., "mornign" -> "morning").',
            '- Only correct spelling/casing/spacing, expand abbreviations, and normalize to standard real-world terminology when it is clearly implied by the transcript.',
            '- If a medicine/diagnosis is unclear, keep it as-is rather than guessing. Do NOT hallucinate.',
            'SHORTCODES (expand into English):',
            '- OD -> once daily',
            '- BD -> twice daily',
            '- TDS -> three times daily',
            '- HS -> at night',
            '- SOS -> as needed',
            '- STAT -> immediately',
            '- AF -> after food',
            '- BF / BBF -> before breakfast',
            '- AC -> before meals',
            '- PC -> after meals',
            '- PO -> by mouth',
            '- Cap -> capsule',
            '- Tab -> tablet',
            '- Syp / Syr -> syrup',
            '- Inj -> injection',
            '- Neb -> nebulization',
            'HINDI/SPOKEN PHRASES (normalize):',
            '- "raat ko" -> at night',
            '- "subah" -> in the morning',
            '- "subah shaam" -> morning and evening',
            '- "khane ke baad" -> after food',
            '- "khane se pehle" -> before food',
            'MEDICINE NAME NORMALIZATION:',
            '- Fix spelling using common Indian medicine names and combinations when it is clearly the intended drug (handle phonetic STT errors, e.g., "acilophenic" -> "Aceclofenac").',
            '- Do not invent brands; prefer the correctly spelled generic name when clear.',
            'STT CLEANUP:',
            '- Fix common STT phrase errors when obvious (e.g., "post meal" -> "post-meal").',
            'OUTPUT REQUIREMENTS:',
            '- Keep the SAME JSON schema as the extracted prescription.',
            '- Put expansions into the closest existing field. For medicines, use medicines[].dosage and medicines[].duration.',
            'Return ONLY valid JSON. No markdown, no backticks.',
            'Schema:',
            '{',
            '  "complaints": ["..."],',
            '  "diagnosis": "...",',
            '  "medicines": [{"name":"...","dosage":"...","duration":"..."}],',
            '  "advice": ["..."],',
            '  "follow_up": "..."',
            '}',
        ]);

        $payload = [
            'patient_name' => $patientName,
            'doctor_name' => $doctorName,
            'visit_type' => $visitType,
            'transcript' => trim($transcript),
            'extracted_prescription' => $data,
        ];

        $res = Http::withToken($key)
            ->timeout(60)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => $this->chatModel(),
                'temperature' => 0.1,
                'max_tokens' => 700,
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ['role' => 'user', 'content' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)],
                ],
                'response_format' => ['type' => 'json_object'],
            ]);

        if (! $res->successful()) {
            Log::warning('OpenAI prescription normalization failed', [
                'status' => $res->status(),
                'body' => $res->body(),
            ]);
            return $data;
        }

        $content = $res->json('choices.0.message.content');
        if (! is_string($content) || trim($content) === '') {
            return $data;
        }

        $json = $this->extractJson($content);

        $normalized = [
            'complaints' => array_values(array_filter((array) Arr::get($json, 'complaints', []), fn ($v) => is_string($v) && trim($v) !== '')),
            'diagnosis' => trim((string) Arr::get($json, 'diagnosis', '')),
            'medicines' => array_values(array_filter((array) Arr::get($json, 'medicines', []), fn ($v) => is_array($v) && (string) ($v['name'] ?? '') !== '')),
            'advice' => array_values(array_filter((array) Arr::get($json, 'advice', []), fn ($v) => is_string($v) && trim($v) !== '')),
            'follow_up' => trim((string) Arr::get($json, 'follow_up', '')),
        ];

        // Enforce: never add/remove medicines (keep count/order from extracted).
        $originalMeds = (array) ($data['medicines'] ?? []);
        $newMeds = (array) ($normalized['medicines'] ?? []);
        if (count($newMeds) !== count($originalMeds)) {
            $normalized['medicines'] = $originalMeds;
        } else {
            $normalized['medicines'] = array_values(array_map(function ($m, $idx) use ($originalMeds) {
                $orig = is_array($originalMeds[$idx] ?? null) ? $originalMeds[$idx] : [];
                $med = is_array($m) ? $m : [];
                return [
                    'name' => trim((string) ($med['name'] ?? $orig['name'] ?? '')),
                    'dosage' => trim((string) ($med['dosage'] ?? $orig['dosage'] ?? '')),
                    'duration' => trim((string) ($med['duration'] ?? $orig['duration'] ?? '')),
                ];
            }, $newMeds, array_keys($newMeds)));
        }

        return $normalized;
    }

    public function transcribeAudio(UploadedFile $audio): string
    {
        $key = $this->openAiKey();
        if (! $key) {
            throw new \RuntimeException('OpenAI API key is not configured');
        }

        $content = file_get_contents($audio->getRealPath());
        if ($content === false || $content === '') {
            throw new \RuntimeException('Failed to read audio file');
        }

        $res = Http::withToken($key)
            ->timeout(60)
            ->attach('file', $content, $audio->getClientOriginalName() ?: 'audio.webm')
            ->post('https://api.openai.com/v1/audio/transcriptions', [
                'model' => $this->sttModel(),
                'response_format' => 'json',
            ]);

        if (! $res->successful()) {
            Log::warning('OpenAI STT failed', [
                'status' => $res->status(),
                'body' => $res->body(),
            ]);
            throw new \RuntimeException('Speech-to-text failed');
        }

        $text = $res->json('text');
        if (! is_string($text) || trim($text) === '') {
            throw new \RuntimeException('Speech-to-text returned empty text');
        }

        return trim($text);
    }

    public function generatePrescriptionFromTranscript(string $transcript, array $context = []): array
    {
        $key = $this->openAiKey();
        if (! $key) {
            throw new \RuntimeException('OpenAI API key is not configured');
        }

        $patientName = (string) ($context['patient_name'] ?? '');
        $doctorName = (string) ($context['doctor_name'] ?? '');
        $visitType = (string) ($context['visit_type'] ?? '');

        $system = implode("\n", [
            'You are a clinical documentation assistant. Convert the doctor\'s dictation transcript into a structured outpatient prescription.',
            'Return ONLY valid JSON. No markdown, no backticks.',
            'Do NOT invent medicines, dosages, diagnoses, or tests that were not stated.',
            'If something is unclear or missing, keep the field empty ("" or []) rather than guessing.',
            'Use correctly spelled real-world medical terminology for diagnosis and medicines; fix obvious spelling errors from the transcript but never guess new content.',
            'Understand common Indian prescription shortcodes and spoken phrases and expand them in the relevant fields (especially medicines.dosage/duration), e.g. OD/BD/TDS/HS/SOS/STAT/AF/BF/BBF/AC/PC/PO and phrases like "raat ko", "subah", "subah shaam", "khane ke baad", "khane se pehle".',
            'No medical advice beyond formatting the prescription content from the transcript.',
            'Schema:',
            '{',
            '  "complaints": ["..."],',
            '  "diagnosis": "...",',
            '  "medicines": [{"name":"...","dosage":"...","duration":"..."}],',
            '  "advice": ["..."],',
            '  "follow_up": "..."',
            '}',
            'Rules:',
            '- Keep items short and clinically formatted.',
            '- Medicines: name is the drug (prefer generic name if clearly stated), dosage should include frequency/timing, duration is a simple duration (e.g., "5 days").',
        ]);

        $user = "Patient: {$patientName}\nDoctor: {$doctorName}\nVisit Type: {$visitType}\n\nTRANSCRIPT:\n" . trim($transcript);

        $res = Http::withToken($key)
            ->timeout(60)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => $this->chatModel(),
                'temperature' => 0.2,
                'max_tokens' => 800,
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ['role' => 'user', 'content' => $user],
                ],
                'response_format' => ['type' => 'json_object'],
            ]);

        if (! $res->successful()) {
            Log::warning('OpenAI prescription generation failed', [
                'status' => $res->status(),
                'body' => $res->body(),
            ]);
            throw new \RuntimeException('Prescription generation failed');
        }

        $content = $res->json('choices.0.message.content');
        if (! is_string($content) || trim($content) === '') {
            throw new \RuntimeException('LLM returned empty content');
        }

        $json = $this->extractJson($content);

        $data = [
            'complaints' => array_values(array_filter((array) Arr::get($json, 'complaints', []), fn ($v) => is_string($v) && trim($v) !== '')),
            'diagnosis' => trim((string) Arr::get($json, 'diagnosis', '')),
            'medicines' => array_values(array_filter((array) Arr::get($json, 'medicines', []), fn ($v) => is_array($v) && (string) ($v['name'] ?? '') !== '')),
            'advice' => array_values(array_filter((array) Arr::get($json, 'advice', []), fn ($v) => is_string($v) && trim($v) !== '')),
            'follow_up' => trim((string) Arr::get($json, 'follow_up', '')),
        ];

        try {
            $data = $this->normalizePrescriptionData($data, $transcript, $context);
        } catch (\Throwable $e) {
            Log::warning('Prescription normalization threw an exception', [
                'message' => $e->getMessage(),
            ]);
        }

        return [
            'transcript_text' => $transcript,
            'data' => $data,
            'raw' => $json,
        ];
    }
}
