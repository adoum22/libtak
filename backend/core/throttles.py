import hashlib

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class LoginAccountRateThrottle(SimpleRateThrottle):
    """Limit credential guessing by normalized account and source address."""

    scope = 'login_account'

    def get_cache_key(self, request, view):
        if getattr(settings, 'TESTING', False):
            return None

        username = str(
            request.data.get('username') or request.data.get('email') or ''
        ).strip().casefold()
        if not username:
            username = '<missing>'
        account_digest = hashlib.sha256(username.encode('utf-8')).hexdigest()
        ident = self.get_ident(request)
        return self.cache_format % {
            'scope': self.scope,
            'ident': f'{ident}:{account_digest}',
        }


class FileUploadRateThrottle(SimpleRateThrottle):
    """Bound repeated authenticated file replacements that consume disk."""

    scope = 'file_upload'

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {
            'scope': self.scope,
            'ident': str(request.user.pk),
        }
