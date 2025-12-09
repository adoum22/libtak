#!/usr/bin/env bash
# Render Build Script for Django Backend
# This script is executed during Render deployment

set -o errexit  # Exit on error

echo "=== Installing Python dependencies ==="
cd backend
pip install --upgrade pip
pip install -r requirements.txt

echo "=== Collecting static files ==="
python manage.py collectstatic --noinput

echo "=== Running database migrations ==="
python manage.py migrate --noinput

echo "=== Creating default users ==="
python create_users.py || echo "Users already exist or creation failed (non-critical)"

echo "=== Build complete ==="
