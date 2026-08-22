"""Periodic security maintenance tasks."""

from celery import shared_task

from .security import purge_expired_refresh_tokens


@shared_task
def purge_expired_jwt_tokens():
    return purge_expired_refresh_tokens()
