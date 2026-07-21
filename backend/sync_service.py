#!/usr/bin/env python
"""Compatibility entry point for scheduled jobs.

All synchronization behavior lives in ``core.sync_service``.  This file is
kept so existing Task Scheduler entries continue to work without maintaining a
second protocol implementation.
"""

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


def run_sync():
    result = sync_service.push_to_cloud()
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return result.get('status') == 'success'


if __name__ == '__main__':
    raise SystemExit(0 if run_sync() else 1)
