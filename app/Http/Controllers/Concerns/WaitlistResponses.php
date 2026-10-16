<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Maps WaitlistService errors onto the `{success: false, message, errors}`
 * shape of ApiResponse::error(): the duplicate join (ConflictHttpException)
 * → 409, every rule failure (ValidationException) → 422 with its first
 * message. Shared by the portal, clinic and super-admin waitlist
 * controllers. Requires ApiResponse.
 */
trait WaitlistResponses
{
    protected function waitlistError(ConflictHttpException|ValidationException $e): JsonResponse
    {
        if ($e instanceof ConflictHttpException) {
            return $this->error($e->getMessage(), ['waitlist' => [$e->getMessage()]], 409);
        }

        $errors = $e->errors();

        return $this->error((string) collect($errors)->flatten()->first(), $errors, 422);
    }
}
