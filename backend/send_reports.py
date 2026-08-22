#!/usr/bin/env python
"""Compatibility entry point for scheduled LibTak reports.

All scheduling, locking, period calculations and backup handling live in the
``send_scheduled_reports`` Django management command. Keeping this tiny wrapper
allows existing cron/Task Scheduler entries to continue working without
maintaining a second, divergent reporting implementation.
"""

import argparse
import os
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.core.management import call_command


def main(argv=None):
    parser = argparse.ArgumentParser(description='Exécuter les rapports LibTak dus')
    parser.add_argument('--force-all', action='store_true')
    parser.add_argument('--skip-backup', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument(
        '--daily-slot',
        action='store_true',
        help='À utiliser si le planificateur ne lance ce script qu’une fois par jour.',
    )
    args = parser.parse_args(argv)

    command_args = []
    for option in ('force_all', 'skip_backup', 'dry_run', 'daily_slot'):
        if getattr(args, option):
            command_args.append(f"--{option.replace('_', '-')}")
    call_command('send_scheduled_reports', *command_args)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
