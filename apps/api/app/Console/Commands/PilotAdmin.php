<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

class PilotAdmin extends Command
{
    protected $signature = 'pilot:admin {email}';

    protected $description = 'Create a verified pilot administrator (interactive password)';

    public function handle(): int
    {
        $email = strtolower(trim($this->argument('email')));
        $password = $this->secret('Password (10+ characters, including letters and numbers)');
        $validator = Validator::make(['email' => $email, 'password' => $password], ['email' => 'required|email|unique:users,email', 'password' => ['required', Password::min(10)->letters()->numbers()]]);
        if ($validator->fails()) {
            $this->error($validator->errors()->first());

            return self::FAILURE;
        }
        $u = User::create(['name' => 'Pilot administrator', 'email' => $email, 'password' => $password]);
        $u->forceFill(['role' => 'admin', 'email_verified_at' => now()])->save();
        $this->info('Administrator created. Sign in through the parent area.');

        return self::SUCCESS;
    }
}
