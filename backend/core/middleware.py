from django.conf import settings
from django.http import JsonResponse


class RequestSizeLimitMiddleware:
    """Reject declared oversized request bodies before Django parses them."""

    _BODY_METHODS = {'POST', 'PUT', 'PATCH'}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in self._BODY_METHODS:
            raw_length = request.META.get('CONTENT_LENGTH', '')
            try:
                content_length = int(raw_length) if raw_length else 0
            except (TypeError, ValueError):
                return JsonResponse(
                    {'detail': 'Invalid Content-Length header.'},
                    status=400,
                )
            if content_length < 0:
                return JsonResponse(
                    {'detail': 'Invalid Content-Length header.'},
                    status=400,
                )
            if content_length > settings.MAX_REQUEST_BODY_SIZE:
                return JsonResponse(
                    {'detail': 'Request body too large.'},
                    status=413,
                )
        return self.get_response(request)


class ApiSecurityHeadersMiddleware:
    """Apply restrictive browser policies to API responses."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith('/api/'):
            if request.path.startswith('/api/docs/'):
                response.setdefault(
                    'Content-Security-Policy',
                    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; "
                    "object-src 'none'; img-src 'self' data: https:; "
                    "style-src 'self' 'unsafe-inline' https:; "
                    "script-src 'self' 'unsafe-inline' https:",
                )
            else:
                response.setdefault(
                    'Content-Security-Policy',
                    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
                    "form-action 'none'",
                )
            response.setdefault(
                'Permissions-Policy',
                'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            )
            # The configured frontend may be hosted on a different site
            # (for example Render static + API services).  The public logo is
            # intentionally embeddable there; all other API resources remain
            # same-site.
            resource_policy = (
                'cross-origin'
                if request.path == '/api/auth/settings/logo/'
                else 'same-site'
            )
            response.setdefault('Cross-Origin-Resource-Policy', resource_policy)
        return response
