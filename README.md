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

## Hostinger VPS with existing Nginx and Certbot

Use the standalone [VPS installer](scripts/deploy-vps.sh) for **quiz.webostics.com** when the server already hosts projects such as School Van Tracking. It supports Ubuntu 22.04, 24.04, and 26.04 LTS. It reuses the clean `master` checkout at `/var/www/html/quiz_app` and keeps private deployment state under `/opt/webostics-quiz`. The existing Caddy Compose setup above is for a separate deployment arrangement; do not start it alongside host Nginx on this shared VPS.

Once this script is available on `master`, run on the VPS:

```bash
cd /var/www/html/quiz_app
git pull --ff-only origin master
sudo bash scripts/deploy-vps.sh --check
sudo bash scripts/deploy-vps.sh
```

Alternatively, copy the standalone script to `/root/deploy-vps.sh` and run it from there. Keep a manually copied script outside the checkout so Git does not report an unexpected untracked file.

The installer asks for a GitHub username and a hidden personal access token. Leave the username empty for anonymous access to this public repository. GitHub account passwords are not supported. Credentials are temporary and are not saved in the remote URL or logs.

On first setup, SMTP settings are imported from the checkout's ignored `apps/api/.env` if present. **Git does not transfer this file from your development machine.** You can also copy that file onto the VPS and select it explicitly:

```bash
sudo bash /root/deploy-vps.sh --env-file /root/quiz.env
```

If no file or previous production configuration is available, the installer prompts for SMTP settings with a hidden password. It uses Laravel's dotenv parser and preserves literal dollar signs, quotes, and backslashes through Docker Compose. Only `MAIL_*` settings are imported. Port 465 selects `smtps` (implicit TLS); the installer also corrects the earlier `smtp` default for stored port-465 configurations. Production application/database secrets are generated separately and retained across retries and updates; local SQLite credentials and development application keys are not imported. Later runs preserve production mail settings unless you explicitly pass `--env-file` again.

The script checks available RAM/disk, repository ownership, host web listeners, and Nginx domain collisions. It installs missing dependencies without upgrading or removing installed packages. If an existing Docker/plugin installation is incompatible or its daemon is stopped, it stops with instructions rather than replacing or restarting shared infrastructure.

Quiz runs under Compose project `webostics_quiz`. Only its gateway is bound to `127.0.0.1`, using an available port in **18080–18179**; PostgreSQL, PHP-FPM, and Next.js remain internal. The dedicated build worker is capped at one CPU and 2 GiB RAM and is stopped after the build. Runtime containers also have CPU/memory limits and rotating logs. Existing projects, default Docker builders, and global PHP/Node/PostgreSQL installations are not reconfigured.

Nginx changes are limited to `/etc/nginx/conf.d/webostics-quiz.conf`. Configuration is checked before a graceful reload, and the prior Quiz configuration is restored on failure. Certbot obtains certificates through a dedicated webroot without stopping Nginx, retaining its normal interactive account/terms prompts. A matching valid certificate and an active standard Certbot systemd timer are reused. If no active standard timer is detected, a Quiz-only timer is added without changing existing cron jobs. Any added reload hook acts only on the Quiz certificate.

Nginx reloads are asynchronous. The installer waits until the Quiz virtual host serves the exact challenge token locally, then verifies the public challenge before calling Certbot. HTTPS checks also wait for the new workers. Temporary responses from the previous default site during reload no longer abort setup; persistent local routing failures and public DNS/routing failures are reported separately.

Updates build commit-tagged images before placing **only Quiz** in maintenance mode. The installer pauses its worker, backs up its database and media, applies migrations explicitly, checks health, configures HTTPS, and resumes the worker. The initial question bank remains draft; administrator creation is interactive and optional. If failure occurs after migrations begin, Quiz stays in maintenance mode; the script does not automatically reverse migrations or restore the database. Correct the logged issue and rerun the installer. The last successful deployment and failed candidate configurations remain available under the private deployment directory.

The API service explicitly starts `php-fpm`; overriding a Compose entrypoint alone discards the image's default command. If an earlier installation stopped at API readiness, rerun the corrected installer. It uses a one-off Artisan command to enter maintenance even when the old API container is stopped or restarting, and preserves existing database/media volumes and production secrets. Startup failures now record the container state and recent health/container output in the private deployment log. Do not paste `environment.json` or the full generated Compose configuration into support messages because they contain credentials.

```bash
# Re-run to update to the latest master; this does not run application test suites.
sudo bash /opt/webostics-quiz/bin/deploy-vps.sh

# Retry an incomplete deployment using its saved commit, images, and SMTP settings.
# Use the corrected installer from master or a downloaded standalone copy.
# No GitHub login, fetch, image build, or package installation is performed.
sudo bash scripts/deploy-vps.sh --resume

sudo bash /opt/webostics-quiz/bin/deploy-vps.sh --status
sudo bash /opt/webostics-quiz/bin/deploy-vps.sh --logs
sudo bash /opt/webostics-quiz/bin/deploy-vps.sh --backup
```

`--resume` requires an incomplete deployment, its matching production keys, all three existing Quiz volumes, and its cached images. It stops if any are missing rather than creating replacement storage. It backs up the existing database/media, retries migrations explicitly, then completes HTTPS, worker startup, and scheduled backups. Use the normal installer for a new release or to change SMTP with `--env-file`.

Deployment logs and paired backups are under `/opt/webostics-quiz/shared/`, with restricted permissions. Daily backups run at **02:30 UTC / 07:30 Pakistan time** and retain the latest seven complete pairs (`.dump`, `.media.tar.gz`, and `.complete`). Copy them to separate storage for protection against VPS loss, and securely back up `shared/environment.json` separately to retain production keys and mail settings. A `.complete` marker identifies a successfully created pair. Status output includes the active configuration path; use it with `docker compose --env-file /dev/null -p webostics_quiz -f PATH` for manual administration or recovery. Never use `down -v` or automatic database rollback as an update step.

`--check` performs a read-only preflight. Actual deployment performs only required configuration validation and service/HTTPS health checks, with no application test suites or automatic test email. The installer is not a remote SSH tool; run it on the VPS in an interactive root/sudo terminal.

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
