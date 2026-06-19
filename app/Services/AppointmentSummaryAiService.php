<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AppointmentSummaryAiService
{
    private function openAiKey(): string
    {
        return (string) config('services.openai.key');
    }

    private function chatModel(): string
    {
        return (string) (config('services.openai.summary_model') ?: config('services.openai.model') ?: 'gpt-4o-mini');
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
            Log::warning('OpenAI STT failed (summary)', [
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

    public function generateSummaryFromTranscript(string $transcript, array $context = []): array
    {
        $key = $this->openAiKey();
        if (! $key) {
            throw new \RuntimeException('OpenAI API key is not configured');
        }

        $patientName = (string) ($context['patient_name'] ?? '');
        $doctorName = (string) ($context['doctor_name'] ?? '');
        $visitType = (string) ($context['visit_type'] ?? '');

        $system = implode("\n", [
            'You are a clinical documentation assistant. Analyze the doctor-patient conversation transcript and extract a structured appointment summary.',
            'Return ONLY valid JSON. No markdown, no backticks.',
            'Do NOT invent information not stated in the transcript.',
            'If something is unclear or missing, keep the field empty ("" or []).',
            '',
            'Schema:',
            '{',
            '  "patient_summary": "Plain-language summary of what was discussed and decided, written for the patient to read (2-4 sentences). No jargon.",',
            '  "doctor_suggestions": "Clinical notes or suggestions for the doctor based on the conversation (1-3 sentences). Can use medical terminology.",',
            '  "preferred_medications": [{"name": "...", "note": "..."}]',
            '}',
            '',
            'Rules:',
            '- patient_summary: clear, empathetic language the patient can understand.',
            '- doctor_suggestions: actionable clinical notes for follow-up or care planning.',
            '- preferred_medications: list only medications mentioned by the doctor as preferred or recommended; include a brief note on each.',
            '- If no medications were discussed, preferred_medications should be an empty array [].',
        ]);

        $user = "Patient: {$patientName}\nDoctor: {$doctorName}\nVisit Type: {$visitType}\n\nTRANSCRIPT:\n" . trim($transcript);

        $res = Http::withToken($key)
            ->timeout(60)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => $this->chatModel(),
                'temperature' => 0.3,
                'max_tokens' => 600,
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ['role' => 'user', 'content' => $user],
                ],
                'response_format' => ['type' => 'json_object'],
            ]);

        if (! $res->successful()) {
            Log::warning('OpenAI summary generation failed', [
                'status' => $res->status(),
                'body' => $res->body(),
            ]);
            throw new \RuntimeException('Summary generation failed');
        }

        $content = $res->json('choices.0.message.content');
        if (! is_string($content) || trim($content) === '') {
            throw new \RuntimeException('LLM returned empty content');
        }

        $json = $this->extractJson($content);

        $preferredMeds = array_values(array_filter(
            (array) Arr::get($json, 'preferred_medications', []),
            fn ($v) => is_array($v) && (string) ($v['name'] ?? '') !== ''
        ));

        return [
            'transcript_text' => $transcript,
            'patient_summary' => trim((string) Arr::get($json, 'patient_summary', '')),
            'doctor_suggestions' => trim((string) Arr::get($json, 'doctor_suggestions', '')),
            'preferred_medications' => $preferredMeds,
            'raw' => $json,
        ];
    }
}
