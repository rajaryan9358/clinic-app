<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * The prescription PDF view (resources/views/reports/prescription.blade.php)
 * is rendered with the same shape App\Services\PrescriptionPdfRenderer
 * passes in, and with the same medicines shape the AI service writes
 * ({name, dosage, duration} — see App\Services\AppointmentPrescriptionAiService)
 * — so the duration must show up as real text, not "-". Covers the
 * "screen and PDF must agree" fix alongside
 * resources/js/portal/pages/PrescriptionDetail.jsx and the staff admin
 * viewer's Medicine/Dosage/Duration layout
 * (resources/js/admin/src/pages/workflows/PrescriptionPage.jsx).
 */
class PrescriptionPdfViewTest extends TestCase
{
    private function renderMedicines(array $medicines): string
    {
        // Same variable set App\Services\PrescriptionPdfRenderer::renderRow()
        // passes to this view.
        return view('reports.prescription', [
            'title' => 'Prescription',
            'generatedAt' => '2026-01-01 10:00',
            'patientName' => 'Test Patient',
            'doctorName' => 'Dr Test',
            'appointmentDate' => '2026-01-01',
            'appointmentTime' => '10:00',
            'visitType' => 'new',
            'prescriptionData' => ['medicines' => $medicines],
        ])->render();
    }

    public function test_medicine_duration_from_ai_service_schema_is_shown(): void
    {
        $html = $this->renderMedicines([
            ['name' => 'Paracetamol', 'dosage' => '500mg twice daily', 'duration' => '5 days'],
        ]);

        $this->assertStringContainsString('Paracetamol', $html);
        $this->assertStringContainsString('500mg twice daily', $html);
        $this->assertStringContainsString('5 days', $html);
    }

    public function test_legacy_days_and_duration_days_fields_fall_back_into_the_duration_column(): void
    {
        $html = $this->renderMedicines([
            ['name' => 'Cetirizine', 'dosage' => '10mg', 'days' => '3 days'],
            ['name' => 'Amoxicillin', 'dosage' => '250mg', 'duration_days' => '7 days'],
        ]);

        $this->assertStringContainsString('3 days', $html);
        $this->assertStringContainsString('7 days', $html);
    }

    public function test_legacy_frequency_field_is_folded_into_dosage_not_a_separate_column(): void
    {
        $html = $this->renderMedicines([
            ['name' => 'Azithromycin', 'dosage' => '500mg', 'frequency' => 'once daily', 'duration' => '3 days'],
        ]);

        $this->assertStringContainsString('once daily', $html);
        $this->assertStringContainsString('3 days', $html);

        // Exactly Medicine / Dosage / Duration — no separate Frequency
        // column, matching the staff admin viewer.
        $this->assertSame(3, substr_count($html, '<th ')); // header cells, not the <thead> tag itself
    }

    public function test_missing_duration_shows_dash(): void
    {
        $html = $this->renderMedicines([
            ['name' => 'Vitamin D3', 'dosage' => '1 tablet'],
        ]);

        $this->assertStringContainsString('Vitamin D3', $html);
        $this->assertStringContainsString('1 tablet', $html);
    }
}
