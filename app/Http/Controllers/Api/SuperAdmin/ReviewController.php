<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Clinic;
use App\Models\Review;
use App\Services\ReviewAiService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class ReviewController extends BaseCrudController
{
    protected string $modelClass = Review::class;

    protected array $searchable = ['reviewer_name', 'message'];

    protected array $filterable = ['clinic_id', 'rating', 'sentiment'];

    public function __construct(private readonly ReviewAiService $ai) {}

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with([
            'clinic:id,name',
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'clinic_id' => ['required', 'integer'],
            'reviewer_name' => ['nullable', 'string', 'max:255'],
            'message' => ['required', 'string', 'max:10000'],
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'review_date' => ['nullable', 'date'],
        ]);

        if (empty($data['review_date'])) {
            unset($data['review_date']);
        }

        /** @var Review $review */
        $review = Review::create($data);
        $review->loadMissing('clinic:id,name');

        $this->ai->analyzeAndPersistSentiment($review);

        return $this->success('Review created successfully', $review->refresh(), 201);
    }

    public function update(Request $request, int $id)
    {
        /** @var Review $review */
        $review = $this->findModel($id);
        $data = $request->validate([
            'reviewer_name' => ['nullable', 'string', 'max:255'],
            'message' => ['sometimes', 'string', 'max:10000'],
            'rating' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'review_date' => ['nullable', 'date'],
        ]);

        $shouldReanalyze = array_key_exists('message', $data) || array_key_exists('rating', $data);
        $review->update($data);
        if ($shouldReanalyze) {
            $this->ai->analyzeAndPersistSentiment($review->refresh());
        }

        $review->loadMissing('clinic:id,name');
        return $this->success('Review updated successfully', $review->refresh());
    }

    public function show(int $id)
    {
        /** @var Review $review */
        $review = $this->findModel($id);
        $review->loadMissing('clinic:id,name');

        $data = $review->toArray();
        $meta = is_array($review->reply_meta) ? $review->reply_meta : [];
        $data['reply_category'] = $meta['category'] ?? null;
        $data['reply_tone_used'] = $meta['tone_used'] ?? null;
        $data['reply_needs_human_review'] = $meta['needs_human_review'] ?? null;

        return $this->success('Record fetched successfully', $data);
    }

    public function generateReply(Request $request, int $id)
    {
        /** @var Review $review */
        $review = $this->findModel($id);
        $review->loadMissing('clinic:id,name');

        $opts = $request->validate([
            'reply_type' => ['required', 'in:short,medium,detailed'],
            'language' => ['required', 'in:english,hindi,hinglish'],
            'tone' => ['required', 'string', 'max:50'],
            'case_data' => ['nullable', 'string', 'max:5000'],
        ]);

        /** @var Clinic|null $clinic */
        $clinic = $review->clinic;

        $location = '';
        if ($clinic) {
            $parts = array_filter([$clinic->city, $clinic->state]);
            $location = implode(', ', $parts);
        }

        $result = $this->ai->generateReply($review, $opts, [
            'prompt' => (string) $request->input('prompt'),
            'clinic_name' => (string) ($clinic?->name ?? ''),
            'doctor_name' => '',
            'speciality' => '',
            'location' => $location,
            'services' => '',
            'contact_cta' => 'Please contact the clinic directly.',
        ]);

        return $this->success('Reply generated successfully', $result);
    }

    public function saveReply(Request $request, int $id)
    {
        /** @var Review $review */
        $review = $this->findModel($id);

        $data = $request->validate([
            'reply' => ['required', 'string', 'max:5000'],
            'tone_used' => ['nullable', 'string', 'max:50'],
            'category' => ['nullable', 'string', 'max:20'],
            'needs_human_review' => ['nullable', 'boolean'],
            'options' => ['nullable', 'array'],
            'raw' => ['nullable', 'array'],
        ]);

        $review->update([
            'reply_text' => $data['reply'],
            'reply_meta' => $data,
            'replied_at' => now(),
        ]);

        $review->loadMissing('clinic:id,name');
        return $this->success('Reply saved successfully', $review->refresh());
    }
}
