<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class AccountSetup extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public string $url, public bool $moderator = false) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->moderator
            ? 'You’re invited to help with Little Quest'
            : 'Finish setting up your Little Quest family account');
    }

    public function content(): Content
    {
        return new Content(view: 'mail.account-setup');
    }
}
