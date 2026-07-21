"""Security helpers shared by authentication endpoints."""

from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)


def revoke_user_refresh_tokens(user):
    """Blacklist every refresh token issued to ``user``.

    Access tokens are rejected independently through SimpleJWT's
    ``CHECK_REVOKE_TOKEN`` password fingerprint check after a password change.
    """
    revoked = 0
    for token in OutstandingToken.objects.filter(user=user).iterator():
        _, created = BlacklistedToken.objects.get_or_create(token=token)
        revoked += int(created)
    return revoked
