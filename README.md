# Little Quest

A browser-first learning adventure for children aged 7–10. Laravel owns authentication, permissions, questions, scoring, progress, and stickers. Next.js provides the child, parent, and admin interfaces. PostgreSQL 18 is the deployment database; SQLite is supported for quick local development.

## Run locally

Requires PHP 8.4, Composer, Node.js 24, npm, and PHP's SQLite driver. PostgreSQL deployments use `pdo_pgsql`, included in the Docker image.

```bash
npm ci
cd apps/api
composer install
cp .env.example .env
php artisan key:generate
php -r "file_exists('database/database.sqlite') || touch('database/database.sqlite');"
php artisan migrate --seed
php artisan storage:link
cd ../..
npm run dev:all
```

Open **http://localhost:3000**. The public, labelled demo uses device-local storage and a mixed five-question sampler for each subject. It does not create family learning records or expose draft questions. The signed-in experience uses the Laravel API and skill-specific published content.

For separate terminals, run `php artisan serve --host=127.0.0.1 --port=8000` from `apps/api` and `npm run dev` from the repository root. Use `localhost:3000` consistently rather than switching between localhost and 127.0.0.1, because cookies are host-specific.

## Set up the pilot

Create your own administrator interactively; no default passwords or administrator accounts are shipped:

```bash
cd apps/api
php artisan pilot:admin your-email@example.com
```

1. Open **Parent corner** and sign in with that account.
2. Open **Content studio** to review the 120 draft questions. Each of the 12 skills has ten questions.
3. Check each answer and explanation, upload narration, listen to it, and select the three adult-review checks. Audio for reading activities must not reveal the word or passage being assessed. Upload optional illustrations with a description.
4. Publish at least **five questions per skill** to make that adventure playable. Each save creates a revision; active adventures retain their original revisions.
5. Add child profiles, choose starting skills, and enter an explorer's learning area.
6. Use **Invite family** to send seven-day, single-use registration invitations. New parents verify their email before adding children.

The application intentionally does not auto-approve content. Starter question accuracy, wording, images, and narration need human review before children use them in the pilot.

Locally, `MAIL_MAILER=log` writes verification, invitation, and recovery messages to the ignored Laravel log. For production, configure working SMTP delivery. Do not publish mail logs or invitation/reset links.

## Layout and API

- `apps/api`: Laravel 13, Sanctum, migrations, the draft question bank, PHPUnit tests, and administration commands.
- `apps/web`: Next.js 16, React 19, TypeScript, Tailwind, and original SVG illustrations.
- `packages/api-client`: framework-independent fetch client and types generated from `docs/openapi.yaml`.
- `infrastructure`: production images, HTTPS routing, and daily database/media backups.

The versioned API is `/api/v1`. Before browser mutations, the client obtains `/sanctum/csrf-cookie` and sends the decoded `XSRF-TOKEN` cookie in `X-XSRF-TOKEN`. Expired CSRF tokens refresh once automatically. Protected requests require verified email and server-side ownership checks. Child mode is enforced by the server and requires password reauthentication to return to adult mode.

Answers are first-submission-only. Requests carry the attempt position and revision ID; retries cannot change accepted answers or award duplicate stickers. Completion and progress records are transactional. Starting an adventure reuses the child's existing active attempt.

```bash
npm run generate:api
npm run typecheck
npm run build
npm run test:api
```

The production build uses Next.js's supported Webpack compiler. The default Turbopack build worker could not bind its internal socket in the restricted development environment.

## PostgreSQL integration checks

```bash
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from test
docker compose -f compose.test.yaml down
```

This is a separate project and disposable PostgreSQL 18 database. It never connects to the pilot database. JUnit results are written to `artifacts/test-results/postgres.xml`.

## Deploy the pilot

Use a Linux server with Docker Compose, a domain pointing to it, and inbound ports 80/443. The deployment does not expose PostgreSQL or PHP-FPM publicly.

1. Copy root `.env.example` to `.env`. Set `SITE_DOMAIN`, a fresh `APP_KEY`, a strong unique `DB_PASSWORD`, and production SMTP credentials. Generate the key with `php apps/api/artisan key:generate --show` and put its output in the root `.env`; keep this file private and untracked.
2. Build and start:

```bash
docker compose up -d --build
docker compose exec api php artisan db:seed --force
docker compose exec api php artisan pilot:admin your-email@example.com
```

Caddy provisions HTTPS. The API applies migrations on startup; the queue worker uses the database queue. Published media lives in a named volume. Application errors go to stderr; inspect `docker compose logs api worker`. Health checks cover PostgreSQL, PHP-FPM, and the web app. Aggregate pilot metrics are available with:

```bash
docker compose exec api php artisan pilot:report
```

`docker compose --profile local-mail up -d mailpit` provides a local mail inbox on http://localhost:8025 when testing with Mailpit SMTP settings. Production must use real SMTP delivery.

## Backups and restore

The backup service writes a PostgreSQL custom-format dump and a matching media `.tar.gz` immediately, then daily, under `backups/`. Both must be kept together. Protect this directory and copy backups to separate storage; the app does not select an external storage provider or retention policy for you.

Verify restoration into a **new, separate database**, never over the running pilot:

```bash
docker compose exec database createdb -U quest quest_restore_check
docker compose exec -T database pg_restore -U quest -d quest_restore_check < backups/database-YYYYMMDDTHHMMSSZ.dump
docker compose exec database psql -U quest -d quest_restore_check -c 'select count(*) from questions;'
mkdir -p /tmp/quest-media-restore
tar -xzf backups/media-YYYYMMDDTHHMMSSZ.tar.gz -C /tmp/quest-media-restore
```

The shipped backup script and both archive formats have been tested against isolated PostgreSQL 18, including recovery of 120 questions, 120 revisions, 12 skills, and a media fixture.

## Pilot acceptance still requiring people or infrastructure

- Adult review and narration for the starter content.
- Real SMTP credentials, domain, server, and production backup storage.
- Observe five children using the app; at least four should complete an adventure without navigation help after parent setup.
- Run the device/browser matrix in `docs/pilot-checks.md` before inviting the 10–20 pilot families. Browser layout checks in this workspace are not a substitute for real-device testing.

Payments, schools, live AI generation, offline packs, native desktop packaging, and the React Native/Expo app remain later phases. The Laravel API and generated TypeScript types are ready to be reused by a future mobile client.

Nunito is bundled under the SIL Open Font License; see `apps/web/public/fonts/OFL.txt`.
