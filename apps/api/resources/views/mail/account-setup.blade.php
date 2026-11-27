<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Little Quest account setup</title></head>
<body style="font-family:Arial,sans-serif;background:#fcf8f2;padding:24px;color:#493b54">
<main style="max-width:520px;margin:auto;background:white;border-radius:20px;padding:28px">
    @if ($moderator)
        <h1 style="font-size:26px">Help create Little Quest quizzes</h1>
        <p>You’ve been invited to create and edit quiz drafts in Content Studio. An administrator reviews changes before they go live.</p>
        <p>Use your existing Little Quest account if you already have one with this email address.</p>
    @else
        <h1 style="font-size:26px">Set up your family account</h1>
        <p>Choose a password to finish setting up your account. Then you can add a profile and save quiz progress for each child.</p>
    @endif
    <p style="margin:24px 0"><a href="{{ $url }}" style="background:#7954bd;color:white;text-decoration:none;padding:14px 20px;border-radius:10px;display:inline-block">{{ $moderator ? 'Open moderator invitation' : 'Set my password' }}</a></p>
    <p>This link can be used once and expires in {{ $moderator ? 'seven days' : '24 hours' }}. If the button doesn’t work, copy this link into your browser:</p>
    <p style="word-break:break-all">{{ $url }}</p>
    <p>If you weren’t expecting this email, you can ignore it.</p>
</main>
</body>
</html>
