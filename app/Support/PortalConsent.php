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

    public const TEXT = "This clinic collects and processes your personal and health data (contact details, medical history and prescriptions) to provide care, maintain your medical record, and communicate with you about appointments. Your data is shared only with the doctors and staff involved in your care, and isn't sold or used for marketing. You can ask the clinic what data is held about you at any time.";
}
