# Pilot validation

## Verified in this workspace

- Next.js production build and TypeScript checking.
- 25 backend tests / 582 assertions on both SQLite and PostgreSQL 18.
- Cookie sign-in through the Next.js proxy, CSRF rejection, profile creation, child-mode permissions, parent reauthentication, and sign-out with a disposable unprivileged account. Account cleanup was verified.
- Demo start, correct-answer feedback, explicit Next, refresh/resume, completion, and one sticker.
- Desktop visual inspection, narrow-screen structure and overflow inspection, keyboard-visible focus, dialog labels, and audio-unavailable feedback.
- PostgreSQL custom-format backup and restore; media archive extraction and content comparison.
- npm audit: zero known vulnerabilities at implementation time.

## Human and device checks before invitations

| Check                                    | Passing result                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Five children, ages 7–10                 | At least four start and finish without navigation help after setup                 |
| Desktop Chrome / Edge / Firefox / Safari | Sign-in, quiz, audio, refresh/resume, and parent gate all work                     |
| iPad Safari / Android Chrome             | Answer cards are easy to tap; no clipped content or horizontal scrolling           |
| Keyboard only                            | Every action is reachable; focus moves to new questions; dialogs keep focus inside |
| Reduced motion                           | No required animations; information remains available                              |
| Audio                                    | Reviewed narration plays only on request and does not reveal reading answers       |
| Connection interrupted after answer      | Reconnect/retry returns accepted feedback without changing the score               |
| Connection interrupted after completion  | Retrying returns the same completed attempt and one sticker                        |
| Two families / two child profiles        | Other-family records and other selected-child attempts stay inaccessible           |
| Content edited mid-adventure             | The active question revision and its correct answer remain unchanged               |
| Invitation / verification / recovery     | Actual SMTP messages arrive, links work, and expired/used tokens are rejected      |
| Data removal                             | Profile/account deletion removes live family learning data                         |
| Production restore rehearsal             | A separate restored database and media files can be read successfully              |

Invite a small group first. Review completion rates, returning explorers, request/audio errors, parent feedback, and observed confusing steps before expanding.
