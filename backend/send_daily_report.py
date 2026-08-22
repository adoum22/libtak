#!/usr/bin/env python
"""Compatibility wrapper for legacy daily cron entries.

The canonical scheduler computes authoritative revenue/profit, configured
recipients and exact calendar periods. ``--daily-slot`` is intended for hosts
that can invoke only one command per day.
"""

import os
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.core.management import call_command


if __name__ == '__main__':
    call_command('send_scheduled_reports', '--daily-slot')
