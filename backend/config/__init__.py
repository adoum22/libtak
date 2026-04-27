# Celery est optionnel. Sur les hébergements free tier (ex: PythonAnywhere
# sans broker Redis disponible), celery n'est pas installé et son import
# fait planter Django au démarrage. On le rend tolérant : si l'import
# échoue, l'app continue à tourner normalement, simplement sans worker
# asynchrone (les tâches @shared_task sont appelées synchroniquement par
# le management command send_scheduled_reports).
try:
    from .celery import app as celery_app  # noqa: F401
    __all__ = ('celery_app',)
except ImportError:
    __all__ = ()
