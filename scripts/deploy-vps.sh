#!/usr/bin/env bash
# Quiz-only deployment for an Ubuntu VPS that already hosts other applications.
# Run this file directly; it does not require neighbouring installer templates.

usage() {
  cat <<'HELP'
Little Quest · Hostinger VPS deployer

  sudo bash deploy-vps.sh [--env-file /root/quiz.env]
  sudo bash deploy-vps.sh --check
  sudo bash deploy-vps.sh --status
  sudo bash deploy-vps.sh --logs
  sudo bash deploy-vps.sh --backup

Default: install/update quiz.webostics.com from master.
Existing checkout: /var/www/html/quiz_app
Private deployment data: /opt/webostics-quiz
--check is read-only: it does not install packages, fetch code, or change services.
GitHub credentials are optional for the public repository; use a token, not your
GitHub account password. No application test suites are run by this installer.
HELP
}

message() {
  local level=$1 colour=$C_BLUE
  shift
  case $level in OK) colour=$C_GREEN ;; WARN) colour=$C_YELLOW ;; ERROR) colour=$C_RED ;; esac
  printf '%s%-7s%s %s\n' "$colour" "[$level]" "$C_RESET" "$*"
  if [[ -n ${LOG_FILE:-} ]]; then printf '[%s] %s %s\n' "$(date -u +%FT%TZ)" "$level" "$*" >> "$LOG_FILE"; fi
}

fail() { message ERROR "$*" >&2; return 1; }
step() { STAGE=$((STAGE + 1)); message INFO "${STAGE}/10 · $*"; }

run() {
  local label=$1 status=0 frame=0
  shift
  printf '%s  … %s%s\n' "$C_BLUE" "$label" "$C_RESET"
  (
    trap - ERR EXIT INT TERM
    set +e
    "$@"
  ) >> "$LOG_FILE" 2>&1 &
  TASK_PID=$!
  if [[ -t 1 ]]; then
    local frames='|/-\'
    while kill -0 "$TASK_PID" 2>/dev/null; do
      printf '\r  %s %s' "${frames:frame++%4:1}" "$label"
      sleep 0.2
    done
    printf '\r\033[K'
  fi
  wait "$TASK_PID" || status=$?
  TASK_PID=
  if ((status != 0)); then
    message ERROR "$label failed. Private details: $LOG_FILE"
    return "$status"
  fi
  message OK "$label"
}

compose() {
  local config=$1
  shift
  docker compose --env-file /dev/null --project-name "$PROJECT" \
    --project-directory "$ROOT" --file "$config" "$@"
}

json_field() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    print(json.load(source).get(sys.argv[2], ""))
PY
}

prompt() {
  local target=$1 label=$2 default=${3:-} value
  [[ -r /dev/tty ]] || fail 'An interactive terminal is required for initial setup.'
  if [[ -n $default ]]; then label="$label [$default]"; fi
  printf '%s: ' "$label" > /dev/tty
  IFS= read -r value < /dev/tty
  printf -v "$target" '%s' "${value:-$default}"
}

prompt_secret() {
  local target=$1 label=$2 value
  printf '%s: ' "$label" > /dev/tty
  IFS= read -rs value < /dev/tty
  printf '\n' > /dev/tty
  printf -v "$target" '%s' "$value"
}

owned_file() {
  [[ ! -L $1 ]] || fail "Refusing symlink at managed file: $1"
  [[ ! -e $1 ]] || grep -qF '# Managed by webostics-quiz' "$1" || fail "Unmanaged file already exists: $1"
}

check_workdir_ownership() {
  [[ ! -L $ROOT ]] || fail 'The deployment root must not be a symlink.'
  [[ ! -e $ROOT ]] || {
    [[ -d $ROOT && ! -L $ROOT && -f $ROOT/.managed-by-webostics-quiz && ! -L $ROOT/.managed-by-webostics-quiz ]] || fail "$ROOT is not an installer-owned directory."
    [[ $(cat "$ROOT/.managed-by-webostics-quiz") == "$PROJECT" ]] || fail 'The deployment ownership marker does not match Quiz.'
  }
  local path
  for path in bin releases acme acme/.well-known acme/.well-known/acme-challenge shared shared/logs shared/backups shared/deployments shared/tmp \
    shared/environment.json shared/current.json shared/pending.json shared/builder-owned shared/deploy.lock bin/deploy-vps.sh; do
    [[ ! -L $ROOT/$path ]] || fail "Refusing symlink within the managed deployment: $ROOT/$path"
  done
}

cleanup() {
  ((BASH_SUBSHELL == 0)) || return 0
  if [[ -n ${TASK_PID:-} ]]; then kill "$TASK_PID" 2>/dev/null || true; fi
  if [[ ${BUILDER_ACTIVE:-0} == 1 ]]; then docker buildx stop "$BUILDER" >/dev/null 2>&1 || true; fi
  if [[ -n ${RUN_DIR:-} && -d $RUN_DIR ]]; then rm -rf -- "$RUN_DIR"; fi
}

restore_nginx() {
  [[ ${NGINX_CHANGED:-0} == 1 ]] || return 0
  if [[ -f $RUN_DIR/nginx.before ]]; then
    install -m 644 "$RUN_DIR/nginx.before" "$NGINX_FILE.quiz-tmp"
    mv -fT "$NGINX_FILE.quiz-tmp" "$NGINX_FILE"
  else
    rm -f -- "$NGINX_FILE"
  fi
  if nginx -t >> "$LOG_FILE" 2>&1; then
    systemctl reload nginx >> "$LOG_FILE" 2>&1 || true
  else
    message WARN 'The prior Quiz configuration was restored, but Nginx could not be reloaded. Check nginx -t.'
  fi
}

on_error() {
  local status=$1 line=$2
  if ((BASH_SUBSHELL > 0)); then trap - ERR; exit "$status"; fi
  trap - ERR INT TERM
  set +e
  if [[ ${MIGRATION_STARTED:-0} == 1 && -f ${CANDIDATE_CONFIG:-} ]]; then
    compose "$CANDIDATE_CONFIG" run --rm --no-deps api php artisan down >> "$LOG_FILE" 2>&1
    compose "$CANDIDATE_CONFIG" stop worker >> "$LOG_FILE" 2>&1
    message WARN 'Quiz remains in maintenance mode. Database migrations are NOT automatically reversed.'
    message WARN "Recovery: sudo bash $ROOT/bin/deploy-vps.sh --status"
    message WARN "Backups: $ROOT/shared/backups. Fix the reported issue and rerun this installer."
  elif [[ ${QUIESCED:-0} == 1 && -f ${OLD_CONFIG:-} ]]; then
    compose "$OLD_CONFIG" exec -T api php artisan up >> "$LOG_FILE" 2>&1
    compose "$OLD_CONFIG" up -d --no-build worker >> "$LOG_FILE" 2>&1
  fi
  if [[ -n ${LOG_FILE:-} ]]; then restore_nginx; fi
  message ERROR "Stopped at stage ${STAGE:-0}, line $line (exit $status)."
  if [[ -n ${LOG_FILE:-} ]]; then message INFO "Private diagnostic log: $LOG_FILE"; fi
  exit "$status"
}

require_ubuntu() {
  local os version
  os=$(awk -F= '$1 == "ID" {gsub(/"/, "", $2); print $2}' /etc/os-release)
  version=$(awk -F= '$1 == "VERSION_ID" {gsub(/"/, "", $2); print $2}' /etc/os-release)
  [[ $os == ubuntu ]] || fail "Ubuntu is required; detected $os. Nothing has been installed."
  case $version in 22.04|24.04|26.04) ;; *) fail "Unsupported Ubuntu version: $version. Supported LTS releases: 22.04, 24.04, 26.04." ;; esac
  message OK "Ubuntu $version · $(uname -m)"
  [[ $(ps -p 1 -o comm=) == systemd ]] || fail 'This installer requires systemd on the VPS.'
}

check_local_docker() {
  local endpoint=${DOCKER_HOST:-}
  if [[ -z $endpoint ]]; then endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}'); fi
  [[ $endpoint == unix:///* ]] || fail 'A local Docker Unix socket is required. Remote Docker contexts are not used by this VPS installer.'
}

check_resources() {
  local available free_kb base=$ROOT
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  message INFO "Memory available: $((available / 1024)) MiB; build limit: 2048 MiB / one CPU."
  ((available >= 3145728)) || fail 'At least 3 GiB available RAM is required before building. Free capacity and retry; no swap is created.'
  while [[ ! -e $base ]]; do base=$(dirname "$base"); done
  free_kb=$(df -Pk "$base" | awk 'END {print $4}')
  ((free_kb >= 8388608)) || fail 'At least 8 GiB free deployment disk space is required.'
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    check_local_docker
    local docker_root
    docker_root=$(docker info --format '{{.DockerRootDir}}')
    free_kb=$(df -Pk "$docker_root" | awk 'END {print $4}')
    ((free_kb >= 8388608)) || fail 'At least 8 GiB free space is required on the Docker storage filesystem.'
  fi
}

check_checkout() {
  [[ ! -e $SOURCE_DIR || -d $SOURCE_DIR/.git ]] || fail "$SOURCE_DIR exists but is not a Git checkout."
  [[ -d $SOURCE_DIR/.git ]] || return 0
  [[ $(git -C "$SOURCE_DIR" symbolic-ref --quiet --short HEAD) == master ]] || fail "Switch $SOURCE_DIR to master before deploying."
  [[ -z $(git -C "$SOURCE_DIR" status --porcelain) ]] || fail 'The VPS checkout has local changes. Commit or move them before deployment; nothing is reset.'
  local remote
  remote=$(git -C "$SOURCE_DIR" remote get-url origin)
  case $remote in "$REPO_URL"|"${REPO_URL%.git}"|git@github.com:SaadiDK-003/quiz_app.git) ;; *) fail 'The existing checkout has an unexpected origin; it will not be changed.' ;; esac
  message OK "Reusing clean master checkout: $SOURCE_DIR"
}

check_ports_and_nginx() {
  local listeners
  if ! command -v ss >/dev/null; then
    message WARN 'iproute2 is missing; listener inspection will run after installing it.'
    return 0
  fi
  listeners=$(ss -H -ltnp '( sport = :80 or sport = :443 )')
  if [[ -n $listeners ]] && printf '%s\n' "$listeners" | grep -v '"nginx"' >/dev/null; then
    fail 'Port 80 or 443 belongs to a service other than host Nginx. No process will be stopped.'
  fi
  if command -v nginx >/dev/null; then
    nginx -t >/dev/null 2>&1 || {
      fail 'Existing Nginx configuration is invalid. Fix it before deployment; the installer will not repair other sites.'
    }
    if command -v python3 >/dev/null; then
      python3 - "$NGINX_FILE" "$DOMAIN" 3< <(nginx -T 2>&1) <<'PY'
import os, re, sys
path = ""
sections = {}
for line in os.fdopen(3, encoding="utf-8"):
    match = re.match(r"# configuration file (.+):\s*$", line)
    if match:
        path = match[1]
    sections.setdefault(path, []).append(line.split("#", 1)[0])
for path, lines in sections.items():
    text = "\n".join(lines)
    for names in re.findall(r"\bserver_name\s+([^;]+);", text):
        if sys.argv[2] in [x.strip("\"'") for x in names.split()] and path != sys.argv[1]:
            sys.exit("An unmanaged Nginx site already declares the Quiz domain: " + path)
if not any(re.search(r"include\s+/etc/nginx/conf\.d/\*\.conf\s*;", "\n".join(lines)) for lines in sections.values()):
    sys.exit("Nginx must already include /etc/nginx/conf.d/*.conf; the global configuration will not be edited.")
PY
      owned_file "$NGINX_FILE"
    else
      message WARN 'python3 is missing; domain collision inspection will run after installing it.'
    fi
    message OK 'Existing Nginx configuration and public listeners checked.'
  fi
}

safe_apt_install() {
  (($#)) || return 0
  local simulation=$RUN_DIR/apt-plan
  if ! apt-get -s --no-install-recommends --no-upgrade install "$@" > "$simulation" 2>&1; then
    cat "$simulation" >> "$LOG_FILE"
    fail 'Required packages could not be resolved without changing existing installations. See the private log.'
  fi
  if grep -Eq '^Remv |^Inst [^ ]+ \[' "$simulation"; then
    fail 'Dependency installation would remove or upgrade installed packages. Resolve this manually; shared infrastructure is unchanged.'
  fi
  run 'Install missing packages only' env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l \
    apt-get -y --no-install-recommends --no-upgrade install "$@"
}

install_dependencies() {
  local missing=() pair command package
  for pair in git:git curl:curl gpg:gnupg python3:python3 openssl:openssl ss:iproute2 flock:util-linux nginx:nginx certbot:certbot; do
    command=${pair%%:*}; package=${pair#*:}
    if command -v "$command" >/dev/null; then message OK "$command already installed; skipped."
    else missing+=("$package"); fi
  done
  if [[ ! -s /etc/ssl/certs/ca-certificates.crt ]]; then missing+=(ca-certificates); fi
  if ((${#missing[@]})); then
    run 'Refresh package metadata' apt-get update
    safe_apt_install "${missing[@]}"
  fi
  if ! command -v docker >/dev/null; then
    local conflict
    for conflict in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
      if dpkg-query -W -f='${Status}' "$conflict" 2>/dev/null | grep -q '^install ok installed$'; then
        fail "Docker installation conflicts with installed $conflict. It will not be removed."
      fi
    done
    message INFO 'Docker is missing; installing from the Docker Ubuntu package repository.'
    install -d -m 755 /etc/apt/keyrings
    [[ ! -e /etc/apt/sources.list.d/webostics-quiz-docker.sources ]] || owned_file /etc/apt/sources.list.d/webostics-quiz-docker.sources
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$RUN_DIR/docker.asc"
    gpg --show-keys --with-colons "$RUN_DIR/docker.asc" | grep -q '9DC858229FC7DD38854AE2D88D81803C0EBFCD88' || fail 'Docker package signing key fingerprint did not match.'
    install -m 644 "$RUN_DIR/docker.asc" /etc/apt/keyrings/webostics-quiz-docker.asc
    local codename arch
    codename=$(awk -F= '$1 == "VERSION_CODENAME" {gsub(/"/, "", $2); print $2}' /etc/os-release)
    arch=$(dpkg --print-architecture)
    cat > /etc/apt/sources.list.d/webostics-quiz-docker.sources <<EOF
# Managed by webostics-quiz
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/webostics-quiz-docker.asc
EOF
    run 'Refresh Docker package metadata' apt-get update
    safe_apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    run 'Enable newly installed Docker' systemctl enable --now docker
  fi
  docker info >/dev/null 2>&1 || fail 'Existing Docker is unavailable. Start/repair it manually; the installer will not restart it.'
  check_local_docker
  if ! docker compose version >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
    run 'Refresh plugin package metadata' apt-get update
    missing=()
    if dpkg-query -W -f='${Status}' docker-ce 2>/dev/null | grep -q '^install ok installed$'; then
      docker compose version >/dev/null 2>&1 || missing+=(docker-compose-plugin)
      docker buildx version >/dev/null 2>&1 || missing+=(docker-buildx-plugin)
    else
      docker compose version >/dev/null 2>&1 || missing+=(docker-compose-v2)
      docker buildx version >/dev/null 2>&1 || missing+=(docker-buildx)
    fi
    safe_apt_install "${missing[@]}"
  fi
  docker compose version >/dev/null && docker buildx version >/dev/null || fail 'Compatible Docker Compose and Buildx plugins are required.'
  if ! systemctl is-active --quiet nginx; then
    [[ -z $(ss -H -ltn '( sport = :80 or sport = :443 )') ]] || fail 'Nginx is inactive while web ports are occupied. Resolve this manually.'
    run 'Start Nginx on free web ports' systemctl start nginx
  fi
}

check_docker_ownership() {
  local id kind name owner
  while IFS= read -r id; do
    [[ -n $id ]] || continue
    owner=$(docker inspect --format '{{index .Config.Labels "org.webostics.quiz.owner"}}' "$id")
    [[ $owner == "$PROJECT" ]] || fail "An unmanaged container already uses Compose project $PROJECT."
  done < <(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  for kind in volume network; do
    local names=("${PROJECT}_default")
    if [[ $kind == volume ]]; then names=("${PROJECT}_database" "${PROJECT}_media" "${PROJECT}_runtime"); fi
    for name in "${names[@]}"; do
      if docker "$kind" inspect "$name" >/dev/null 2>&1; then
        owner=$(docker "$kind" inspect --format '{{index .Labels "org.webostics.quiz.owner"}}' "$name")
        [[ $owner == "$PROJECT" ]] || fail "An unmanaged $kind already uses $name."
        if [[ $kind == volume && $name == "${PROJECT}_database" && ! -f $ROOT/shared/environment.json ]]; then
          fail 'Quiz database storage exists but its production secrets are missing. Restore shared/environment.json before proceeding; keys will not be regenerated for an existing database.'
        fi
      fi
    done
  done
}

select_port() {
  local preferred=18080 candidate id address
  if [[ -f $ROOT/shared/current.json ]]; then preferred=$(json_field "$ROOT/shared/current.json" port); fi
  [[ $preferred =~ ^18[01][0-9][0-9]$ ]] && ((preferred >= 18080 && preferred <= 18179)) || preferred=18080
  for candidate in "$preferred" $(seq 18080 18179); do
    if [[ -z $(ss -H -ltn "sport = :$candidate") ]]; then PORT=$candidate; return; fi
    while IFS= read -r id; do
      [[ -n $id ]] || continue
      address=$(docker inspect --format '{{with (index .NetworkSettings.Ports "80/tcp")}}{{range .}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}' "$id")
      if [[ $address == "127.0.0.1:$candidate" ]]; then PORT=$candidate; return; fi
    done < <(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.service=gateway')
  done
  fail 'No free localhost port exists in 18080–18179. No occupied port will be reclaimed.'
}

fetch_checkout() {
  local username token
  prompt username 'GitHub username (leave empty for anonymous public access)'
  if [[ -n $username ]]; then
    prompt_secret token 'GitHub personal access token (hidden; not your account password)'
    [[ -n $token ]] || fail 'A token is required when specifying a GitHub username.'
    printf '%s' "$username" > "$RUN_DIR/git-user"
    printf '%s' "$token" > "$RUN_DIR/git-token"
    unset token username
    cat > "$RUN_DIR/git-askpass" <<'ASKPASS'
#!/usr/bin/env bash
case $1 in
  *Username*) cat "$QUIZ_CREDENTIAL_DIR/git-user" ;;
  *Password*) cat "$QUIZ_CREDENTIAL_DIR/git-token" ;;
  *) exit 1 ;;
esac
ASKPASS
    chmod 700 "$RUN_DIR/git-askpass"
  else
    printf '#!/bin/sh\nexit 1\n' > "$RUN_DIR/git-askpass"
    chmod 700 "$RUN_DIR/git-askpass"
  fi
  if [[ ! -d $SOURCE_DIR/.git ]]; then
    [[ ! -e $SOURCE_DIR ]] || fail 'Checkout location is occupied.'
    install -d -m 755 "$(dirname "$SOURCE_DIR")"
    run 'Clone Quiz repository' env QUIZ_CREDENTIAL_DIR="$RUN_DIR" GIT_ASKPASS="$RUN_DIR/git-askpass" GIT_TERMINAL_PROMPT=0 \
      git -c credential.helper= clone --branch master --single-branch "$REPO_URL" "$SOURCE_DIR"
  else
    run 'Fetch latest master' env QUIZ_CREDENTIAL_DIR="$RUN_DIR" GIT_ASKPASS="$RUN_DIR/git-askpass" GIT_TERMINAL_PROMPT=0 \
      git -C "$SOURCE_DIR" -c credential.helper= fetch "$REPO_URL" refs/heads/master:refs/remotes/origin/master
    run 'Fast-forward existing master checkout' git -C "$SOURCE_DIR" -c core.hooksPath=/dev/null merge --ff-only origin/master
  fi
  rm -f -- "$RUN_DIR/git-user" "$RUN_DIR/git-token" "$RUN_DIR/git-askpass"
  COMMIT=$(git -C "$SOURCE_DIR" rev-parse HEAD)
  RELEASE=$ROOT/releases/$COMMIT
  [[ ! -L $RELEASE ]] || fail 'The release directory must not be a symlink.'
  if [[ ! -d $RELEASE ]]; then
    install -d -m 755 "$RELEASE"
    git -C "$SOURCE_DIR" archive "$COMMIT" | tar -x -C "$RELEASE"
    printf '%s\n' "$COMMIT" > "$RELEASE/.quiz-release"
  fi
  [[ -f $RELEASE/.quiz-release && $(cat "$RELEASE/.quiz-release") == "$COMMIT" ]] || fail 'Existing release directory is not managed by this installer.'
  message OK "Commit: ${COMMIT:0:12} · master"
}

build_images() {
  if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    [[ -f $ROOT/shared/builder-owned ]] || fail "Builder $BUILDER already exists without a Quiz ownership marker."
  else
    run 'Create resource-limited Quiz builder' docker buildx create --name "$BUILDER" --driver docker-container \
      --driver-opt memory=2g,memory-swap=2g,cpu-period=100000,cpu-quota=100000
    printf '%s\n' "$PROJECT" > "$ROOT/shared/builder-owned"
  fi
  BUILDER_ACTIVE=1
  run 'Start Quiz build worker' docker buildx inspect "$BUILDER" --bootstrap
  local limits
  limits=$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}' "buildx_buildkit_${BUILDER}0")
  [[ $limits == '2147483648 2147483648 100000 100000' ]] || fail 'The Quiz builder does not have the required resource limits; deployment stopped.'
  API_IMAGE=webostics-quiz-api:$COMMIT
  WEB_IMAGE=webostics-quiz-web:$COMMIT
  run 'Build Laravel / PHP 8.4 production image' docker buildx build --builder "$BUILDER" --load \
    --label "org.webostics.quiz.owner=$PROJECT" --label "org.opencontainers.image.revision=$COMMIT" \
    --target production --file "$RELEASE/infrastructure/Dockerfile.api" --tag "$API_IMAGE" "$RELEASE"
  run 'Build Next.js production image' docker buildx build --builder "$BUILDER" --load \
    --label "org.webostics.quiz.owner=$PROJECT" --label "org.opencontainers.image.revision=$COMMIT" \
    --file "$RELEASE/infrastructure/Dockerfile.web" --tag "$WEB_IMAGE" "$RELEASE"
  run 'Stop the idle Quiz build worker' docker buildx stop "$BUILDER"
  BUILDER_ACTIVE=0
}

prepare_environment() {
  if [[ -z $ENV_SOURCE && ! -f $ROOT/shared/environment.json && -f $SOURCE_DIR/apps/api/.env ]]; then
    ENV_SOURCE=$SOURCE_DIR/apps/api/.env
    message INFO 'Using SMTP settings from apps/api/.env in the existing checkout.'
  fi
  if [[ -n $ENV_SOURCE ]]; then
    [[ -f $ENV_SOURCE && -r $ENV_SOURCE ]] || fail 'The supplied SMTP environment file is not readable.'
    cp -- "$ENV_SOURCE" "$RUN_DIR/source.env"
    cat > "$RUN_DIR/parse-env.php" <<'PHP'
<?php
require '/var/www/html/vendor/autoload.php';
try {
    $source = Dotenv\Dotenv::parse(file_get_contents('/input/source.env'));
    $mail = array_filter($source, static fn ($key) => str_starts_with($key, 'MAIL_'), ARRAY_FILTER_USE_KEY);
    file_put_contents('/input/mail.json', json_encode($mail, JSON_THROW_ON_ERROR));
} catch (Throwable $exception) {
    fwrite(STDERR, "Unable to parse the supplied Laravel dotenv file. Check its syntax; values have not been logged.\n");
    exit(1);
}
PHP
    run 'Read SMTP configuration without shell expansion' docker run --rm --network none --memory 128m --cpus .25 \
      --label "org.webostics.quiz.owner=$PROJECT" --entrypoint php --mount "type=bind,source=$RUN_DIR,target=/input" \
      "$API_IMAGE" /input/parse-env.php
    rm -f -- "$RUN_DIR/source.env"
  elif [[ ! -f $ROOT/shared/environment.json ]]; then
    local host port scheme scheme_default=smtp username password sender name
    prompt host 'SMTP host'
    prompt port 'SMTP port' 587
    if [[ $port =~ ^[[:space:]]*465[[:space:]]*$ ]]; then scheme_default=smtps; fi
    prompt scheme 'SMTP scheme (smtp for STARTTLS, smtps for implicit TLS)' "$scheme_default"
    prompt username 'SMTP username (empty if not required)'
    prompt_secret password 'SMTP password (hidden)'
    prompt sender 'Sender email'
    prompt name 'Sender name' 'Little Quest'
    # NUL-delimited input keeps quotes, backslashes, and dollar signs literal.
    printf '%s\0' MAIL_HOST "$host" MAIL_PORT "$port" MAIL_SCHEME "$scheme" MAIL_USERNAME "$username" \
      MAIL_PASSWORD "$password" MAIL_FROM_ADDRESS "$sender" MAIL_FROM_NAME "$name" > "$RUN_DIR/mail.fields"
    unset password username host port scheme sender name
    python3 - "$RUN_DIR/mail.fields" "$RUN_DIR/mail.json" <<'PY'
import json, sys
fields = open(sys.argv[1], "rb").read().split(b"\0")[:-1]
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump(dict(zip([x.decode() for x in fields[::2]], [x.decode() for x in fields[1::2]])), output)
PY
    rm -f -- "$RUN_DIR/mail.fields"
  else
    message OK 'Reusing private production SMTP configuration and stable application/database secrets.'
  fi
}

write_runtime_files() {
  cat > "$DEPLOY_DIR/php.ini" <<'INI'
; Managed by webostics-quiz
expose_php=Off
upload_max_filesize=10M
post_max_size=12M
memory_limit=128M
INI
  cat > "$DEPLOY_DIR/gateway.conf" <<'NGINX'
# Managed by webostics-quiz
server {
    listen 80;
    server_name _;
    client_max_body_size 12m;
    location /storage/ {
        alias /srv/media/;
        add_header X-Content-Type-Options nosniff always;
    }
    location ~ ^/(api(?:/|$)|sanctum(?:/|$)|up$) {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /var/www/html/public/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_param HTTP_PROXY "";
        fastcgi_param HTTP_X_FORWARDED_PROTO $http_x_forwarded_proto;
        fastcgi_param HTTP_X_FORWARDED_FOR $http_x_forwarded_for;
        fastcgi_param HTTP_X_FORWARDED_HOST $host;
        fastcgi_pass api:9000;
        fastcgi_read_timeout 60s;
    }
    location / {
        if (-f /srv/runtime/down) { return 503; }
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-For $http_x_forwarded_for;
    }
}
NGINX
  cat > "$DEPLOY_DIR/backup.sh" <<'BACKUP'
#!/bin/sh
set -eu
umask 077
stamp="quiz-$(date -u +%Y%m%dT%H%M%SZ)-$$"
cleanup() {
  if [ ! -f "/backups/$stamp.complete" ]; then
    rm -f "/backups/$stamp.dump" "/backups/$stamp.media.tar.gz" "/backups/$stamp.dump.tmp" "/backups/$stamp.media.tar.gz.tmp"
  fi
}
trap cleanup EXIT
db_size=$(psql -Atc 'SELECT pg_database_size(current_database())')
media_kb=$(du -sk /media | awk '{print $1}')
free_kb=$(df -Pk /backups | awk 'END {print $4}')
needed_kb=$((db_size / 1024 * 2 + media_kb + 262144))
[ "$free_kb" -ge "$needed_kb" ] || { echo 'Insufficient space for a complete Quiz backup.' >&2; exit 1; }
pg_dump -Fc --file="/backups/$stamp.dump.tmp"
tar -czf "/backups/$stamp.media.tar.gz.tmp" -C /media .
mv "/backups/$stamp.dump.tmp" "/backups/$stamp.dump"
mv "/backups/$stamp.media.tar.gz.tmp" "/backups/$stamp.media.tar.gz"
printf '%s\n' "$stamp" > "/backups/$stamp.complete"
find /backups -maxdepth 1 -type f -name 'quiz-*.complete' -printf '%f\n' | sort -r | tail -n +8 | while IFS= read -r old; do
  old=${old%.complete}
  rm -f -- "/backups/$old.dump" "/backups/$old.media.tar.gz" "/backups/$old.complete"
done
printf 'Complete Quiz database and media backup: %s\n' "$stamp"
BACKUP
  chmod 600 "$DEPLOY_DIR"/*
  generate_compose
}

generate_compose() {
  python3 - "$ROOT" "$DEPLOY_DIR" "$RUN_DIR" "$COMMIT" "$PORT" <<'PY'
import base64, json, os, pathlib, secrets, sys
root, deploy, scratch = map(pathlib.Path, sys.argv[1:4])
commit, port = sys.argv[4], int(sys.argv[5])
project = "webostics_quiz"
environment_file = root / "shared/environment.json"
env = json.loads(environment_file.read_text()) if environment_file.exists() else {}
incoming = scratch / "mail.json"
if incoming.exists():
    # An explicit import replaces the MAIL_* settings, including a formerly set MAIL_URL.
    env = {k: v for k, v in env.items() if not k.startswith("MAIL_")}
    env.update(json.loads(incoming.read_text()))
for key in ("MAIL_HOST", "MAIL_PORT", "MAIL_FROM_ADDRESS"):
    if not env.get(key) or str(env[key]).lower() == "null":
        sys.exit("SMTP configuration is missing " + key)
try:
    mail_port = int(env["MAIL_PORT"])
    assert 1 <= mail_port <= 65535
except (ValueError, AssertionError):
    sys.exit("MAIL_PORT must be between 1 and 65535.")
env["MAIL_PORT"] = str(mail_port)
if env.get("MAIL_SCHEME") in (None, "", "null"):
    env["MAIL_SCHEME"] = "smtps" if mail_port == 465 else "smtp"
if mail_port == 465 and env.get("MAIL_SCHEME") == "smtp":
    print("[WARN]  SMTP port 465 uses implicit TLS; selecting MAIL_SCHEME=smtps.")
    env["MAIL_SCHEME"] = "smtps"
if env["MAIL_SCHEME"] not in ("smtp", "smtps"):
    sys.exit("MAIL_SCHEME must be smtp or smtps.")
env.setdefault("APP_KEY", "base64:" + base64.b64encode(secrets.token_bytes(32)).decode())
env.setdefault("DB_PASSWORD", secrets.token_hex(32))
env.update(APP_NAME="Little Quest", APP_ENV="production", APP_DEBUG="false", APP_URL="https://quiz.webostics.com",
           LOG_CHANNEL="stderr", LOG_LEVEL="warning", DB_CONNECTION="pgsql", DB_HOST="database", DB_PORT="5432",
           DB_DATABASE="quiz", DB_USERNAME="quiz", SESSION_DRIVER="database", SESSION_SECURE_COOKIE="true",
           SESSION_DOMAIN="null", SESSION_COOKIE="webostics_quiz_session", SESSION_SAME_SITE="lax",
           SANCTUM_STATEFUL_DOMAINS="quiz.webostics.com", CACHE_STORE="database", QUEUE_CONNECTION="database", MAIL_MAILER="smtp")
env.setdefault("MAIL_FROM_NAME", "Little Quest")
# Compose interpolates JSON string values too. $$ preserves every literal dollar.
def literal(values):
    return {k: str(v).replace("$", "$$") for k, v in values.items() if v is not None}
labels = {"org.webostics.quiz.owner": project}
logging = {"driver": "json-file", "options": {"max-size": "10m", "max-file": "3"}}
api = {"image": "webostics-quiz-api:" + commit, "entrypoint": ["docker-php-entrypoint"], "command": ["php-fpm"],
       "environment": literal(env), "restart": "unless-stopped", "labels": labels, "logging": logging,
       "mem_limit": "512m", "cpus": 0.5,
       "volumes": ["media:/var/www/html/storage/app/public", "runtime:/var/www/html/storage/framework",
                   str(deploy / "php.ini") + ":/usr/local/etc/php/conf.d/quiz.ini:ro"]}
worker = dict(api, command=["php", "artisan", "queue:work", "--sleep=3", "--tries=3", "--timeout=60", "--max-time=3600"],
              mem_limit="256m", cpus=0.25)
api["healthcheck"] = {"test": ["CMD", "php", "-r", "exit(@fsockopen('127.0.0.1',9000) ? 0 : 1);"], "interval": "10s", "timeout": "5s", "retries": 12}
services = {
    "database": {"image": "postgres:18", "restart": "unless-stopped", "labels": labels, "logging": logging,
                 "mem_limit": "512m", "cpus": 0.5, "shm_size": "128m",
                 "environment": literal({"POSTGRES_DB": "quiz", "POSTGRES_USER": "quiz", "POSTGRES_PASSWORD": env["DB_PASSWORD"]}),
                 "volumes": ["database:/var/lib/postgresql"],
                 "healthcheck": {"test": ["CMD-SHELL", "pg_isready -U quiz -d quiz"], "interval": "5s", "timeout": "5s", "retries": 30}},
    "api": api, "worker": worker,
    "web": {"image": "webostics-quiz-web:" + commit, "restart": "unless-stopped", "labels": labels, "logging": logging,
            "mem_limit": "512m", "cpus": 0.5,
            "healthcheck": {"test": ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], "interval": "10s", "timeout": "5s", "retries": 12}},
    "gateway": {"image": "nginx:stable-alpine", "restart": "unless-stopped", "labels": labels, "logging": logging,
                "mem_limit": "64m", "cpus": 0.1, "ports": [f"127.0.0.1:{port}:80"],
                "volumes": [str(deploy / "gateway.conf") + ":/etc/nginx/conf.d/default.conf:ro", "media:/srv/media:ro", "runtime:/srv/runtime:ro"]},
    "backup": {"image": "postgres:18", "profiles": ["tools"], "labels": labels, "logging": logging,
               "mem_limit": "256m", "cpus": 0.25, "entrypoint": ["/bin/sh", "/quiz-backup.sh"],
               "environment": literal({"PGHOST": "database", "PGUSER": "quiz", "PGPASSWORD": env["DB_PASSWORD"], "PGDATABASE": "quiz"}),
               "volumes": [str(root / "shared/backups") + ":/backups", "media:/media:ro", str(deploy / "backup.sh") + ":/quiz-backup.sh:ro"]}
}
config = {"name": project, "services": services,
          "volumes": {name: {"labels": labels} for name in ("database", "media", "runtime")},
          "networks": {"default": {"labels": labels}}}
for name, data in (("compose.json", config), ("environment.json", env)):
    path = deploy / name
    path.write_text(json.dumps(data, indent=2) + "\n")
    path.chmod(0o600)
# PostgreSQL only consumes POSTGRES_PASSWORD when its volume is first created.
# Retain the keys before starting it, including when a later initial step fails.
if not environment_file.exists():
    environment_file.write_text(json.dumps(env, indent=2) + "\n")
    environment_file.chmod(0o600)
PY
}

wait_database() {
  local i
  message INFO 'Waiting for Quiz PostgreSQL readiness…'
  for i in {1..60}; do
    if compose "$CANDIDATE_CONFIG" exec -T database pg_isready -U quiz -d quiz >/dev/null 2>&1; then message OK 'Quiz PostgreSQL is ready.'; return; fi
    sleep 2
  done
  fail 'Quiz PostgreSQL did not become ready.'
}

backup_quiz() {
  local config=$1
  run 'Back up Quiz database and media (retain seven complete pairs)' compose "$config" --profile tools run --rm --no-deps backup
}

service_diagnostics() {
  local config=$1 service=$2 id=$3 summary
  summary=$(docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$id")
  message WARN "Quiz $service: $summary"
  if [[ -n ${LOG_FILE:-} ]]; then
    printf '\n--- Quiz %s startup diagnostics ---\n' "$service" >> "$LOG_FILE"
    docker inspect --format '{{if .State.Health}}{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}{{end}}' "$id" >> "$LOG_FILE" 2>&1 || true
    compose "$config" logs --no-color --tail 60 "$service" >> "$LOG_FILE" 2>&1 || true
  fi
}

wait_service() {
  local config=$1 service=$2 id state lifecycle restarts i
  id=$(compose "$config" ps --all -q "$service")
  [[ -n $id ]] || fail "Quiz $service container is missing."
  message INFO "Waiting for Quiz $service readiness…"
  for i in {1..90}; do
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
    if [[ $state == healthy || $state == running ]]; then message OK "Quiz $service is ready."; return 0; fi
    lifecycle=$(docker inspect --format '{{.State.Status}}' "$id")
    restarts=$(docker inspect --format '{{.RestartCount}}' "$id")
    if [[ $lifecycle == exited || $lifecycle == dead || $state == unhealthy ]] || \
      { [[ $lifecycle == restarting ]] && ((restarts >= 3)); }; then
      service_diagnostics "$config" "$service" "$id"
      fail "Quiz $service failed startup. Container and health-check details are in the private deployment log."
    fi
    sleep 2
  done
  service_diagnostics "$config" "$service" "$id"
  fail "Quiz $service did not become healthy."
}

activate_application() {
  if [[ -n $OLD_CONFIG ]]; then
    local old_api
    old_api=$(compose "$OLD_CONFIG" ps --all -q api)
    if [[ -n $old_api ]]; then
      run 'Pause only Quiz for the update' compose "$OLD_CONFIG" run --rm --no-deps api php artisan down
      QUIESCED=1
      run 'Pause Quiz queue worker' compose "$OLD_CONFIG" stop worker
    fi
  fi
  run 'Start Quiz-only PostgreSQL' compose "$CANDIDATE_CONFIG" up -d --no-build database
  wait_database
  run 'Prepare Quiz-owned writable volumes' compose "$CANDIDATE_CONFIG" run --rm --no-deps api sh -c \
    'mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/app/public && chown -R www-data:www-data storage/framework storage/app/public'
  backup_quiz "$CANDIDATE_CONFIG"
  MIGRATION_STARTED=1
  run 'Hold Quiz in maintenance during migrations' compose "$CANDIDATE_CONFIG" run --rm --no-deps api php artisan down
  run 'Apply Laravel migrations explicitly' compose "$CANDIDATE_CONFIG" run --rm --no-deps api php artisan migrate --force
  if [[ ! -f $ROOT/shared/seeded ]]; then
    run 'Prepare the reviewed-content workflow with draft questions' compose "$CANDIDATE_CONFIG" run --rm --no-deps api php artisan db:seed --force
    touch "$ROOT/shared/seeded"
  fi
  run 'Start Laravel and Next.js' compose "$CANDIDATE_CONFIG" up -d --no-build api web
  wait_service "$CANDIDATE_CONFIG" api
  wait_service "$CANDIDATE_CONFIG" web
  run 'Cache Laravel production configuration' compose "$CANDIDATE_CONFIG" exec -T api php artisan config:cache
  local bind_attempt old_port
  for bind_attempt in 1 2 3; do
    if run 'Start Quiz-only HTTP gateway' compose "$CANDIDATE_CONFIG" up -d --no-build gateway; then break; fi
    ((bind_attempt < 3)) || fail 'The Quiz gateway could not bind a port after three attempts.'
    old_port=$PORT
    select_port
    [[ $PORT != "$old_port" ]] || fail 'Gateway startup failed for a reason other than an occupied port. See the private log.'
    message WARN "Port $old_port became occupied; retrying only Quiz on 127.0.0.1:$PORT."
    generate_compose
    compose "$CANDIDATE_CONFIG" --profile tools config --quiet
  done
  wait_service "$CANDIDATE_CONFIG" gateway
  run 'Leave Quiz maintenance mode' compose "$CANDIDATE_CONFIG" exec -T api php artisan up
  local i
  for i in {1..30}; do
    if curl -fsS --max-time 5 -H "Host: $DOMAIN" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/up" >/dev/null 2>&1; then break; fi
    if ((i % 10 == 0)); then message INFO "Waiting for Laravel health ($i/30)…"; fi
    sleep 2
  done
  curl -fsS --max-time 10 -H "Host: $DOMAIN" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/up" >/dev/null || fail 'Laravel health did not become ready.'
  curl -fsS --max-time 10 -H "Host: $DOMAIN" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/" >/dev/null
  [[ $(curl -sS --max-time 10 -o "$RUN_DIR/session.json" -w '%{http_code}' -H "Host: $DOMAIN" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/api/v1/session") == 401 ]] || fail 'The Quiz API did not return the expected guest response.'
  python3 - "$RUN_DIR/session.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    assert isinstance(json.load(source).get("message"), str), "Expected a JSON API response."
PY
}

write_host_nginx() {
  local mode=$1
  python3 - "$DEPLOY_DIR/host-nginx.conf" "$DOMAIN" "$ROOT/acme" "$PORT" "$mode" <<'PY'
import pathlib, sys
path, domain, webroot, port, mode = sys.argv[1:]
ipv6_flag = pathlib.Path('/proc/sys/net/ipv6/conf/all/disable_ipv6')
ipv6 = ipv6_flag.exists() and ipv6_flag.read_text().strip() == '0'
http_v6 = '    listen [::]:80;\n' if ipv6 else ''
tls_v6 = '    listen [::]:443 ssl;\n' if ipv6 else ''
http = f'''# Managed by webostics-quiz
server {{
    listen 80;
{http_v6}\
    server_name {domain};
    location ^~ /.well-known/acme-challenge/ {{ root {webroot}; }}
    location / {{ {'return 301 https://$host$request_uri;' if mode == 'tls' else 'return 503;'} }}
}}
'''
tls = f'''server {{
    listen 443 ssl;
{tls_v6}\
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 12m;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Frame-Options DENY always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }}
}}
'''
with open(path, "w") as output:
    output.write(http + (tls if mode == "tls" else ""))
PY
}

apply_nginx() {
  owned_file "$NGINX_FILE"
  install -m 644 "$DEPLOY_DIR/host-nginx.conf" "$NGINX_FILE.quiz-tmp"
  mv -fT "$NGINX_FILE.quiz-tmp" "$NGINX_FILE"
  NGINX_CHANGED=1
  run 'Validate Nginx before graceful reload' nginx -t
  run 'Gracefully reload Nginx; keep existing connections' systemctl reload nginx
}

ensure_https() {
  local cert=/etc/letsencrypt/live/$DOMAIN/fullchain.pem email challenge token response
  if [[ -f $cert ]] && openssl x509 -in "$cert" -noout -checkend 604800 >/dev/null 2>&1 && \
    openssl x509 -in "$cert" -noout -checkhost "$DOMAIN" >/dev/null 2>&1; then
    message OK 'Reusing the valid certificate for the Quiz domain.'
  else
    if [[ -f $cert ]]; then
      local domains
      domains=$(openssl x509 -in "$cert" -noout -ext subjectAltName | grep -oE 'DNS:[^,[:space:]]+' | sed 's/^DNS://' | sort -u)
      [[ $domains == "$DOMAIN" ]] || fail 'The existing certificate covers other domains. Renew it through its current management process; its domain list will not be changed.'
    fi
    getent ahosts "$DOMAIN" >/dev/null || fail "DNS does not resolve for $DOMAIN."
    write_host_nginx bootstrap
    apply_nginx
    token=$(openssl rand -hex 16)
    challenge=$ROOT/acme/.well-known/acme-challenge/quiz-$token
    printf '%s' "$token" > "$challenge"
    chmod 644 "$challenge"
    response=$(curl -fsS --connect-timeout 10 --max-time 20 "http://$DOMAIN/.well-known/acme-challenge/quiz-$token") || fail 'HTTP challenge probe failed. Check DNS, IPv6 records, proxy settings, and inbound port 80; no firewall is changed.'
    [[ $response == "$token" ]] || fail 'The domain does not serve the Quiz ACME webroot on this VPS.'
    rm -f -- "$challenge"
    prompt email 'SSL renewal contact email'
    [[ $email == *@*.* ]] || fail 'A valid SSL contact email is required.'
    message INFO 'Certbot will use its normal interactive account/terms prompts. Nginx stays running.'
    certbot certonly --webroot --webroot-path "$ROOT/acme" --cert-name "$DOMAIN" \
      --domain "$DOMAIN" --email "$email" --keep-until-expiring
  fi
  write_host_nginx tls
  apply_nginx
  curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/up" >/dev/null
  curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" >/dev/null
  message OK "HTTPS is serving $DOMAIN."
}

install_owned_unit() {
  local path=$1 source=$2
  owned_file "$path"
  install -m 644 "$source" "$path"
}

schedule_maintenance() {
  if [[ $(readlink -f "${BASH_SOURCE[0]}") != "$ROOT/bin/deploy-vps.sh" ]]; then
    install -m 700 "${BASH_SOURCE[0]}" "$ROOT/bin/deploy-vps.sh"
  fi
  cat > "$DEPLOY_DIR/backup.service" <<EOF
# Managed by webostics-quiz
[Unit]
Description=Quiz database and media backup
After=docker.service
[Service]
Type=oneshot
ExecStart=/bin/bash $ROOT/bin/deploy-vps.sh --backup
UMask=0077
Restart=on-failure
RestartSec=15min
EOF
  cat > "$DEPLOY_DIR/backup.timer" <<'UNIT'
# Managed by webostics-quiz
[Unit]
Description=Daily Quiz backup
[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  install_owned_unit /etc/systemd/system/webostics-quiz-backup.service "$DEPLOY_DIR/backup.service"
  install_owned_unit /etc/systemd/system/webostics-quiz-backup.timer "$DEPLOY_DIR/backup.timer"
  local hook=/etc/letsencrypt/renewal-hooks/deploy/webostics-quiz
  install -d -m 755 "$(dirname "$hook")"
  owned_file "$hook"
  cat > "$DEPLOY_DIR/renew-hook" <<EOF
#!/bin/sh
# Managed by webostics-quiz
set -eu
[ "\${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/$DOMAIN" ] || exit 0
nginx -t && systemctl reload nginx
EOF
  install -m 755 "$DEPLOY_DIR/renew-hook" "$hook"
  if ! systemctl is-active --quiet certbot.timer && ! systemctl is-active --quiet snap.certbot.renew.timer; then
    cat > "$DEPLOY_DIR/renew.service" <<EOF
# Managed by webostics-quiz
[Unit]
Description=Renew only the Quiz certificate
[Service]
Type=oneshot
ExecStart=$(command -v certbot) renew --cert-name $DOMAIN --quiet
EOF
    cat > "$DEPLOY_DIR/renew.timer" <<'UNIT'
# Managed by webostics-quiz
[Unit]
Description=Quiz-only certificate renewal
[Timer]
OnCalendar=*-*-* 00,12:15:00 UTC
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
UNIT
    install_owned_unit /etc/systemd/system/webostics-quiz-renew.service "$DEPLOY_DIR/renew.service"
    install_owned_unit /etc/systemd/system/webostics-quiz-renew.timer "$DEPLOY_DIR/renew.timer"
    ENABLE_RENEW=1
  else
    message OK 'Existing Certbot renewal scheduling preserved.'
  fi
  run 'Load only the new Quiz systemd definitions' systemctl daemon-reload
  run 'Enable daily Quiz backups' systemctl enable --now webostics-quiz-backup.timer
  if [[ ${ENABLE_RENEW:-0} == 1 ]]; then run 'Enable Quiz-only certificate renewal' systemctl enable --now webostics-quiz-renew.timer; fi
}

publish_state() {
  install -m 600 "$DEPLOY_DIR/environment.json" "$ROOT/shared/environment.json.tmp"
  mv -fT "$ROOT/shared/environment.json.tmp" "$ROOT/shared/environment.json"
  python3 - "$ROOT/shared/current.json" "$CANDIDATE_CONFIG" "$COMMIT" "$PORT" <<'PY'
import json, os, pathlib, sys
path = pathlib.Path(sys.argv[1])
temp = path.with_suffix(".tmp")
temp.write_text(json.dumps({"project": "webostics_quiz", "config": sys.argv[2], "commit": sys.argv[3], "port": int(sys.argv[4])}, indent=2) + "\n")
temp.chmod(0o600)
os.replace(temp, path)
PY
  MIGRATION_STARTED=0
  QUIESCED=0
  NGINX_CHANGED=0
  rm -f -- "$ROOT/shared/pending.json"
}

current_config() {
  check_workdir_ownership
  [[ -f $ROOT/.managed-by-webostics-quiz && ! -L $ROOT ]] || fail 'No managed Quiz deployment was found.'
  local state=$ROOT/shared/current.json
  if [[ ! -f $state && -f $ROOT/shared/pending.json ]]; then
    state=$ROOT/shared/pending.json
    message WARN 'Showing the last incomplete Quiz deployment; consult its private log before retrying.'
  fi
  [[ -f $state ]] || fail 'No Quiz deployment configuration was found. Consult the last deployment log.'
  OLD_CONFIG=$(json_field "$state" config)
  [[ $OLD_CONFIG == "$ROOT/shared/deployments/"*/compose.json && -f $OLD_CONFIG ]] || fail 'The saved Quiz configuration is invalid.'
  [[ $(realpath "$OLD_CONFIG") == "$ROOT/shared/deployments/"*/compose.json ]] || fail 'The saved configuration resolves outside the managed deployment directory.'
}

setup_workdir() {
  check_workdir_ownership
  if [[ -d $ROOT ]]; then
    [[ -f $ROOT/.managed-by-webostics-quiz ]] || fail "$ROOT already exists without an installer ownership marker."
  else
    install -d -m 755 "$ROOT"
    printf '%s\n' "$PROJECT" > "$ROOT/.managed-by-webostics-quiz"
  fi
  install -d -m 700 "$ROOT/shared" "$ROOT/shared/logs" "$ROOT/shared/backups" "$ROOT/shared/deployments" "$ROOT/shared/tmp"
  install -d -m 755 "$ROOT/bin" "$ROOT/releases" "$ROOT/acme" "$ROOT/acme/.well-known" "$ROOT/acme/.well-known/acme-challenge"
  exec 9> "$ROOT/shared/deploy.lock"
  flock -n 9 || fail 'Another Quiz deployment or backup is in progress. Retry later.'
  RUN_DIR=$(mktemp -d "$ROOT/shared/tmp/run.XXXXXX")
  LOG_FILE=$ROOT/shared/logs/$(date -u +%Y%m%dT%H%M%SZ)-$MODE-$$.log
  touch "$LOG_FILE"
  chmod 600 "$LOG_FILE"
  if [[ $(readlink -f "${BASH_SOURCE[0]}") != "$ROOT/bin/deploy-vps.sh" ]]; then
    install -m 700 "${BASH_SOURCE[0]}" "$ROOT/bin/deploy-vps.sh.tmp"
    mv -fT "$ROOT/bin/deploy-vps.sh.tmp" "$ROOT/bin/deploy-vps.sh"
  fi
  # Bounded, Quiz-only diagnostic log retention.
  find "$ROOT/shared/logs" -regextype posix-extended -maxdepth 1 -type f \
    -regex '.*/[0-9]{8}T[0-9]{6}Z-(deploy|backup)-[0-9]+\.log' -mtime +30 -delete
}

main() {
  set +x
  set -Eeuo pipefail
  umask 077
  ROOT=/opt/webostics-quiz
  SOURCE_DIR=/var/www/html/quiz_app
  PROJECT=webostics_quiz
  DOMAIN=quiz.webostics.com
  REPO_URL=https://github.com/SaadiDK-003/quiz_app.git
  BUILDER=webostics-quiz-builder
  NGINX_FILE=/etc/nginx/conf.d/webostics-quiz.conf
  MODE=deploy ENV_SOURCE='' LOG_FILE='' RUN_DIR='' TASK_PID='' OLD_CONFIG='' CANDIDATE_CONFIG=''
  STAGE=0 MIGRATION_STARTED=0 QUIESCED=0 NGINX_CHANGED=0 ENABLE_RENEW=0 FIRST_DEPLOY=1 BUILDER_ACTIVE=0
  C_BLUE='' C_GREEN='' C_YELLOW='' C_RED='' C_RESET=''
  if [[ -t 1 && -z ${NO_COLOR:-} && ${TERM:-dumb} != dumb ]]; then
    C_BLUE=$'\033[1;36m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
  fi
  local selected_mode=0
  while (($#)); do
    case $1 in
      --check|--status|--logs|--backup)
        ((selected_mode == 0)) || fail 'Select only one operation.'
        MODE=${1#--}; selected_mode=1; shift ;;
      --env-file) (($# >= 2)) || fail '--env-file requires a path.'; ENV_SOURCE=$2; shift 2 ;;
      --help|-h) usage; return 0 ;;
      *) usage >&2; fail "Unknown argument: $1" ;;
    esac
  done
  if [[ -n $ENV_SOURCE ]]; then
    [[ -f $ENV_SOURCE && -r $ENV_SOURCE ]] || fail 'The supplied SMTP environment file is not readable.'
    ENV_SOURCE=$(realpath "$ENV_SOURCE")
  fi
  ((EUID == 0)) || fail 'Run with sudo or as root. Use --help for commands.'
  if [[ $MODE == deploy ]]; then
    if ! ( : < /dev/tty ) 2>/dev/null; then fail 'Deployment requires an interactive terminal for GitHub, SMTP, and Certbot prompts.'; fi
  fi
  trap cleanup EXIT
  trap 'on_error $? $LINENO' ERR
  trap 'on_error 130 $LINENO' INT
  trap 'on_error 143 $LINENO' TERM
  printf '\n%s╭──────────────────────────────────────────────────╮\n│  LITTLE QUEST · shared VPS deployer              │\n╰──────────────────────────────────────────────────╯%s\n' "$C_BLUE" "$C_RESET"
  message INFO "Domain: $DOMAIN · repository: SaadiDK-003/quiz_app · branch: master"
  message INFO "Checkout: $SOURCE_DIR · private runtime: $ROOT"
  if [[ $MODE == check ]]; then
    check_workdir_ownership
    require_ubuntu
    check_resources
    if command -v git >/dev/null; then check_checkout; else message WARN 'Missing: git'; fi
    check_ports_and_nginx
    local tool
    for tool in git curl gpg python3 openssl ss flock nginx certbot docker; do
      if command -v "$tool" >/dev/null; then message OK "$tool found"; else message WARN "Missing: $tool"; fi
    done
    if command -v docker >/dev/null; then
      docker info >/dev/null 2>&1 || fail 'Existing Docker is unavailable; it will not be restarted.'
      check_local_docker
      docker compose version || fail 'Docker Compose plugin is required.'
      docker buildx version || fail 'Docker Buildx plugin is required.'
      check_docker_ownership
      if command -v ss >/dev/null; then select_port; message INFO "Proposed Quiz localhost port: $PORT"; fi
    fi
    message OK 'Read-only preflight finished. No packages, checkout, services, or Nginx files were changed.'
    return 0
  fi
  if [[ $MODE == status || $MODE == logs ]]; then
    current_config
    check_docker_ownership
    if [[ $MODE == logs ]]; then compose "$OLD_CONFIG" logs --tail 100 -f api web gateway worker
    else
      compose "$OLD_CONFIG" ps
      systemctl list-timers --all webostics-quiz-backup.timer webostics-quiz-renew.timer --no-pager
      message INFO "Configuration: $OLD_CONFIG"
      message INFO "Logs: $ROOT/shared/logs · paired backups: $ROOT/shared/backups"
    fi
    return 0
  fi
  if [[ $MODE == backup ]]; then
    current_config
    setup_workdir
    check_docker_ownership
    backup_quiz "$OLD_CONFIG"
    return 0
  fi
  step 'Preflight and ownership checks'
  require_ubuntu
  check_resources
  if command -v git >/dev/null; then check_checkout; fi
  setup_workdir
  step 'Install missing dependencies; preserve existing infrastructure'
  check_ports_and_nginx
  install_dependencies
  check_ports_and_nginx
  check_docker_ownership
  check_resources
  select_port
  message OK "Quiz ingress: 127.0.0.1:$PORT; other application ports remain allocated to their owners."
  if [[ -f $NGINX_FILE ]]; then cp "$NGINX_FILE" "$RUN_DIR/nginx.before"; fi
  if [[ -f $ROOT/shared/current.json ]]; then FIRST_DEPLOY=0; fi
  if [[ -f $ROOT/shared/current.json || -f $ROOT/shared/pending.json ]]; then current_config; fi
  step 'Update the existing master checkout'
  fetch_checkout
  step 'Build isolated, commit-tagged production images'
  build_images
  step 'Prepare private production configuration'
  prepare_environment
  # Builds can take several minutes; recheck the allocation before creating containers.
  select_port
  DEPLOY_DIR=$(mktemp -d "$ROOT/shared/deployments/$(date -u +%Y%m%dT%H%M%SZ)-${COMMIT:0:12}.XXXXXX")
  CANDIDATE_CONFIG=$DEPLOY_DIR/compose.json
  write_runtime_files
  run 'Validate generated Compose configuration without printing secrets' compose "$CANDIDATE_CONFIG" --profile tools config --quiet
  python3 - "$ROOT/shared/pending.json" "$CANDIDATE_CONFIG" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"config": sys.argv[2]}) + "\n")
path.chmod(0o600)
PY
  run 'Pull only Quiz infrastructure images' compose "$CANDIDATE_CONFIG" --profile tools pull database gateway backup
  step 'Back up, migrate, and start only Quiz'
  activate_application
  step 'Configure the Quiz virtual host and HTTPS'
  ensure_https
  step 'Resume Quiz jobs and schedule private backups'
  run 'Start Quiz queue worker' compose "$CANDIDATE_CONFIG" up -d --no-build worker
  wait_service "$CANDIDATE_CONFIG" worker
  if [[ $FIRST_DEPLOY == 1 ]]; then backup_quiz "$CANDIDATE_CONFIG"; fi
  schedule_maintenance
  step 'Record the successful deployment'
  publish_state
  if [[ $FIRST_DEPLOY == 1 ]]; then
    local admin_email
    prompt admin_email 'Initial Quiz administrator email (empty to set up later)'
    if [[ -n $admin_email ]]; then
      message INFO 'Laravel will ask for the new administrator password interactively.'
      compose "$CANDIDATE_CONFIG" exec api php artisan pilot:admin "$admin_email" || message WARN 'Administrator setup was not completed. Use the command below to retry.'
    fi
  fi
  step 'Ready'
  message OK "Live at https://$DOMAIN · commit ${COMMIT:0:12}"
  message INFO 'Daily backups: 02:30 UTC / 07:30 Pakistan time; latest seven complete pairs retained.'
  message INFO "Status: sudo bash $ROOT/bin/deploy-vps.sh --status"
  message INFO "Logs:   sudo bash $ROOT/bin/deploy-vps.sh --logs"
  message INFO "Backup: sudo bash $ROOT/bin/deploy-vps.sh --backup"
  message INFO "Admin: docker compose --env-file /dev/null -p $PROJECT -f $CANDIDATE_CONFIG exec api php artisan pilot:admin YOUR_EMAIL"
  message INFO "Private deployment log: $LOG_FILE"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
