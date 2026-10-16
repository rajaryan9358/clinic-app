<?php

namespace App\Support;

/**
 * The current privacy-notice version patients must accept to use the
 * patient portal. Bumping VERSION re-prompts every patient whose
 * `patients.consent_version` no longer matches.
 */
final class PortalConsent
{
    public const VERSION = '2026-09-v1';

    /**
     * Paragraphs are separated by newlines; the portal's consent screen
     * splits on them. Re-paragraphing alone is cosmetic and must not bump
     * VERSION — that would re-prompt every patient who already accepted.
     */
    public const TEXT = "This clinic collects and processes your personal and health data (contact details, medical history and prescriptions) to provide care, maintain your medical record, and communicate with you about appointments.\n"
        ."Your data is shared only with the doctors and staff involved in your care, and isn't sold or used for marketing.\n"
        .'You can ask the clinic what data is held about you at any time.';
}
