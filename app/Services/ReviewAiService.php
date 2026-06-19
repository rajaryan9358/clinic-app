<?php

namespace App\Services;

use App\Models\Review;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ReviewAiService
{
    private function openAiKey(): string
    {
        return (string) config('services.openai.key');
    }

    private function openAiModel(): string
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

    private function chat(array $messages, int $maxTokens = 400): string
    {
        $key = $this->openAiKey();
        if (! $key) {
            throw new \RuntimeException('OpenAI API key is not configured');
        }

        $res = Http::withToken($key)
            ->timeout(30)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => $this->openAiModel(),
                'temperature' => 0.4,
                'max_tokens' => $maxTokens,
                'messages' => $messages,
                'response_format' => ['type' => 'json_object'],
            ]);

        if (! $res->successful()) {
            throw new \RuntimeException('OpenAI request failed');
        }

        $content = $res->json('choices.0.message.content');
        if (! is_string($content) || trim($content) === '') {
            throw new \RuntimeException('OpenAI returned empty content');
        }
        return $content;
    }

    public function analyzeAndPersistSentiment(Review $review): void
    {
        try {
            $content = $this->chat([
                [
                    'role' => 'system',
                    'content' => 'You are a strict JSON generator. Return only valid JSON with keys: sentiment (positive/neutral/negative), message (short), improvement (short).',
                ],
                [
                    'role' => 'user',
                    'content' => "Review Rating: {$review->rating}\nReview Text: {$review->message}\n\nClassify sentiment and provide a short summary message and one short improvement suggestion for the clinic.",
                ],
            ], 250);

            $json = $this->extractJson($content);

            $review->update([
                'sentiment' => Arr::get($json, 'sentiment'),
                'sentiment_message' => Arr::get($json, 'message'),
                'improvement_suggestion' => Arr::get($json, 'improvement'),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Review sentiment analysis failed', [
                'review_id' => $review->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function generateReply(Review $review, array $options, array $clinicInfo): array
    {
        $replyLength = match ((string) ($options['reply_type'] ?? 'medium')) {
            'short' => 'short',
            'detailed' => 'long',
            default => 'medium',
        };
        $language = (string) ($options['language'] ?? 'english');
        $languageForPrompt = match (strtolower($language)) {
            'hindi' => 'Hindi',
            'hinglish' => 'Hinglish',
            default => 'English',
        };
        $tone = (string) ($options['tone'] ?? 'professional');
        $caseData = trim((string) ($options['case_data'] ?? ''));

        $prompt = (string) ($clinicInfo['prompt'] ?? '');
        if (! $prompt) {
            $prompt = 'You are an assistant that writes professional replies to Google reviews for healthcare clinics.';
        }

        $filled = str_replace(
            [
                '{{clinic_name}}',
                '{{doctor_name}}',
                '{{speciality}}',
                '{{location}}',
                '{{tone}}',
                '{{services}}',
                '{{contact_cta}}',
                '{{reviewer_name}}',
                '{{rating}}',
                '{{review_text}}',
                '{{language}}',
                '{{short/medium/long}}',
            ],
            [
                (string) ($clinicInfo['clinic_name'] ?? ''),
                (string) ($clinicInfo['doctor_name'] ?? ''),
                (string) ($clinicInfo['speciality'] ?? ''),
                (string) ($clinicInfo['location'] ?? ''),
                $tone,
                (string) ($clinicInfo['services'] ?? ''),
                (string) ($clinicInfo['contact_cta'] ?? 'Please contact the clinic directly.'),
                (string) ($review->reviewer_name ?? ''),
                (string) ($review->rating ?? ''),
                (string) ($review->message ?? ''),
                $languageForPrompt,
                $replyLength,
            ],
            $prompt
        );

        $optionsBlock = "GENERATION OPTIONS (must follow):\n"
            . "- Reply length: {$replyLength} (short/medium/long)\n"
            . "- Language: {$languageForPrompt}\n"
            . "- Tone: {$tone}\n";

        if ($caseData !== '') {
            $optionsBlock .= "- Case context: provided (use as extra context; do not invent facts)\n";
        }

        $filled = $optionsBlock . "\n---\n\n" . $filled;

        if ($caseData !== '') {
            $filled .= "\n\nCase Data / Context (provided by staff):\n{$caseData}\n\nUse this only as context and do not invent facts.";
        }

        $content = $this->chat([
            [
                'role' => 'system',
                'content' => implode("\n", [
                    'Return ONLY valid JSON that matches the required schema. No markdown, no backticks.',
                    'You MUST follow the GENERATION OPTIONS (reply length, language, tone, and any case context) provided by the user message.',
                    'If language is Hindi or Hinglish, the entire reply text must be in that language style.',
                    'If reply length is short/medium/long, keep the reply accordingly; do not ignore length.',
                    'Never invent facts; never add medical advice; never disclose patient info.',
                ]),
            ],
            [
                'role' => 'user',
                'content' => $filled,
            ],
        ], 500);

        $json = $this->extractJson($content);

        return [
            'reply' => (string) Arr::get($json, 'reply', ''),
            'tone_used' => (string) Arr::get($json, 'tone_used', ''),
            'category' => (string) Arr::get($json, 'category', ''),
            'needs_human_review' => (bool) Arr::get($json, 'needs_human_review', false),
            'raw' => $json,
            'options' => [
                'reply_type' => (string) ($options['reply_type'] ?? 'medium'),
                'language' => $language,
                'tone' => $tone,
                'case_data' => $caseData,
            ],
        ];
    }
}
