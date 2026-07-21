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

echo "=== Build complete ==="
