<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiResponseTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_401_json_for_guest_requests_without_an_accept_header(): void
    {
        $response = $this->get('/api/v1/session');

        $response->assertUnauthorized()
            ->assertHeader('Content-Type', 'application/json')
            ->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_returns_403_json_for_unverified_parents_without_an_accept_header(): void
    {
        $parent = User::factory()->unverified()->create();

        $response = $this->actingAs($parent)->get('/api/v1/catalog');

        $response->assertForbidden()
            ->assertHeader('Content-Type', 'application/json')
            ->assertJsonPath('message', 'Your email address is not verified.');
    }

    public function test_returns_422_json_for_invalid_login_without_an_accept_header(): void
    {
        $response = $this->post('/api/v1/auth/login');

        $response->assertUnprocessable()
            ->assertHeader('Content-Type', 'application/json')
            ->assertJsonValidationErrors(['email', 'password']);
        $this->assertDatabaseCount('users', 0);
    }
}
