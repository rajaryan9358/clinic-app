<?php

namespace App\Services;

use App\Models\Patient;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PatientGlobalSummaryService
{
    private function openAiKey(): string
    {
        return (string) config('services.openai.key');
    }

    private function chatModel(): string
    {
        return (string) (config('services.openai.model') ?: 'gpt-4o-mini');
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

    public function generate(
        Patient $patient,
        Collection $appointments,
        Collection $summaries,
        Collection $notes,
        Collection $prescriptions,
    ): array {
        $key = $this->openAiKey();
        if (! $key) {
            throw new \RuntimeException('OpenAI API key is not configured');
        }

        $summaryByAppt = $summaries->keyBy('appointment_id');
        $rxByAppt = $prescriptions->keyBy('appointment_id');

        $apptLines = [];
        foreach ($appointments as $appt) {
            $date = $appt->appointment_date
                ? (is_string($appt->appointment_date) ? $appt->appointment_date : $appt->appointment_date->toDateString())
                : '—';
            $doctorName = $appt->doctor?->full_name ?? '—';
            $line = "- [{$date}] {$appt->visit_type} with Dr. {$doctorName}, status: {$appt->status}";

            if ($appt->notes) {
                $line .= ". Notes: " . Str::limit((string) $appt->notes, 120);
            }

            $rx = $rxByAppt->get($appt->id);
            if ($rx) {
                $rxData = is_array($rx->data) ? $rx->data : [];
                if (!empty($rxData['diagnosis'])) {
                    $line .= ". Diagnosis: " . Str::limit((string) $rxData['diagnosis'], 100);
                }
                if (!empty($rxData['complaints'])) {
                    $complaints = implode(', ', array_slice((array) $rxData['complaints'], 0, 3));
                    $line .= ". Complaints: {$complaints}";
                }
                if (!empty($rxData['medicines'])) {
                    $medNames = implode(', ', array_map(
                        fn ($m) => is_array($m) ? (string) ($m['name'] ?? '') : '',
                        array_slice((array) $rxData['medicines'], 0, 4)
                    ));
                    if (trim($medNames, ', ')) {
                        $line .= ". Medications: {$medNames}";
                    }
                }
                if (!empty($rxData['advice'])) {
                    $advice = implode(', ', array_slice((array) $rxData['advice'], 0, 2));
                    $line .= ". Advice: {$advice}";
                }
                if (!empty($rxData['follow_up'])) {
                    $line .= ". Follow-up: " . Str::limit((string) $rxData['follow_up'], 80);
                }
            }

            $s = $summaryByAppt->get($appt->id);
            if ($s && $s->patient_summary) {
                $line .= ". Visit summary: " . Str::limit((string) $s->patient_summary, 200);
            }
            if ($s && $s->doctor_suggestions) {
                $line .= ". Doctor suggestions: " . Str::limit((string) $s->doctor_suggestions, 150);
            }

            $apptLines[] = $line;
        }

        $noteLines = $notes->map(
            fn ($n) => "- [{$n->note_type}] " . Str::limit((string) $n->note, 100)
        )->toArray();

        $system = implode("\n", [
            'You are a medical assistant generating a comprehensive patient health summary.',
            'Analyze the patient\'s appointment history, prescriptions, and notes to produce an overview for the care team.',
            'Return ONLY valid JSON. No markdown, no backticks.',
            '',
            'Schema:',
            '{',
            '  "overall_health_summary": "2-4 sentence plain-language overview of the patient\'s health journey and current status.",',
            '  "key_concerns": ["..."],',
            '  "treatment_progress": "1-2 sentences on how the patient is progressing based on visit history and prescriptions.",',
            '  "recommended_focus": "1-2 sentences on what the care team should focus on for upcoming visits."',
            '}',
        ]);

        $context = implode("\n", [
            "Patient: {$patient->full_name}",
            '',
            'Appointment & Prescription History:',
            implode("\n", $apptLines ?: ['No appointments recorded.']),
            '',
            'Patient Notes:',
            implode("\n", $noteLines ?: ['No notes recorded.']),
        ]);

        $res = Http::withToken($key)
            ->timeout(60)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => $this->chatModel(),
                'temperature' => 0.3,
                'max_tokens' => 600,
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ['role' => 'user', 'content' => $context],
                ],
                'response_format' => ['type' => 'json_object'],
            ]);

        if (! $res->successful()) {
            Log::warning('OpenAI global summary failed', [
                'status' => $res->status(),
                'body' => $res->body(),
            ]);
            throw new \RuntimeException('Global summary generation failed');
        }

        $content = $res->json('choices.0.message.content');
        if (! is_string($content) || trim($content) === '') {
            throw new \RuntimeException('LLM returned empty content');
        }

        $json = $this->extractJson($content);

        return [
            'overall_health_summary' => trim((string) ($json['overall_health_summary'] ?? '')),
            'key_concerns' => array_values(array_filter(
                (array) ($json['key_concerns'] ?? []),
                fn ($v) => is_string($v) && trim($v) !== ''
            )),
            'treatment_progress' => trim((string) ($json['treatment_progress'] ?? '')),
            'recommended_focus' => trim((string) ($json['recommended_focus'] ?? '')),
            'generated_at' => now()->toISOString(),
        ];
    }
}
