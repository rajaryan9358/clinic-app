<?php

namespace Tests\Feature\Portal;

use Tests\TestCase;

/**
 * The patient-portal SPA is served by a single catch-all Blade view
 * (see routes/web.php); every client-side route — including nested ones
 * the React router owns, like /visits — must resolve to that same HTML
 * shell so the SPA can boot and take over routing itself.
 */
class PortalViewRouteTest extends TestCase
{
    public function test_portal_root_serves_the_spa_shell(): void
    {
        $response = $this->get('/portal');

        $response->assertOk();
        $response->assertSee('id="portal-root"', false);
    }

    public function test_portal_nested_route_serves_the_same_spa_shell(): void
    {
        $response = $this->get('/portal/visits');

        $response->assertOk();
        $response->assertSee('id="portal-root"', false);
    }
}
