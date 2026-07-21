#!/usr/bin/env python
"""Command-line entry point for the canonical LibTak sync service.

Configuration is read exclusively from ``CLOUD_API_URL``, ``SYNC_TOKEN`` and
optionally ``SYNC_ORIGIN_ID``/``SYNC_ORIGIN_FILE``/``SYNC_STATE_FILE``.  There
is deliberately no embedded URL or authentication fallback.
"""

import argparse
import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from core.sync_service import sync_service


def _print_result(label, result):
    print(f'{label}: {json.dumps(result, ensure_ascii=False, indent=2, default=str)}')


def sync_to_cloud():
    """Push pending records with protocol-v1 per-record acknowledgements."""
    result = sync_service.push_to_cloud()
    _print_result('push', result)
    return result.get('status') == 'success'


def pull_master_data():
    """Pull cloud master data with the same authenticated protocol."""
    result = sync_service.pull_from_cloud()
    _print_result('pull', result)
    return result.get('status') == 'success'


def full_sync():
    result = sync_service.full_sync()
    _print_result('sync', result)
    return all(part.get('status') == 'success' for part in (result['push'], result['pull']))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Synchronisation LibTak')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--pull', action='store_true', help='Récupérer les données maîtres')
    mode.add_argument('--full', action='store_true', help='Exécuter push puis pull')
    mode.add_argument('--push', action='store_true', help='Envoyer les données locales')
    args = parser.parse_args(argv)

    if args.pull:
        success = pull_master_data()
    elif args.full:
        success = full_sync()
    else:
        success = sync_to_cloud()
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
