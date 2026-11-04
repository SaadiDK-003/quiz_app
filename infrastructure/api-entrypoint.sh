#!/bin/sh
set -eu
if [ "${1:-}" = "php-fpm" ]; then
 php artisan migrate --force
fi
exec "$@"
