#!/bin/sh

set -eu

if [ "${DATABASE:-}" = "postgres" ]; then
    : "${SQL_HOST:?SQL_HOST is required for PostgreSQL}"
    : "${SQL_PORT:?SQL_PORT is required for PostgreSQL}"
    echo "Waiting for postgres..."

    while ! nc -z "$SQL_HOST" "$SQL_PORT"; do
        sleep 1
    done

    echo "PostgreSQL started"
fi

# Apply database migrations
echo "Apply database migrations"
python manage.py migrate --noinput

# Collect static files
echo "Collect static files"
python manage.py collectstatic --noinput

exec "$@"
