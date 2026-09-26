<?php

namespace Tests\Feature\WhatsApp;

use App\Services\WhatsApp\PhoneNumber;
use Tests\TestCase;

class PhoneNumberTest extends TestCase
{
    public function test_normalises_indian_formats(): void
    {
        foreach (['98765 43210', '+91-98765-43210', '09876543210', '919876543210', '+91 9876543210'] as $raw) {
            $this->assertSame('919876543210', PhoneNumber::normalise($raw), $raw);
        }
        $this->assertSame('14155552671', PhoneNumber::normalise('+1 415 555 2671'));
        $this->assertNull(PhoneNumber::normalise('12345'));
        $this->assertNull(PhoneNumber::normalise(null));
        $this->assertNull(PhoneNumber::normalise(''));
    }
}
